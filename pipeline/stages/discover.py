"""Discover stage — pull Reddit threads + comments via Apify.

Uses the trudax/reddit-scraper-lite actor: a community-maintained scraper that
returns structured posts + their comment trees as a flat dataset.

Why Apify and not PRAW: Reddit's API now requires support-form approval before
issuing a working client_id (as of 2026-04, the 'create app' UI gates on the
'Responsible Builder Policy'). Apify scrapes via web, returns within minutes,
and handles 24-month historical depth that PRAW can't reach anyway.
"""
from __future__ import annotations

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
            db.upsert_comment(
                reddit_id=cid,
                thread_id=thread_uuid,
                body=cbody,
                author=c.get("username") or c.get("author"),
                posted_at=cposted,
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
