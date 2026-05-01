"""Backfill `restaurants.hours` from Google Places Place-Details for rows
that don't have it yet.

The pipeline's resolve stage now requests `regularOpeningHours` for every
new restaurant, but rows that landed before the field was added need a
one-shot fetch. This script paginates over restaurants with `hours is null`
and calls Place Details for each one, then writes the JSON back.

Cost note: ~$0.02 per Place Details call at the "Atmosphere" SKU. With
~1,400 restaurants across all four cities, that's ~$28 in Google Maps API
spend, comfortably inside the $200/mo free credit.

Usage (from the repo root, with the venv active):

  python -m pipeline.scripts.backfill_hours --city denver
  python -m pipeline.scripts.backfill_hours --all
  python -m pipeline.scripts.backfill_hours --all --limit 50   # smoke test

Idempotent: rows that already have hours are skipped via the SELECT filter.
Pass `--force` to re-fetch every row regardless.
"""
from __future__ import annotations

import argparse
import sys
import time

import httpx
from rich.console import Console

from pipeline import db
from pipeline.cities import CITIES
from pipeline.config import settings


PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{placeId}"
FIELD_MASK = "id,regularOpeningHours"


def _fetch_hours(place_id: str) -> dict | None:
    """Hit Place Details for a single place and return the
    `regularOpeningHours` blob, or None if Google has no hours."""
    r = httpx.get(
        PLACE_DETAILS_URL.format(placeId=place_id),
        headers={
            "X-Goog-Api-Key": settings.google_maps_api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json().get("regularOpeningHours")


def backfill_city(
    city_slug: str,
    *,
    force: bool,
    limit: int | None,
    console: Console,
) -> dict:
    client = db.get_client()
    PAGE = 200
    offset = 0
    fetched: list[dict] = []
    while True:
        q = (
            client.table("restaurants")
            .select("id, place_id, name, hours")
            .eq("city_slug", city_slug)
            .eq("closed", False)
            .range(offset, offset + PAGE - 1)
        )
        if not force:
            q = q.is_("hours", "null")
        rows = q.execute().data or []
        fetched.extend(rows)
        if len(rows) < PAGE:
            break
        offset += PAGE
        if limit is not None and len(fetched) >= limit:
            break
    if limit is not None:
        fetched = fetched[:limit]

    if not fetched:
        console.print(f"  [dim]{city_slug}: nothing to backfill[/dim]")
        return {"checked": 0, "updated": 0, "google_empty": 0, "errors": 0}

    console.print(f"  [cyan]{city_slug}[/cyan]: {len(fetched)} restaurant(s) to fetch")

    updated = 0
    google_empty = 0
    errors = 0

    for i, row in enumerate(fetched, start=1):
        try:
            hours = _fetch_hours(row["place_id"])
        except Exception as e:
            errors += 1
            console.print(
                f"    [red]✗[/red] {row['name']!r} ({row['place_id']}): "
                f"{type(e).__name__}: {e}"
            )
            # Be polite when something starts erroring out — could be a
            # rate-limit or a transient 5xx. A short pause lets it recover
            # before we hammer the next call.
            time.sleep(0.5)
            continue

        if hours:
            client.table("restaurants").update({"hours": hours}).eq(
                "id", row["id"]
            ).execute()
            updated += 1
        else:
            google_empty += 1

        if i % 50 == 0:
            console.print(
                f"    progress: {i}/{len(fetched)}   "
                f"updated={updated} google_empty={google_empty} errors={errors}"
            )

    console.print(
        f"    [green]done[/green]: updated={updated} "
        f"no-hours-from-google={google_empty} errors={errors}"
    )
    return {
        "checked": len(fetched),
        "updated": updated,
        "google_empty": google_empty,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill restaurants.hours from Google Place Details."
    )
    parser.add_argument(
        "--city",
        action="append",
        default=[],
        help="City slug. Repeatable. Mutually exclusive with --all.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run for every configured city.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch hours even when the row already has them. "
        "Use sparingly — costs Google Places quota every time.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of rows processed per city. Useful for smoke-testing.",
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
    console.rule(
        "[bold]Backfill restaurants.hours"
        + (" (force)" if args.force else "")
        + "[/bold]"
    )
    totals = {"checked": 0, "updated": 0, "google_empty": 0, "errors": 0}
    for c in cities:
        report = backfill_city(c, force=args.force, limit=args.limit, console=console)
        for k, v in report.items():
            totals[k] += v

    console.rule("[bold]Done[/bold]")
    console.print(
        f"  Checked {totals['checked']} restaurant(s).  "
        f"Updated [green]{totals['updated']}[/green].  "
        f"No hours from Google: {totals['google_empty']}.  "
        f"Errors [red]{totals['errors']}[/red]."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
