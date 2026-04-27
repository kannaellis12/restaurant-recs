"""Backfill cuisines for restaurants that were inserted before the cuisine
inference logic existed. Re-fetches Google Places types via the Details API
and runs them through `cuisines_from_types`.

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.backfill_cuisines

Idempotent: only touches restaurants whose cuisines array is currently empty.
Each Place Details call costs a fraction of a cent at the minimal field mask.
"""
from __future__ import annotations

from typing import Optional

import httpx
from rich.console import Console

from pipeline import db
from pipeline.config import settings
from pipeline.stages.resolve import cuisines_from_types


PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"


def main() -> None:
    console = Console()
    client = db.get_client()

    # Skip closed restaurants — no point flagging things that won't render
    # on /[city] anyway.
    rows = (
        client.table("restaurants")
        .select("id, place_id, name, cuisines")
        .eq("closed", False)
        .execute()
        .data
        or []
    )
    needs = [r for r in rows if not r.get("cuisines")]
    console.print(
        f"{len(rows)} total restaurants; "
        f"[bold]{len(needs)}[/bold] need cuisine backfill."
    )
    if not needs:
        return

    n_updated = 0
    n_no_match = 0
    n_failed = 0

    for r in needs:
        types = _fetch_types(r["place_id"])
        if types is None:
            console.print(f"  [red]✗ failed[/red]   {r['name']}")
            n_failed += 1
            continue
        cuisines = cuisines_from_types(types)
        if not cuisines:
            console.print(
                f"  [yellow]? no match[/yellow] {r['name']}  "
                f"[dim]types={types}[/dim]"
            )
            db.ensure_missing_cuisine_flag(
                restaurant_id=r["id"],
                restaurant_name=r["name"],
            )
            n_no_match += 1
            continue
        client.table("restaurants").update({"cuisines": cuisines}).eq(
            "id", r["id"]
        ).execute()
        console.print(
            f"  [green]✓[/green] {r['name']:<35} "
            f"-> {', '.join(cuisines)}  [dim]({', '.join(types[:3])})[/dim]"
        )
        n_updated += 1

    console.print()
    console.print(
        f"Done. updated=[green]{n_updated}[/green]  "
        f"no_match=[yellow]{n_no_match}[/yellow]  "
        f"failed=[red]{n_failed}[/red]"
    )
    if n_no_match:
        console.print(
            "[dim]No-match rows had Places types that don't map to any of our "
            "26 cuisines (e.g. 'restaurant', 'food'). Tag them by hand in /admin "
            "once the manual UI exists, or extend PLACES_TYPE_TO_CUISINE.[/dim]"
        )


def _fetch_types(place_id: str) -> Optional[list]:
    """Returns the Place's `types` array, or None on failure."""
    try:
        r = httpx.get(
            f"{PLACES_DETAILS_URL}/{place_id}",
            headers={
                "X-Goog-Api-Key": settings.google_maps_api_key,
                "X-Goog-FieldMask": "types",
            },
            timeout=15,
        )
        if not r.is_success:
            return None
        return r.json().get("types") or []
    except httpx.HTTPError:
        return None


if __name__ == "__main__":
    main()
