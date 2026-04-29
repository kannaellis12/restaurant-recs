"""Discover stage — pull Reddit threads + comments via Apify.

Two entry points:
  * discover_subreddit() — browses a subreddit's top-of-year. Misses threads
    that didn't trend viral (most restaurant discussion).
  * discover_threads() — pulls specific thread URLs the admin curated by hand.
    Idempotent: pre-filters URLs against existing DB rows so re-imports
    don't pay Apify for threads we already have.

Both share _run_actor() and _persist_items().

Why Apify and not PRAW: Reddit's API now requires support-form approval before
issuing a working client_id (as of 2026-04, the 'create app' UI gates on the
'Responsible Builder Policy'). Apify scrapes via web, returns within minutes,
and handles 24-month historical depth that PRAW can't reach anyway.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from pipeline import db
from pipeline.config import settings


# trudax/reddit-scraper-lite — the URL-friendly form replaces / with ~.
ACTOR_ID = "trudax~reddit-scraper-lite"

# Project-wide review window (mirrors the 24-month decision in memory).
DEFAULT_RECENCY_DAYS = 730


# ---- public API ------------------------------------------------------------


def discover_subreddit(
    subreddit: str,
    *,
    city_slug: str,
    max_posts: int = 50,
    max_comments_per_post: int = 30,
    recency_days: int = DEFAULT_RECENCY_DAYS,
    requires_city_keyword: Optional[list[str]] = None,
) -> dict:
    """Pull recent threads + comments from one subreddit and persist them.

    Args:
      subreddit: e.g. "Denver" (no leading r/).
      city_slug: which city this discovery run is associated with — written
        to reddit_threads.city_slug so downstream stages can scope by city.
      max_posts: cap on posts the actor pulls.
      max_comments_per_post: cap on comments per post.
      recency_days: drop posts older than this many days.
      requires_city_keyword: if set, only persist posts whose title or body
        contains one of these substrings (case-insensitive). Used for general
        subs (r/travel, r/food) where most threads aren't about our cities.

    Returns: counts dict {threads, comments, skipped_old, skipped_keyword}.
    """
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN missing from .env.local")

    items = _run_actor(
        subreddit=subreddit,
        max_posts=max_posts,
        max_comments_per_post=max_comments_per_post,
    )

    posts = [it for it in items if (it.get("dataType") or it.get("type")) == "post"]
    # Comments may be nested inside post.replies, OR live as separate dataset
    # rows with parentId pointing to the post. Build a lookup by post id.
    comments_by_post: dict[str, list[dict]] = {}
    for it in items:
        kind = it.get("dataType") or it.get("type")
        if kind != "comment":
            continue
        # Different actor versions use different field names for the parent
        # post id. Try the common ones in order.
        parent = (
            it.get("postId")
            or it.get("parentPostId")
            or it.get("postID")
            or _strip_t3_prefix(it.get("link_id"))
        )
        if not parent:
            continue
        comments_by_post.setdefault(parent, []).append(it)

    cutoff = datetime.now(timezone.utc) - timedelta(days=recency_days)

    keywords = [k.lower() for k in (requires_city_keyword or [])]

    n_threads = 0
    n_comments = 0
    n_skipped_old = 0
    n_skipped_keyword = 0

    for post in posts:
        posted_at = _parse_date(
            post.get("createdAt") or post.get("created_utc") or post.get("created")
        )
        if posted_at is None or posted_at < cutoff:
            n_skipped_old += 1
            continue

        title = post.get("title") or ""
        body = post.get("body") or post.get("text") or post.get("selftext") or ""

        if keywords:
            haystack = f"{title}\n{body}".lower()
            if not any(k in haystack for k in keywords):
                n_skipped_keyword += 1
                continue

        post_id = post.get("id") or _strip_t3_prefix(post.get("name"))
        if not post_id:
            continue

        # Inline comments (some actor versions nest them under "comments").
        inline_comments = post.get("comments") or post.get("replies") or []
        all_comments = inline_comments + comments_by_post.get(post_id, [])

        thread_uuid = db.upsert_thread(
            reddit_id=post_id,
            url=post.get("url") or f"https://www.reddit.com/r/{subreddit}/comments/{post_id}",
            subreddit=subreddit,
            title=title,
            body=body or None,
            author=post.get("username") or post.get("author"),
            posted_at=posted_at,
            city_slug=city_slug,
            comment_count=len(all_comments),
        )
        n_threads += 1

        for c in all_comments:
            cid = c.get("id") or _strip_t3_prefix(c.get("name"))
            if not cid:
                continue
            cbody = c.get("body") or c.get("text") or ""
            if not cbody.strip():
                continue
            cposted = (
                _parse_date(c.get("createdAt") or c.get("created_utc") or c.get("created"))
                or posted_at
            )

            # Reddit's parent_id is a fullname like 't1_xxx' (parent comment)
            # or 't3_xxx' (the post itself, for top-level comments). We only
            # care about t1_ — top-level comments have null parent_comment_id.
            parent_raw = (
                c.get("parentId")
                or c.get("parent_id")
                or c.get("parentID")
            )
            parent_comment_id = (
                parent_raw if parent_raw and parent_raw.startswith("t1_") else None
            )

            db.upsert_comment(
                reddit_id=cid,
                thread_id=thread_uuid,
                body=cbody,
                author=c.get("username") or c.get("author"),
                posted_at=cposted,
                parent_comment_id=parent_comment_id,
            )
            n_comments += 1

    return {
        "threads": n_threads,
        "comments": n_comments,
        "skipped_old": n_skipped_old,
        "skipped_keyword": n_skipped_keyword,
    }


# ---- Apify actor invocation -----------------------------------------------


def _run_actor(
    *,
    subreddit: str,
    max_posts: int,
    max_comments_per_post: int,
) -> list[dict]:
    """Start an actor run, poll until complete, return the dataset items."""
    token = settings.apify_api_token
    base = f"https://api.apify.com/v2/acts/{ACTOR_ID}"

    actor_input = {
        "startUrls": [{"url": f"https://www.reddit.com/r/{subreddit}/top/?t=year"}],
        "skipUserPosts": True,
        "skipCommunity": True,
        "skipComments": False,
        "searchPosts": False,
        "searchComments": False,
        "searchCommunities": False,
        "searchUsers": False,
        "scrollTimeout": 30,
        "maxItems": max_posts * (max_comments_per_post + 1),
        "maxPostCount": max_posts,
        "maxComments": max_comments_per_post,
        "maxCommunitiesCount": 0,
        "maxUserCount": 0,
        "proxy": {"useApifyProxy": True},
    }

    # Auth via header rather than query param — avoids leaking the token into
    # request logs, and Apify is more lenient about rate limits this way.
    auth = {"Authorization": f"Bearer {token}"}

    # Start the run.
    start = httpx.post(f"{base}/runs", headers=auth, json=actor_input, timeout=30)
    start.raise_for_status()
    run = start.json()["data"]
    run_id = run["id"]
    dataset_id = run["defaultDatasetId"]

    # Poll until terminal state.
    deadline = time.time() + 600  # 10 min cap
    status = run["status"]
    while status not in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
        if time.time() > deadline:
            raise TimeoutError(f"Apify run {run_id} did not finish within 10 minutes")
        time.sleep(5)
        r = httpx.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}", headers=auth, timeout=30
        )
        r.raise_for_status()
        status = r.json()["data"]["status"]

    if status != "SUCCEEDED":
        raise RuntimeError(f"Apify run {run_id} ended with status={status}")

    # Fetch all dataset items.
    items: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        r = httpx.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items"
            f"?format=json&offset={offset}&limit={page_size}",
            headers=auth,
            timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        items.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return items


# ---- helpers ---------------------------------------------------------------


def _parse_date(s) -> Optional[datetime]:
    """Accept ISO strings or unix timestamps (numbers / numeric strings)."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s, tz=timezone.utc)
    if isinstance(s, str):
        # Try ISO first.
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            pass
        # Then numeric-string fallback.
        try:
            return datetime.fromtimestamp(float(s), tz=timezone.utc)
        except (ValueError, OSError):
            return None
    return None


