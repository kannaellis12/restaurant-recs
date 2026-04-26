"""Demo: end-to-end pipeline run on canned Denver comments.

Steps for each comment:
  1. extract → list of (mention, sentiments, quote)
  2. resolve → Place ID with confidence
  3. upsert restaurant (real Google Places data)
  4. insert extraction linked to comment + restaurant
  5. insert place_resolution audit row
  6. insert flag if low-confidence

Idempotent: stable fake reddit_ids dedupe threads/comments via upsert; existing
extractions for those comments are wiped before re-running so the row counts
stay sane on repeated runs.

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.demo_pipeline
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from rich.console import Console
from rich.table import Table

from pipeline import db
from pipeline.stages.extract import extract_from_comment
from pipeline.stages.resolve import resolve_mention
from pipeline.stages.score import compute_scores_for_city


CITY_SLUG = "denver"
DEMO_THREAD_REDDIT_ID = "demo-thread-1"


# (reddit_comment_id, body) — stable IDs so reruns dedupe via upsert.
SAMPLE_COMMENTS: list[tuple[str, str]] = [
    (
        "demo-comment-1",
        "Sushi Den is the best sushi in Denver, hands down. The omakase is incredible.",
    ),
    (
        "demo-comment-2",
        "Sap Sua in Congress Park is amazing — the menu is creative and the staff is super friendly.",
    ),
    (
        "demo-comment-3",
        "Hop Alley's Peking duck is incredible but the wait for a table is brutal even with reservations.",
    ),
    (
        "demo-comment-4",
        "If you want good Mexican in Denver, Tacos Tequila Whiskey on York is solid. "
        "Mister Oso in RiNo is fancier but also great.",
    ),
    (
        "demo-comment-5",
        "Sam's No. 3 is overrated. Diner food is mediocre and the staff is rude.",
    ),
    (
        "demo-comment-6",
        "Tavernetta has hit-or-miss food. The pasta is great, the meat dishes are dry. "
        "Service is consistently good though.",
    ),
]


def main() -> None:
    console = Console()
    now = datetime.now(timezone.utc)

    console.rule("[bold]1. Set up fake Reddit thread + comments[/bold]")
    thread_id = db.upsert_thread(
        reddit_id=DEMO_THREAD_REDDIT_ID,
        url="https://reddit.com/r/Denver/comments/demo",
        subreddit="Denver",
        title="Best restaurants in Denver?",
        posted_at=now,
        city_slug=CITY_SLUG,
        relevance=0.95,
        comment_count=len(SAMPLE_COMMENTS),
    )
    console.print(f"  Thread:   {thread_id}")

    comment_ids: dict[str, str] = {}
    for reddit_id, body in SAMPLE_COMMENTS:
        cid = db.upsert_comment(
            reddit_id=reddit_id,
            thread_id=thread_id,
            body=body,
            posted_at=now,
            author="demo-user",
        )
        comment_ids[reddit_id] = cid
    console.print(f"  Comments: {len(comment_ids)} upserted")

    db.delete_extractions_for_comments(list(comment_ids.values()))
    console.print("  Wiped prior extractions for these comments.")

    console.rule("[bold]2. extract → resolve → write[/bold]")
    table = Table(show_lines=False)
    table.add_column("Comment", style="dim")
    table.add_column("Mention", style="bold yellow")
    table.add_column("Match", style="green")
    table.add_column("Conf", justify="right")
    table.add_column("Food")
    table.add_column("Service")
    table.add_column("Flagged")

    n_extractions = 0
    n_flags = 0
    seen_place_ids: set[str] = set()

    for reddit_id, body in SAMPLE_COMMENTS:
        extractions = extract_from_comment(body)
        for e in extractions:
            r = resolve_mention(e.mention, CITY_SLUG, e.neighborhood_hint)
            db.insert_place_resolution(
                mention=e.mention,
                city_slug=CITY_SLUG,
                candidate_place_id=r.candidate.place_id if r.candidate else None,
                confidence=r.confidence,
                method=r.method,
                reasoning=r.reasoning,
            )

            restaurant_id: Optional[str] = None
            if r.candidate and r.confidence >= 0.6:
                restaurant_id = db.upsert_restaurant(
                    candidate=r.candidate,
                    city_slug=CITY_SLUG,
                    neighborhood=e.neighborhood_hint,
                )
                seen_place_ids.add(r.candidate.place_id)

            extraction_id = db.insert_extraction(
                comment_id=comment_ids[reddit_id],
                extraction=e,
                restaurant_id=restaurant_id,
                resolve_result=r,
            )
            n_extractions += 1

            flagged_label = ""
            if r.needs_review:
                db.insert_flag(
                    kind="low_confidence_match",
                    extraction_id=extraction_id,
                    restaurant_id=restaurant_id,
                    details={
                        "mention": e.mention,
                        "method": r.method,
                        "reasoning": r.reasoning,
                    },
                )
                n_flags += 1
                flagged_label = "[red]yes[/red]"

            table.add_row(
                reddit_id,
                e.mention,
                r.candidate.name if r.candidate else "—",
                _conf_str(r.confidence),
                _aspect(e.food_sentiment),
                _aspect(e.service_sentiment),
                flagged_label,
            )

    console.print(table)

    console.rule("[bold]3. Score & rank[/bold]")
    n_scored = compute_scores_for_city(CITY_SLUG)
    console.print(f"  Restaurants scored: {n_scored}")

    console.rule("[bold]4. Summary[/bold]")
    console.print(f"  Comments processed:   {len(SAMPLE_COMMENTS)}")
    console.print(f"  Extractions written:  {n_extractions}")
    console.print(f"  Restaurants upserted: {len(seen_place_ids)}")
    console.print(f"  Restaurants scored:   {n_scored}")
    console.print(f"  Flags created:        {n_flags}")
    console.print(
        "\n[dim]Inspect: Supabase → Table Editor → restaurants / extractions / "
        "restaurant_scores / flags.[/dim]"
    )


def _conf_str(c: float) -> str:
    if c >= 0.85:
        return f"[green]{c:.2f}[/green]"
    if c >= 0.6:
        return f"[yellow]{c:.2f}[/yellow]"
    return f"[red]{c:.2f}[/red]"


def _aspect(s: Optional[str]) -> str:
    if s is None:
        return "[dim]—[/dim]"
    color = {"positive": "green", "negative": "red", "mixed": "yellow"}[s]
    return f"[{color}]{s}[/{color}]"


if __name__ == "__main__":
    main()
