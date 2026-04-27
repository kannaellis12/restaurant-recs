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
from pipeline.subreddits import (
    CITY_KEYWORDS,
    GLOBAL_SUBS,
    SUBREDDITS_BY_CITY,
    SubredditSeed,
)


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
    parser.add_argument(
        "--include-globals",
        action="store_true",
        help="Also pull threads from GLOBAL_SUBS (r/finedining, r/food, etc.) "
        "with city keyword pre-filtering. Implied when --subreddits is not "
        "specified and --skip-discover is not set.",
    )
    args = parser.parse_args()

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
        # Build the seed list. If the user passed --subreddits explicitly,
        # honor it (treated as city-focused, no keyword filter). Otherwise
        # pull from pipeline.subreddits config — city subs always; globals
        # too unless the user wants to skip them by passing --subreddits.
        seeds: list[SubredditSeed] = []
        if args.subreddits:
            seeds.extend(
                SubredditSeed(name=n, requires_city_keyword=False)
                for n in args.subreddits
            )
        else:
            seeds.extend(SUBREDDITS_BY_CITY.get(args.city, []))
            if args.include_globals or not args.subreddits:
                seeds.extend(GLOBAL_SUBS)

        keywords = CITY_KEYWORDS.get(args.city, [args.city.replace("-", " ")])

        console.rule(f"[bold]1. Discover[/bold] — {len(seeds)} subreddits")
        discover_table = Table(show_lines=False)
        discover_table.add_column("Subreddit", style="cyan")
        discover_table.add_column("Threads", justify="right")
        discover_table.add_column("Comments", justify="right")
        discover_table.add_column("Old skipped", justify="right", style="dim")
        discover_table.add_column("KW skipped", justify="right", style="dim")
        for seed in seeds:
            kw_filter = keywords if seed.requires_city_keyword else None
            label = f"r/{seed.name}"
            if seed.requires_city_keyword:
                label += " *"
            console.print(f"  Pulling {label} ...")
            try:
                result = discover_subreddit(
                    seed.name,
                    city_slug=args.city,
                    max_posts=args.max_posts,
                    max_comments_per_post=args.max_comments,
                    requires_city_keyword=kw_filter,
                )
                discover_table.add_row(
                    label,
                    str(result["threads"]),
                    str(result["comments"]),
                    str(result["skipped_old"]),
                    str(result.get("skipped_keyword", 0)),
                )
            except Exception as e:
                # One sub failing (Apify timeout, dead actor run, etc.)
                # shouldn't kill the whole pipeline — log and move on.
                console.print(f"  [red]✗[/red] {label} failed: {type(e).__name__}: {e}")
                discover_table.add_row(label, "[red]err[/red]", "—", "—", "—")
        console.print(discover_table)
        console.print("[dim]* requires city keyword in title/body[/dim]")

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
        # Index once per thread for in-memory parent-chain walking.
        comments_by_reddit_id = {c["reddit_id"]: c for c in comments}
        for c in comments:
            if db.comment_has_extractions(c["id"]):
                continue  # already processed in a prior run
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