def _strip_t3_prefix(name: Optional[str]) -> Optional[str]:
    """Reddit ids are sometimes returned as 't3_abc123'. Trim the prefix."""
    if not name:
        return None
    if name.startswith(("t1_", "t3_")):
        return name[3:]
    return name


# ---------------------------------------------------------------------------
# discover_threads — hand-curated import path
# ---------------------------------------------------------------------------
# Used when the admin finds high-signal threads on Reddit that didn't surface
# in our top-of-year browse (e.g. a thoughtful "Top 3 restaurants in Calgary?"
# that wasn't viral enough to crack the year's top 12 by upvotes).
#
# Idempotent in two ways:
#   1. Pre-filter URLs against existing DB rows so we don't re-pay Apify
#      for threads we already pulled.
#   2. The standard upsert_thread / upsert_comment dedupe by reddit_id, so
#      even if the pre-filter misses (e.g. URL parses to a different id
#      than what we have on file), the persist step won't dupe.

# Match the post id segment in any standard Reddit URL form:
#   reddit.com/r/{sub}/comments/{ID}/...
#   old.reddit.com/r/{sub}/comments/{ID}/...
#   redd.it/{ID}
THREAD_ID_PATTERN = re.compile(r"/comments/([a-z0-9]+)|redd\.it/([a-z0-9]+)")


