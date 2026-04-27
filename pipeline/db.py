"""Supabase client wrapper with pipeline-specific helpers.

Uses the service-role key, which bypasses RLS — the pipeline writes to internal
tables (reddit_threads, extractions, place_resolutions, flags) that the anon
key can't see, plus the public-readable restaurants table.

Most helpers are upserts keyed on natural identifiers (`reddit_id`, `place_id`)
so the pipeline can be run repeatedly without producing duplicates.
"""
from __future__ import annotations

import time
from datetime import datetime
from functools import wraps
from typing import Any, Callable, Optional, TypeVar

import httpx
from supabase import Client, create_client

from pipeline.config import settings
from pipeline.models import Extraction, PlaceCandidate, ResolveResult


# Transient errors we want to retry on. Supabase / PostgREST sit behind a
# load balancer that occasionally drops idle HTTP/2 streams or rate-limits a
# burst of writes during the discover stage. None of those are deterministic
# bugs in our code — a brief backoff and retry resolves them.
_RETRY_EXCEPTIONS: tuple = (
    httpx.ReadTimeout,
    httpx.ConnectTimeout,
    httpx.WriteTimeout,
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.PoolTimeout,
)

F = TypeVar("F", bound=Callable[..., Any])


def _with_retry(attempts: int = 3, base_backoff: float = 1.5) -> Callable[[F], F]:
    """Decorator: retry on transient HTTP errors with exponential backoff."""

    def deco(fn: F) -> F:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            for i in range(attempts):
                try:
                    return fn(*args, **kwargs)
                except _RETRY_EXCEPTIONS:
                    if i == attempts - 1:
                        raise
                    time.sleep(base_backoff * (2 ** i))
            raise RuntimeError("unreachable")

        return wrapper  # type: ignore[return-value]

    return deco


_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


# --- reddit_threads ---------------------------------------------------------


@_with_retry()
def upsert_thread(
    *,
    reddit_id: str,
    url: str,
    subreddit: str,
    title: str,
    posted_at: datetime,
    body: Optional[str] = None,
    city_slug: Optional[str] = None,
    author: Optional[str] = None,
    relevance: Optional[float] = None,
    comment_count: int = 0,
) -> str:
    """Upsert by reddit_id; returns the row's UUID. Retries on transient HTTP errors."""
    client = get_client()
    result = (
        client.table("reddit_threads")
        .upsert(
            {
                "reddit_id": reddit_id,
                "url": url,
                "subreddit": subreddit,
                "title": title,
                "body": body,
                "author": author,
                "posted_at": posted_at.isoformat(),
                "city_slug": city_slug,
                "relevance": relevance,
                "comment_count": comment_count,
            },
            on_conflict="reddit_id",
        )
        .execute()
    )
    return result.data[0]["id"]


# --- reddit_comments --------------------------------------------------------


@_with_retry()
def upsert_comment(
    *,
    reddit_id: str,
    thread_id: str,
    body: str,
    posted_at: datetime,
    author: Optional[str] = None,
    parent_comment_id: Optional[str] = None,
) -> str:
    """Upsert by reddit_id; returns the row's UUID. Retries on transient HTTP errors."""
    client = get_client()
    result = (
        client.table("reddit_comments")
        .upsert(
            {
                "reddit_id": reddit_id,
                "thread_id": thread_id,
                "author": author,
                "body": body,
                "posted_at": posted_at.isoformat(),
                "parent_comment_id": parent_comment_id,
            },
            on_conflict="reddit_id",
        )
        .execute()
    )
    return result.data[0]["id"]


# --- restaurants ------------------------------------------------------------


def upsert_restaurant(
    *,
    candidate: PlaceCandidate,
    city_slug: str,
    neighborhood: Optional[str] = None,
    cuisines: Optional[list[str]] = None,
) -> str:
    """Upsert a restaurant from a PlaceCandidate via the SQL helper RPC.

    Goes through the `upsert_restaurant` Postgres function (defined in
    0002_pipeline_helpers.sql) because PostgREST can't accept a PostGIS
    geography type directly.
    """
    client = get_client()
    result = client.rpc(
        "upsert_restaurant",
        {
            "p_place_id":         candidate.place_id,
            "p_name":             candidate.name,
            "p_city_slug":        city_slug,
            "p_lng":              candidate.lng,
            "p_lat":              candidate.lat,
            "p_neighborhood":     neighborhood,
            "p_address":          candidate.address,
            "p_website":          candidate.website,
            "p_price_level":      candidate.price_level,
            "p_google_rating":    candidate.google_rating,
            "p_google_review_ct": candidate.google_review_ct,
            "p_cuisines":         cuisines or [],
        },
    ).execute()
    # The function returns a uuid scalar. supabase-py wraps it as result.data.
    return str(result.data)


# --- extractions ------------------------------------------------------------


def insert_extraction(
    *,
    comment_id: str,
    extraction: Extraction,
    restaurant_id: Optional[str],
    resolve_result: ResolveResult,
) -> str:
    """Insert a row into `extractions`; returns the row's UUID."""
    client = get_client()
    result = (
        client.table("extractions")
        .insert(
            {
                "comment_id":            comment_id,
                "restaurant_id":         restaurant_id,
                "mention_text":          extraction.mention,
                "neighborhood_hint":     extraction.neighborhood_hint,
                "food_sentiment":        extraction.food_sentiment,
                "service_sentiment":     extraction.service_sentiment,
                "quote_original":        extraction.quote,
                "quote_translated":      None,
                "vote_weight":           _vote_weight(resolve_result),
                "resolution_confidence": resolve_result.confidence,
                "resolution_method":     resolve_result.method,
            }
        )
        .execute()
    )
    return result.data[0]["id"]


