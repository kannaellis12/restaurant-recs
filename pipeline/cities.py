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
        # Added for ingestion via hand-curated threads. Not yet in lib/cities.ts
        # (the frontend city list) — they stay unpublished until they have
        # restaurant data so the homepage doesn't show empty cities. Stockholm
        # and Tallinn ride on English-language threads, so language="en".
        City("stockholm", "Stockholm", "Sweden", "en", 18.0686, 59.3293),
        City("tallinn", "Tallinn", "Estonia", "en", 24.7536, 59.4370),
        City("seattle", "Seattle", "USA", "en", -122.3321, 47.6062),
        City("omaha", "Omaha", "USA", "en", -95.9345, 41.2565),
        # Brooklyn is a NYC borough, not a standalone city, but it has enough of
        # its own restaurant discussion to stand alone here. Center on the
        # borough rather than all of NYC.
        City("brooklyn", "Brooklyn", "USA", "en", -73.9442, 40.6782),
        City("austin", "Austin", "USA", "en", -97.7431, 30.2672),
    ]
}
