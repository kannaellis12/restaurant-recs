"""City config for the pipeline.

Mirrors lib/cities.ts. Kept in two places (TS for the frontend, Python here)
because both run in different environments. Cities are also seeded into the
DB via the migration (supabase/migrations/0001_init.sql), so the DB is the
ultimate source of truth — but we keep these in code for offline use during
pipeline runs that don't need a DB hit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class City:
    slug: str
    name: str
    country: str
    language: Literal["en", "fr"]
    center_lng: float
    center_lat: float


CITIES: dict[str, City] = {
    c.slug: c
    for c in [
        City("denver", "Denver", "USA", "en", -104.9903, 39.7392),
        City("new-orleans", "New Orleans", "USA", "en", -90.0715, 29.9511),
        City("calgary", "Calgary", "Canada", "en", -114.0719, 51.0447),
        City("paris", "Paris", "France", "fr", 2.3522, 48.8566),
    ]
}
