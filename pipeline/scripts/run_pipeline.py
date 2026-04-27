"""Orchestrator: run every pipeline stage for one city, end to end.

Usage (from the repo root, with the venv active):

  # First-run smoke test for Denver (3 focused subs, small sample):
  python -m pipeline.scripts.run_pipeline \
    --city denver \
    --subreddits Denver DenverFood AskDenver \
    --max-posts 10 \
    --max-comments 20

The script is idempotent at every stage: re-running won't duplicate threads,
comments, restaurants, or extractions (they're keyed by stable identifiers
or wiped-and-rewritten per comment).
"""
from __future__ import annotations

import argparse
import sys

from rich.console import Console
from rich.table import Table

from pipeline import db
from pipeline.cities import CITIES
from pipeline.stages.discover import discover_subreddit
from pipeline.stages.extract import extract_from_comment
from pipeline.stages.relevance import score_thread_relevance
from pipeline.stages.resolve import (
    cuisines_from_types,
    reresolve_unresolved_extractions,
    resolve_mention,
)
from pipeline.stages.score import compute_scores_for_city


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the full pipeline for one city.")
    parser.add_argument("--city", required=True, help="City slug (e.g. denver).")
    parser.add_argument(
        "--subreddits",
        nargs="*",
        default=[],
        help="Subreddit names without r/ (e.g. Denver DenverFood AskDenver). "
        "Required unless --skip-discover is passed.",
    )
    parser.add_argument("--max-posts", type=int, default=20)
    parser.add_argument("--max-comments", type=int, default=30)
    parser.add_argument(
        "--relevance-threshold",
        type=float,
        default=0.5,
        help="Threads must score at or above this to be extracted.",
    )
    parser.add_argument(
        "--skip-discover",
        action="store_true",
        help="Skip the Apify discovery step. Useful for resuming a run after "
        "threads have already been ingested.",
    )
    args = parser.parse_args()

    if not args.skip_discover and not args.subreddits:
        print(
            "Error: --subreddits is required unless --skip-discover is passed.",
            file=sys.stderr,
        )
        return 1

    if args.city not in CITIES:
        print(f"Unknown city slug: {args.city!r}. Known: {list(CITIES)}", file=sys.stderr)
        return 1
    city = CITIES[args.city]

    console = Console()

    # ------------------------------------------------------------------
    if args.skip_discover:
        console.rule("[bold]1. Discover[/bold] — [dim]skipped[/dim]")
        console.print(
            "  [dim]Processing existing threads in the DB only.[/dim]"
        )
    else:
        console.rule(
            f"[bold]1. Discover[/bold] — {len(args.subreddits)} subreddits"
        )
        discover_table = Table(show_lines=False)
        discover_table.add_column("Subreddit", style="cyan")
        discover_table.add_column("Threads", justify="right")
        discover_table.add_column("Comments", justify="right")
        discover_table.add_column("Old skipped", justify="right", style="dim")
        for sub in args.subreddits:
            console.print(f"  Pulling r/{sub} ...")
            result = discover_subreddit(
                sub,
                city_slug=args.city,
                max_posts=args.max_posts,
                max_comments_per_post=args.max_comments,
            )
            discover_table.add_row(
                f"r/{sub}",
                str(result["threads"]),
                str(result["comments"]),
                str(result["skipped_old"]),
            )
        console.print(discover_table)

    # ------------------------------------------------------------------
    console.rule("[bold]2. Relevance gate[/bold]")
    pending = db.fetch_threads_needing_relevance(args.city)
    console.print(f"  {len(pending)} threads to score.")
    n_kept = 0
    n_dropped = 0
    for t in pending:
        score = score_thread_relevance(title=t["title"], city_name=city.name)
        db.update_thread_relevance(t["id"], score)
        if score >= args.relevance_threshold:
            n_kept += 1
        else:
            n_dropped += 1
    console.print(
        f"  Above threshold ({args.relevance_threshold}): "
        f"[green]{n_kept}[/green]   below: [dim]{n_dropped}[/dim]"
    )

    # ------------------------------------------------------------------
    console.rule("[bold]3. Extract + Resolve[/bold]")
    relevant = db.fetch_relevant_threads(args.city, args.relevance_threshold)
    n_extractions = 0
    n_resolved = 0
    n_flags = 0
    seen_place_ids: set[str] = set()

    for t in relevant:
        comments = db.fetch_comments_for_thread(t["id"])
        for c in comments:
            if db.comment_has_extractions(c["id"]):
                continue  # already processed in a prior run
            extractions = extract_from_comment(c["body"])
            for e in extractions:
                r = resolve_mention(e.mention, args.city, e.neighborhood_hint)
                db.insert_place_resolution(
                    mention=e.mention,
                    city_slug=args.city,
                    candidate_place_id=r.candidate.place_id if r.candidate else None,
                    confidence=r.confidence,
                    method=r.method,
                    reasoning=r.reasoning,
                )
                restaurant_id = None
                if r.candidate and r.confidence >= 0.6:
                    inferred_cuisines = cuisines_from_types(r.candidate.types)
                    # Prefer the Reddit comment's neighborhood mention; fall
                    # back to whatever Google's addressComponents say.
                    neighborhood = (
                        e.neighborhood_hint or r.candidate.derived_neighborhood
                    )
                    restaurant_id = db.upsert_restaurant(
                        candidate=r.candidate,
                        city_slug=args.city,
                        neighborhood=neighborhood,
                        cuisines=inferred_cuisines,
                    )
                    # If Google's types didn't yield any of our 26 cuisines,
                    # surface this in the admin queue so a human can tag it.
                    if not inferred_cuisines:
                        db.ensure_missing_cuisine_flag(
                            restaurant_id=restaurant_id,
                            restaurant_name=r.candidate.name,
                        )
                    if r.candidate.place_id not in seen_place_ids:
                        n_resolved += 1
                        seen_place_ids.add(r.candidate.place_id)
                ext_id = db.insert_extraction(
                    comment_id=c["id"],
                    extraction=e,
                    restaurant_id=restaurant_id,
                    resolve_result=r,
                )
                n_extractions += 1
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
    console.print(
        f"  Extractions: {n_extractions}   "
        f"unique restaurants: {len(seen_place_ids)}   "
        f"flagged: {n_flags}"
    )

    # ------------------------------------------------------------------
    console.rule("[bold]4. Retry unresolved[/bold]")
    retry = reresolve_unresolved_extractions(args.city)
    if retry["checked"] == 0:
        console.print("  Nothing to retry.")
    else:
        console.print(
            f"  Retried {retry['checked']} previously-unresolved extraction(s):  "
            f"[green]resolved={retry['resolved']}[/green]   "
            f"still_failed={retry['still_failed']}"
        )

    # ------------------------------------------------------------------
    console.rule("[bold]5. Score & rank[/bold]")
    n_scored = compute_scores_for_city(args.city)
    console.print(f"  Restaurants scored: {n_scored}")

    # ------------------------------------------------------------------
    console.rule("[bold]Done[/bold]")
    console.print(f"Refresh /{args.city} in the dev server to see the new data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
