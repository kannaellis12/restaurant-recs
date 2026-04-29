"""Import hand-curated Reddit thread URLs into the pipeline.

When the top-of-year browse misses high-signal threads (Calgary's full of
this — restaurant discussion doesn't go viral the way photos and political
posts do), the admin can find them via Reddit search and feed them in here.

Usage (from the repo root, with the venv active):

  # Inline:
  python -m pipeline.scripts.import_threads --city calgary \\
    --url https://www.reddit.com/r/calgary/comments/1mac8np/... \\
    --url https://www.reddit.com/r/calgaryfood/comments/.../

  # From a file (one URL per line, # for comments):
  python -m pipeline.scripts.import_threads --city calgary --urls-file threads.txt

After import, run the rest of the pipeline:
  python -m pipeline.scripts.run_pipeline --city calgary --skip-discover

Idempotent: URLs whose threads are already in the DB are skipped at the
Apify-call layer, so re-importing an overlapping list costs nothing.
"""
from __future__ import annotations

import argparse
import sys

from rich.console import Console

from pipeline.cities import CITIES
from pipeline.stages.discover import discover_threads


def main() -> int:
    parser = argparse.ArgumentParser(description="Import hand-curated Reddit thread URLs.")
    parser.add_argument("--city", required=True, help="City slug (denver / new-orleans / calgary / paris).")
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="A Reddit thread URL. Repeat the flag for multiple URLs.",
    )
    parser.add_argument(
        "--urls-file",
        help="Path to a text file with one Reddit URL per line. Lines starting with # are ignored.",
    )
    parser.add_argument(
        "--max-comments",
        type=int,
        default=50,
        help="Max comments per thread (default: 50; bumped from the discover-stage default since hand-curated threads are higher-yield).",
    )
    args = parser.parse_args()

    if args.city not in CITIES:
        print(f"Unknown city: {args.city!r}. Known: {list(CITIES)}", file=sys.stderr)
        return 1

    urls: list = list(args.url)
    if args.urls_file:
        with open(args.urls_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                urls.append(line)

    if not urls:
        print("Error: no URLs provided. Pass --url or --urls-file.", file=sys.stderr)
        return 1

    console = Console()
    console.print(f"Importing [bold]{len(urls)}[/bold] thread URL(s) for [cyan]{args.city}[/cyan]…")

    result = discover_threads(
        urls,
        city_slug=args.city,
        max_comments_per_post=args.max_comments,
    )

    console.rule("[bold]Done[/bold]")
    console.print(f"  [green]{result['threads']}[/green] new threads pulled")
    console.print(f"  [green]{result['comments']}[/green] comments saved")
    if result["skipped_existing"]:
        console.print(
            f"  [dim]{result['skipped_existing']} URL(s) already in the DB — skipped Apify[/dim]"
        )
    if result["skipped_invalid"]:
        console.print(
            f"  [yellow]{result['skipped_invalid']} URL(s) couldn't be parsed[/yellow]"
        )
    console.print()
    console.print(
        "[dim]Next: process the new threads through the pipeline:\n"
        f"  python -m pipeline.scripts.run_pipeline --city {args.city} --skip-discover[/dim]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
