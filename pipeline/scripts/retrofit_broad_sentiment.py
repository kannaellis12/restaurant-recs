"""Retrofit existing extractions against the latest extract prompt.

Two modes:

  --null-sentiment-only
    Only re-run the LLM on extractions whose food AND service sentiments
    are both null. Used when only the broad-sentiment / thread-polarity
    rules in the prompt have changed and we want a cheap, surgical patch.

  default (every extraction in the city)
    Re-run the LLM on every comment that produced any extraction. Used
    when we need to backfill new fields (e.g. tags) onto extractions that
    already have sentiment set.

Patching rules:

  - food_sentiment / service_sentiment: only update if the EXISTING value
    is null. Don't overwrite already-validated sentiment with a new run's
    output, which could swing slightly between calls.
  - tags: always overwrite with the new run's tags. The new prompt is
    canonical; tags should reflect it.
  - quote_original: only update if the existing extraction was both-null
    on sentiment (i.e. we're upgrading it from "not really evaluated" to
    "now evaluated").

In all cases we DO NOT call Google Places or change restaurant_id, so this
is Anthropic-only spend.

Usage (from the repo root, with the venv active):

  python -m pipeline.scripts.retrofit_broad_sentiment --all                 # full re-run, every city
  python -m pipeline.scripts.retrofit_broad_sentiment --city denver         # full re-run, one city
  python -m pipeline.scripts.retrofit_broad_sentiment --all --null-sentiment-only

Idempotent: running twice is safe; the second pass converges quickly.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from rich.console import Console

from pipeline import db
from pipeline.cities import CITIES
from pipeline.stages.extract import extract_from_comment
from pipeline.stages.score import compute_scores_for_city


def _normalize(s: str) -> str:
    return (s or "").strip().casefold()


def retrofit_city(
    city_slug: str,
    *,
    console: Console,
    null_sentiment_only: bool,
) -> dict:
    """Returns a small report dict for the rich console summary."""
    rows = db.fetch_extractions_for_retrofit(
        city_slug, null_sentiment_only=null_sentiment_only
    )
    if not rows:
        console.print(f"  [dim]{city_slug}: nothing to retrofit[/dim]")
        return {"comments": 0, "patched": 0, "unmatched": 0, "no_change": 0}

    # Group target extractions by comment so we re-run the LLM once per
    # comment (not once per extraction).
    by_comment: dict[str, list] = defaultdict(list)
    for r in rows:
        by_comment[r["comment_id"]].append(r)

    mode_label = "null-sentiment" if null_sentiment_only else "all"
    console.print(
        f"  [cyan]{city_slug}[/cyan]: {len(rows)} extraction(s) "
        f"across {len(by_comment)} comment(s) — mode={mode_label}"
    )

    patched = 0
    unmatched = 0
    no_change = 0

    for comment_id, exts in by_comment.items():
        # All extractions for one comment share the same comment + thread
        # context. Pull the first row's joined data.
        first = exts[0]
        comment = first.get("comment") or {}
        thread = comment.get("thread") or {}

        # Walk the parent chain in-memory so the LLM has the same context
        # the live pipeline gives it.
        thread_id = thread.get("id")
        parent_chain = []
        if thread_id:
            siblings = db.fetch_comments_for_thread(thread_id)
            comments_by_reddit_id = {c["reddit_id"]: c for c in siblings}
            parent_chain = db.walk_parent_chain(
                comment.get("reddit_id"), comments_by_reddit_id, max_depth=3
            )

        new_extractions = extract_from_comment(
            comment.get("body") or "",
            thread_title=thread.get("title"),
            thread_body=thread.get("body"),
            parent_chain=parent_chain or None,
        )

        # Index new extractions by normalized mention so we can pair them
        # with existing rows.
        new_by_mention = {_normalize(e.mention): e for e in new_extractions}

        for row in exts:
            existing_mention = _normalize(row["mention_text"])
            match = new_by_mention.get(existing_mention)
            if match is None:
                # The LLM no longer surfaces this mention — leave the row
                # alone. Most often this means the new prompt classifies
                # it differently (e.g. now considers it non-evaluative).
                unmatched += 1
                continue

            existing_food = row.get("food_sentiment")
            existing_service = row.get("service_sentiment")
            existing_tags = list(row.get("tags") or [])

            # Only upgrade sentiment from null. Never downgrade or rewrite
            # already-validated signal.
            new_food = existing_food if existing_food is not None else match.food_sentiment
            new_service = (
                existing_service if existing_service is not None else match.service_sentiment
            )
            new_tags = list(match.tags or [])

            food_changed = new_food != existing_food
            service_changed = new_service != existing_service
            tags_changed = sorted(new_tags) != sorted(existing_tags)

            if not (food_changed or service_changed or tags_changed):
                no_change += 1
                continue

            # Refresh the supporting quote only when the row was previously
            # both-null on sentiment (we're "upgrading" it to evaluated).
            new_quote = (
                match.quote
                if existing_food is None and existing_service is None
                else None
            )

            db.update_extraction_sentiment(
                extraction_id=row["id"],
                food_sentiment=new_food,
                service_sentiment=new_service,
                quote_original=new_quote,
                tags=new_tags,
            )
            patched += 1

    console.print(
        f"    patched: [green]{patched}[/green]   "
        f"unmatched: [dim]{unmatched}[/dim]   "
        f"no_change: [dim]{no_change}[/dim]"
    )
    return {
        "comments": len(by_comment),
        "patched": patched,
        "unmatched": unmatched,
        "no_change": no_change,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Retrofit existing extractions against the latest prompt."
    )
    parser.add_argument(
        "--city",
        action="append",
        default=[],
        help="City slug. Repeat for multiple. Mutually exclusive with --all.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run for every configured city.",
    )
    parser.add_argument(
        "--null-sentiment-only",
        action="store_true",
        help="Restrict to extractions whose food AND service sentiments are "
        "both null (the original cheap retrofit). Default re-runs every "
        "extraction in the city.",
    )
    parser.add_argument(
        "--skip-recompute",
        action="store_true",
        help="Don't recompute scores at the end. Useful when batching cities.",
    )
    args = parser.parse_args()

    if args.all and args.city:
        print("Use --all OR --city, not both.", file=sys.stderr)
        return 1

    cities = list(CITIES.keys()) if args.all else args.city
    if not cities:
        print("Provide --city <slug> (repeatable) or --all.", file=sys.stderr)
        return 1
    for c in cities:
        if c not in CITIES:
            print(f"Unknown city: {c!r}. Known: {list(CITIES)}", file=sys.stderr)
            return 1

    console = Console()
    title = (
        "Retrofit (null-sentiment only)"
        if args.null_sentiment_only
        else "Retrofit (all extractions — tag backfill)"
    )
    console.rule(f"[bold]{title}[/bold]")
    totals = {"comments": 0, "patched": 0, "unmatched": 0, "no_change": 0}
    for c in cities:
        report = retrofit_city(
            c,
            console=console,
            null_sentiment_only=args.null_sentiment_only,
        )
        for k, v in report.items():
            totals[k] += v

    if not args.skip_recompute:
        console.rule("[bold]Recompute scores[/bold]")
        for c in cities:
            n = compute_scores_for_city(c)
            console.print(f"  [cyan]{c}[/cyan]: {n} restaurants scored")

    console.rule("[bold]Done[/bold]")
    console.print(
        f"  Patched [green]{totals['patched']}[/green] extraction(s) "
        f"across {totals['comments']} comment(s).  "
        f"Unmatched: {totals['unmatched']}.  No change: {totals['no_change']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