def _extract_thread_id(url: str) -> Optional[str]:
    m = THREAD_ID_PATTERN.search(url)
    if not m:
        return None
    return m.group(1) or m.group(2)


def discover_threads(
    urls: list,
    *,
    city_slug: str,
    max_comments_per_post: int = 30,
) -> dict:
    """Pull specific Reddit threads (by URL) instead of browsing a subreddit.

    URLs already represented in the DB (matched by extracted reddit_id) are
    skipped at the Apify call layer — re-running with a list that overlaps
    existing data costs nothing.

    Returns a counts dict: {threads, comments, skipped_existing, skipped_invalid}.
    """
    if not settings.apify_api_token:
        raise RuntimeError("APIFY_API_TOKEN missing from .env.local")
    if not urls:
        return {"threads": 0, "comments": 0, "skipped_existing": 0, "skipped_invalid": 0}

    # 1. Map URL → reddit_id, dropping any URLs we can't parse.
    url_to_id: dict = {}
    skipped_invalid = 0
    for url in urls:
        rid = _extract_thread_id(url)
        if rid:
            url_to_id[url] = rid
        else:
            skipped_invalid += 1

    # 2. Filter against existing thread reddit_ids in the DB.
    candidate_ids = list(url_to_id.values())
    existing = db.existing_thread_reddit_ids(candidate_ids)
    new_urls = [u for u, rid in url_to_id.items() if rid not in existing]
    skipped_existing = len(url_to_id) - len(new_urls)

    if not new_urls:
        return {
            "threads": 0,
            "comments": 0,
            "skipped_existing": skipped_existing,
            "skipped_invalid": skipped_invalid,
        }

    # 3. Hit Apify on the new URLs.
    actor_input = {
        "startUrls": [{"url": u} for u in new_urls],
        "skipUserPosts": True,
        "skipCommunity": True,
        "skipComments": False,
        "searchPosts": False,
        "searchComments": False,
        "searchCommunities": False,
        "searchUsers": False,
        "scrollTimeout": 30,
        "maxItems": len(new_urls) * (max_comments_per_post + 1),
        "maxPostCount": len(new_urls),
        "maxComments": max_comments_per_post,
        "proxy": {"useApifyProxy": True},
    }
    items = _run_actor_with_input(actor_input)

    # 4. Parse + persist using the same logic as discover_subreddit, but with
    #    per-thread subreddit (extracted from the post itself, not configured).
    n_threads = 0
    n_comments = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=DEFAULT_RECENCY_DAYS)

    posts = [it for it in items if (it.get("dataType") or it.get("type")) == "post"]
    comments_by_post: dict = {}
    for it in items:
        kind = it.get("dataType") or it.get("type")
        if kind != "comment":
            continue
        parent = (
            it.get("postId")
            or it.get("parentPostId")
            or it.get("postID")
            or _strip_t3_prefix(it.get("link_id"))
        )
        if not parent:
            continue
        comments_by_post.setdefault(parent, []).append(it)

    for post in posts:
        posted_at = _parse_date(
            post.get("createdAt") or post.get("created_utc") or post.get("created")
        )
        if posted_at is None or posted_at < cutoff:
            continue

        title = post.get("title") or ""
        body = post.get("body") or post.get("text") or post.get("selftext") or ""
        post_id = post.get("id") or _strip_t3_prefix(post.get("name"))
        if not post_id:
            continue
        # Subreddit name comes off the post itself for hand-curated imports.
        subreddit = (
            post.get("communityName")
            or post.get("subreddit")
            or post.get("subreddit_name_prefixed", "").replace("r/", "")
            or "unknown"
        )

        inline_comments = post.get("comments") or post.get("replies") or []
        all_comments = inline_comments + comments_by_post.get(post_id, [])

        thread_uuid = db.upsert_thread(
            reddit_id=post_id,
            url=post.get("url") or f"https://www.reddit.com/comments/{post_id}",
            subreddit=subreddit,
            title=title,
            body=body or None,
            author=post.get("username") or post.get("author"),
            posted_at=posted_at,
            city_slug=city_slug,
            comment_count=len(all_comments),
        )
        n_threads += 1

        for c in all_comments:
            cid = c.get("id") or _strip_t3_prefix(c.get("name"))
            if not cid:
                continue
            cbody = c.get("body") or c.get("text") or ""
            if not cbody.strip():
                continue
            cposted = (
                _parse_date(c.get("createdAt") or c.get("created_utc") or c.get("created"))
                or posted_at
            )
            parent_raw = (
                c.get("parentId") or c.get("parent_id") or c.get("parentID")
            )
            parent_comment_id = (
                parent_raw if parent_raw and parent_raw.startswith("t1_") else None
            )
            db.upsert_comment(
                reddit_id=cid,
                thread_id=thread_uuid,
                body=cbody,
                author=c.get("username") or c.get("author"),
                posted_at=cposted,
                parent_comment_id=parent_comment_id,
            )
            n_comments += 1

    return {
        "threads": n_threads,
        "comments": n_comments,
        "skipped_existing": skipped_existing,
        "skipped_invalid": skipped_invalid,
    }


def _run_actor_with_input(actor_input: dict) -> list:
    """Minimal duplicate of _run_actor's polling logic so callers can pass
    a fully-shaped actor input. (Kept inline for now; if a third entry point
    appears we should consolidate.)"""
    token = settings.apify_api_token
    base = f"https://api.apify.com/v2/acts/{ACTOR_ID}"

    start = httpx.post(
        f"{base}/runs",
        headers={"Authorization": f"Bearer {token}"},
        json=actor_input,
        timeout=30,
    )
    start.raise_for_status()
    run = start.json()["data"]
    run_id = run["id"]
    dataset_id = run["defaultDatasetId"]

    deadline = time.time() + 600
    status = run["status"]
    while status not in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
        if time.time() > deadline:
            raise TimeoutError(f"Apify run {run_id} did not finish within 10 minutes")
        time.sleep(5)
        r = httpx.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        r.raise_for_status()
        status = r.json()["data"]["status"]

    if status != "SUCCEEDED":
        raise RuntimeError(f"Apify run {run_id} ended with status={status}")

    items: list = []
    offset = 0
    page_size = 1000
    while True:
        r = httpx.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            params={"format": "json", "offset": offset, "limit": page_size},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        items.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return items
