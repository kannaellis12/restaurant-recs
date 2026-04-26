"""Supabase client wrapper with pipeline-specific helpers.

Uses the service-role key, which bypasses RLS — the pipeline writes to internal
tables (reddit_threads, extractions, place_resolutions, flags) that the anon
key can't see, plus the public-readable restaurants table.

Most helpers are upserts keyed on natural identifiers (`reddit_id`, `place_id`)
so the pipeline can be run repeatedly without producing duplicates.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from supabase import Client, create_client

from pipeline.config import settings
from pipeline.models import Extraction, PlaceCandidate, ResolveResult


_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


# --- reddit_threads ---------------------------------------------------------


def upsert_thread(
    *,
    reddit_id: str,
    url: str,
    subreddit: str,
    title: str,
    posted_at: datetime,
    city_slug: Optional[str] = None,
    author: Optional[str] = None,
    relevance: Optional[float] = None,
    comment_count: int = 0,
) -> str:
    """Upsert by reddit_id; returns the row's UUID."""
    client = get_client()
    result = (
        client.table("reddit_threads")
        .upsert(
            {
                "reddit_id": reddit_id,
                "url": url,
                "subreddit": subreddit,
                "title": title,
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


def upsert_comment(
    *,
    reddit_id: str,
    thread_id: str,
    body: str,
    posted_at: datetime,
    author: Optional[str] = None,
) -> str:
    """Upsert by reddit_id; returns the row's UUID."""
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
