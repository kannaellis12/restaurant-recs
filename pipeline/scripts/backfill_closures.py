"""Refresh businessStatus for every restaurant we have, marking permanently-
closed ones as `closed=true` so they drop off /[city].

Usage (from the repo root, with the venv active):
    python -m pipeline.scripts.backfill_closures

Idempotent: only writes when status actually says CLOSED_PERMANENTLY and the
row isn't already closed. Each Place Details call is a fraction of a cent at
the minimal field mask (`id,businessStatus`).

Why this script exists separately from the pipeline run: we added
businessStatus to the resolver field mask after a number of restaurants were
already in the DB (notably Fruition, which Google reports closed as of
2025-01-12). This catches them up.
"""
from __future__ import annotations

from typing import Optional

import httpx
from rich.console import Console

from pipeline import db
from pipeline.config import settings


PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places"


def main() -> None:
    console = Console()
    client = db.get_client()

    rows = (
        client.table("restaurants")
        .select("id, place_id, name, closed")
        .eq("closed", False)
        .execute()
        .data
        or []
    )
    console.print(f"Checking businessStatus for {len(rows)} open restaurants.")

    n_closed = 0
    n_temp = 0
    n_failed = 0
    n_open = 0

    for r in rows:
        status = _fetch_status(r["place_id"])
        if status is None:
            console.print(f"  [red]✗ failed[/red]   {r['name']}")
            n_failed += 1
            continue
        if status == "CLOSED_PERMANENTLY":
            client.table("restaurants").update({"closed": True}).eq(
                "id", r["id"]
            ).execute()
            console.print(
                f"  [red]☒ closed[/red]   {r['name']:<35} [dim]{status}[/dim]"
            )
            n_closed += 1
        elif status == "CLOSED_TEMPORARILY":
            console.print(
                f"  [yellow]~ temp[/yellow]    {r['name']:<35} [dim]{status}[/dim]"
            )
            n_temp += 1
        else:
            n_open += 1

    console.print()
    console.print(
        f"Done. open=[green]{n_open}[/green]  "
        f"closed_permanently=[red]{n_closed}[/red]  "
        f"closed_temporarily=[yellow]{n_temp}[/yellow]  "
        f"failed=[dim]{n_failed}[/dim]"
    )
    if n_temp:
        console.print(
            "[dim]Temporarily-closed places aren't auto-marked — they may "
            "reopen. Decide per-row in /admin if needed.[/dim]"
        )


def _fetch_status(place_id: str) -> Optional[str]:
    try:
        r = httpx.get(
            f"{PLACES_DETAILS_URL}/{place_id}",
            headers={
                "X-Goog-Api-Key": settings.google_maps_api_key,
                "X-Goog-FieldMask": "businessStatus",
            },
            timeout=15,
        )
        if not r.is_success:
            return None
        return r.json().get("businessStatus")
    except httpx.HTTPError:
        return None


if __name__ == "__main__":
    main()