def delete_extractions_for_comments(comment_ids: list[str]) -> None:
    """Idempotency helper: clear extractions for the given comment UUIDs.

    Useful when re-running the demo or a reprocessing job — extractions don't
    have a natural unique key (a comment may legitimately produce multiple
    extractions), so we wipe-and-replace rather than upsert.
    """
    if not comment_ids:
        return
    get_client().table("extractions").delete().in_("comment_id", comment_ids).execute()


# --- read helpers (used by orchestrator) ------------------------------------


def fetch_threads_needing_relevance(city_slug: str) -> list[dict]:
    """Threads in the city that haven't been relevance-scored yet."""
    return (
        get_client()
        .table("reddit_threads")
        .select("id, title, subreddit")
        .eq("city_slug", city_slug)
        .is_("relevance", "null")
        .execute()
        .data
        or []
    )


def update_thread_relevance(thread_id: str, relevance: float) -> None:
    get_client().table("reddit_threads").update({"relevance": relevance}).eq(
        "id", thread_id
    ).execute()


def fetch_relevant_threads(city_slug: str, threshold: float) -> list[dict]:
    """Threads whose relevance is at or above threshold."""
    return (
        get_client()
        .table("reddit_threads")
        .select("id, title, body, subreddit, relevance")
        .eq("city_slug", city_slug)
        .gte("relevance", threshold)
        .execute()
        .data
        or []
    )


def fetch_comments_for_thread(thread_id: str) -> list[dict]:
    """All comments for a thread, including parent_comment_id for chain walking."""
    return (
        get_client()
        .table("reddit_comments")
        .select("id, reddit_id, body, author, parent_comment_id")
        .eq("thread_id", thread_id)
        .execute()
        .data
        or []
    )


def walk_parent_chain(
    comment_reddit_id: str,
    comments_by_reddit_id: dict,
    max_depth: int = 3,
) -> list:
    """Walk up the reply chain from a comment, in memory.

    `comments_by_reddit_id` is a dict keyed by reddit_id (with t1_ prefix);
    callers should index `fetch_comments_for_thread` results once per thread.

    Returns parent comments closest-first: [immediate_parent, grandparent, ...]
    Each entry is `{"author": str|None, "body": str}`.
    """
    chain: list = []
    current_reddit_id = comment_reddit_id
    for _ in range(max_depth):
        current = comments_by_reddit_id.get(current_reddit_id)
        if not current:
            break
        parent_id = current.get("parent_comment_id")
        if not parent_id:
            break
        parent = comments_by_reddit_id.get(parent_id)
        if not parent:
            break
        chain.append({"author": parent.get("author"), "body": parent.get("body") or ""})
        current_reddit_id = parent_id
    return chain


def comment_has_extractions(comment_id: str) -> bool:
    """True if any extraction already references this comment."""
    r = (
        get_client()
        .table("extractions")
        .select("id", count="exact")
        .eq("comment_id", comment_id)
        .limit(1)
        .execute()
    )
    return (r.count or 0) > 0


# --- place_resolutions ------------------------------------------------------


def insert_place_resolution(
    *,
    mention: str,
    city_slug: str,
    candidate_place_id: Optional[str],
    confidence: float,
    method: str,
    reasoning: str,
) -> None:
    """Append-only audit log of every resolution attempt."""
    get_client().table("place_resolutions").insert(
        {
            "mention_text":       mention,
            "city_slug":          city_slug,
            "candidate_place_id": candidate_place_id,
            "confidence":         confidence,
            "method":             method,
            "reasoning":          reasoning,
        }
    ).execute()


# --- flags (admin reconciliation queue) -------------------------------------


def insert_flag(
    *,
    kind: str,
    extraction_id: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Add a row to the admin reconciliation queue."""
    get_client().table("flags").insert(
        {
            "kind":          kind,
            "extraction_id": extraction_id,
            "restaurant_id": restaurant_id,
            "details":       details or {},
        }
    ).execute()


def ensure_missing_cuisine_flag(
    *,
    restaurant_id: str,
    restaurant_name: str,
) -> bool:
    """Create a `missing_cuisine` flag for this restaurant if one isn't already
    open. Idempotent — repeated pipeline runs won't dupe.

    Returns True if a new flag was inserted, False if one already existed.
    """
    client = get_client()
    existing = (
        client.table("flags")
        .select("id")
        .eq("kind", "missing_cuisine")
        .eq("restaurant_id", restaurant_id)
        .eq("status", "open")
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        return False
    insert_flag(
        kind="missing_cuisine",
        restaurant_id=restaurant_id,
        details={"restaurant_name": restaurant_name},
    )
    return True


# --- helpers ----------------------------------------------------------------


def _vote_weight(r: ResolveResult) -> float:
    """RedditRecs-style vote weighting: confident matches count fully, ambiguous
    matches contribute fractionally so a single vague mention doesn't fully
    boost the wrong restaurant.
    """
    if r.confidence >= 0.85:
        return 1.0
    if r.confidence >= 0.6:
        return 0.7
    return 0.5
