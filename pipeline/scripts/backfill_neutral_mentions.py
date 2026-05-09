"""Backfill: extract neutral-thread bare-name mentions that the original
pipeline previously skipped.

Before extract.py rule 6 changed (2026-05-04), bare-name comments under
neutral search threads ("Where can I find sushi?", "Open late on Sunday?")
were SKIPPED entirely — they have no `extractions` row at all.

The new rule extracts them with `food_sentiment=null, service_sentiment=null`,
producing a volume-only signal that surfaces on the restaurant card as
"+ N more mentions" without moving food_score or service_score.

This script walks every relevant thread per city and re-runs extract+resolve
on any comment that lacks an extractions row. The updated prompt picks up
the previously-skipped neutral mentions; comments that genuinely had nothing
to extract still produce zero rows. Idempotent: safe to re-run.

Usage (from the repo root, with the venv active):
  # Backfill all four cities at the original 0.4 relevance threshold:
  python -m pipeline.scripts.backfill_neutral_mentions

  # Single city:
  python -m pipeline.scripts.backfill_neutral_mentions --city denver
"""
from __future__ import annotations

import argparse
import sys

from rich.console import Console

from pipeline import db
from pipeline.cities import CITIES
from pipeline.stages.extract import extract_from_comment
from pipeline.stages.resolve import (
    cuisines_from_types,
    resolve_mention,
)
from pipeline.stages.score import compute_scores_for_city


def backfill_city(
    city_slug: str,
    relevance_threshold: float,
    console: Console,
) -> dict:
    console.rule(f"[bold]Backfill {city_slug}[/bold]")

    relevant = db.fetch_relevant_threads(city_slug, relevance_threshold)
    console.print(f"  Walking {len(relevant)} relevant threads.")

    n_comments_seen = 0
    n_skipped_already_processed = 0
    n_extractions_added = 0
    n_flags = 0
    seen_place_ids: set[str] = set()

    for t in relevant:
        comments = db.fetch_comments_for_thread(t["id"])
        comments_by_reddit_id = {c["reddit_id"]: c for c in comments}
        for c in comments:
            n_comments_seen += 1
            if db.comment_has_been_extracted(c["id"]):
                n_skipped_already_processed += 1
                continue

            parent_chain = db.walk_parent_chain(
                c["reddit_id"], comments_by_reddit_id, max_depth=3
            )
            extractions = extract_from_comment(
                c["body"],
                thread_title=t["title"],
                thread_body=t.get("body"),
                parent_chain=parent_chain or None,
            )
            for e in extractions:
                r = resolve_mention(e.mention, city_slug, e.neighborhood_hint)
                db.insert_place_resolution(
                    mention=e.mention,
                    city_slug=city_slug,
                    candidate_place_id=r.candidate.place_id if r.candidate else None,
                    confidence=r.confidence,
                    method=r.method,
                    reasoning=r.reasoning,
                )
                restaurant_id = None
                if r.candidate and r.confidence >= 0.6:
                    inferred_cuisines = cuisines_from_types(r.candidate.types)
                    neighborhood = (
                        e.neighborhood_hint or r.candidate.derived_neighborhood
                    )
                    restaurant_id = db.upsert_restaurant(
                        candidate=r.candidate,
                        city_slug=city_slug,
                        neighborhood=neighborhood,
                        cuisines=inferred_cuisines,
                    )
                    if not inferred_cuisines:
                        db.ensure_missing_cuisine_flag(
                            restaurant_id=restaurant_id,
                            restaurant_name=r.candidate.name,
                        )
                    seen_place_ids.add(r.candidate.place_id)

                ext_id = db.insert_extraction(
                    comment_id=c["id"],
                    extraction=e,
                    restaurant_id=restaurant_id,
                    resolve_result=r,
                )
                n_extractions_added += 1

                if r.needs_review:
                    db.insert_flag(
                        kind="low_confidence_match",
                        extraction_id=ext_id,
                        restaurant_id=restaurant_id,
                        details={
                            "mention": e.mention,
                            "method": r.method,
                            "reasoning": r.reasoning,
                        },
                    )
                    n_flags += 1
            # Mark AFTER the inner loop so future runs skip this comment
            # whether it produced extractions or an empty list.
            db.mark_comment_extracted(c["id"])

    console.print(
        f"  Comments seen: {n_comments_seen}   "
        f"already-processed (skipped): [dim]{n_skipped_already_processed}[/dim]   "
        f"new extractions: [green]{n_extractions_added}[/green]   "
        f"new flags: {n_flags}"
    )

    # Recompute so the new mention_only_users counts land on the cards.
    n_scored = compute_scores_for_city(city_slug)
    console.print(f"  Restaurants rescored: {n_scored}")

    return {
        "comments_seen": n_comments_seen,
        "extractions_added": n_extractions_added,
        "flags": n_flags,
        "scored": n_scored,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill neutral-thread bare-name mentions previously "
            "skipped by extract.py rule 6."
        )
    )
    parser.add_argument(
        "--city",
        help=(
            "City slug (denver, paris, calgary, new-orleans). "
            "Omit to backfill all four."
        ),
    )
    parser.add_argument(
        "--relevance-threshold",
        type=float,
        default=0.4,
        help=(
            "Re-process threads at or above this relevance. Default 0.4 "
            "matches the original pipeline gate documented in pipeline/README.md."
        ),
    )
    args = parser.parse_args()

    cities = [args.city] if args.city else list(CITIES)
    for c in cities:
        if c not in CITIES:
            print(
                f"Unknown city slug: {c!r}. Known: {list(CITIES)}",
                file=sys.stderr,
            )
            return 1

    console = Console()
    for c in cities:
        backfill_city(c, args.relevance_threshold, console=console)

    console.rule("[bold]Done[/bold]")
    console.print(
        "Refresh the city pages in the dev server to see the new "
        "'+ N more mentions' captions."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
