"""Backfill `restaurants.neighborhood` from Google's addressComponents.

For every open restaurant with a null neighborhood, fetch Place Details
(addressComponents) from Google and pick the best neighborhood-ish name.

Why this matters: most Reddit comments don't mention a neighborhood
explicitly, so the pipeline's extraction.neighborhood_hint is null for
most extractions. The earlier upsert path passed null straight through,
leaving restaurants.neighborhood empty even when Google could have told us.

Idempotent: only touches rows where neighborhood IS NULL.

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.backfill_neighborhoods
"""
from __future__ import annotations

from typing import Optional

import httpx
from rich.console import Console

from pipeline import db
from pipeline.config import settings
from pipeline.stages.resolve import neighborhood_from_components


PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"


def main() -> None:
    console = Console()
    client = db.get_client()

    rows = (
        client.table("restaurants")
        .select("id, place_id, name, neighborhood")
        .is_("neighborhood", "null")
        .eq("closed", False)
        .execute()
        .data
        or []
    )
    console.print(f"{len(rows)} open restaurants are missing neighborhood.")

    n_filled = 0
    n_no_data = 0
    n_failed = 0

    for r in rows:
        components = _fetch_components(r["place_id"])
        if components is None:
            console.print(f"  [red]✗ failed[/red]   {r['name']}")
            n_failed += 1
            continue
        derived = neighborhood_from_components(components)
        if not derived:
            console.print(
                f"  [yellow]? no data[/yellow] {r['name']:<40} "
                f"[dim](no neighborhood/sublocality in Google's components)[/dim]"
            )
            n_no_data += 1
            continue
        client.table("restaurants").update({"neighborhood": derived}).eq(
            "id", r["id"]
        ).execute()
        console.print(f"  [green]✓[/green] {r['name']:<40} -> {derived}")
        n_filled += 1

    console.print()
    console.print(
        f"Done. filled=[green]{n_filled}[/green]  "
        f"no_data=[yellow]{n_no_data}[/yellow]  "
        f"failed=[dim]{n_failed}[/dim]"
    )


def _fetch_components(place_id: str) -> Optional[list]:
    try:
        r = httpx.get(
            f"{PLACES_DETAILS_URL}/{place_id}",
            headers={
                "X-Goog-Api-Key": settings.google_maps_api_key,
                "X-Goog-FieldMask": "addressComponents",
            },
            timeout=15,
        )
        if not r.is_success:
            return None
        return r.json().get("addressComponents") or []
    except httpx.HTTPError:
        return None


if __name__ == "__main__":
    main()
