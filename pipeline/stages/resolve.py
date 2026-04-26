"""Resolve stage — turn a free-form restaurant mention into a Google Places ID.

This is the canonical name resolution step. Inputs are extracted from Reddit
comments by the upstream `extract` stage (e.g. mention="Sushi Den",
neighborhood_hint="Platt Park"). Outputs are PlaceIDs the pipeline can use
as stable restaurant identities.

Confidence heuristic (kept simple for v1; will be tuned with real data):

  * 1 search result, name matches mention                 -> 0.95
  * 1 search result, name doesn't match closely           -> 0.65
  * Multiple results, top name matches mention            -> 0.80
  * Multiple results, top name doesn't match              -> 0.45  (ambiguous)
  * 0 results                                             -> 0.00  (no_match)

Anything < 0.60 routes to the admin queue per the
`ResolveResult.needs_review` property.
"""
from __future__ import annotations

from typing import Optional

import httpx

from pipeline.cities import CITIES
from pipeline.config import settings
from pipeline.models import PlaceCandidate, ResolveResult


PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# Field mask: only request fields we actually use. Cuts API cost.
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.priceLevel",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
        "places.types",
    ]
)

# Google Places Text Search API price-level enum -> our integer scale.
PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": 1,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


def resolve_mention(
    mention: str,
    city_slug: str,
    neighborhood_hint: Optional[str] = None,
    *,
    max_candidates: int = 5,
    radius_m: int = 50_000,
) -> ResolveResult:
    """Resolve a single mention against Google Places."""
    if city_slug not in CITIES:
        raise ValueError(f"Unknown city_slug: {city_slug!r}")
    city = CITIES[city_slug]

    # Build a query that biases toward the right place. Including the city
    # name + neighborhood inside the textQuery (in addition to locationBias)
    # markedly improves precision on common names like "Joe's Pizza".
    query_parts: list[str] = [mention]
    if neighborhood_hint:
        query_parts.append(neighborhood_hint)
    query_parts.append(city.name)
    query = ", ".join(query_parts)

    try:
        places = _search_places(
            query=query,
            lat=city.center_lat,
            lng=city.center_lng,
            radius_m=radius_m,
            max_results=max_candidates,
        )
    except httpx.HTTPStatusError as e:
        return ResolveResult(
            mention=mention,
            city_slug=city_slug,
            neighborhood_hint=neighborhood_hint,
            method="no_match",
            confidence=0.0,
            reasoning=f"Google Places API error: {e.response.status_code} {e.response.text[:200]}",
        )

    if not places:
        return ResolveResult(
            mention=mention,
            city_slug=city_slug,
            neighborhood_hint=neighborhood_hint,
            method="no_match",
            confidence=0.0,
            reasoning=f"No Google Places results for query: {query!r}",
        )

    candidates = [_to_candidate(p) for p in places]
    top = candidates[0]

    name_matches = _names_overlap(mention, top.name)

    if len(candidates) == 1:
        if name_matches:
            confidence = 0.95
            reasoning = "Single match; mention overlaps result name."
        else:
            confidence = 0.65
            reasoning = (
                f"Single match {top.name!r}, but it does not closely match "
                f"the mention {mention!r}."
            )
        return ResolveResult(
            mention=mention,
            city_slug=city_slug,
            neighborhood_hint=neighborhood_hint,
            method="search",
            confidence=confidence,
            candidate=top,
            reasoning=reasoning,
        )

    # Multiple candidates
    if name_matches:
        confidence = 0.80
        reasoning = (
            f"{len(candidates)} matches; top result {top.name!r} overlaps "
            f"mention. Alternatives are likely other locations or unrelated."
        )
    else:
        confidence = 0.45
        reasoning = (
            f"{len(candidates)} matches; top result {top.name!r} does not "
            f"closely overlap mention {mention!r}. Routing to admin queue."
        )

    return ResolveResult(
        mention=mention,
        city_slug=city_slug,
        neighborhood_hint=neighborhood_hint,
        method="search",
        confidence=confidence,
        candidate=top,
        alternatives=candidates[1:],
        reasoning=reasoning,
    )


def _search_places(
    *,
    query: str,
    lat: float,
    lng: float,
    radius_m: int,
    max_results: int,
) -> list[dict]:
    """Call the Google Places Text Search v1 endpoint."""
    r = httpx.post(
        PLACES_TEXT_SEARCH_URL,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.google_maps_api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        },
        json={
            "textQuery": query,
            "locationBias": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": radius_m,
                }
            },
            "maxResultCount": max_results,
            # Restaurants only — drops chains' headquarters, retail stores, etc.
            "includedType": "restaurant",
        },
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("places", [])


def _to_candidate(place: dict) -> PlaceCandidate:
    loc = place.get("location") or {}
    display = place.get("displayName") or {}
    return PlaceCandidate(
        place_id=place["id"],
        name=display.get("text", "") or "",
        address=place.get("formattedAddress"),
        lat=loc.get("latitude", 0.0),
        lng=loc.get("longitude", 0.0),
        price_level=PRICE_LEVEL_MAP.get(place.get("priceLevel")),
        website=place.get("websiteUri"),
        types=place.get("types") or [],
        google_rating=place.get("rating"),
        google_review_ct=place.get("userRatingCount"),
    )


def _names_overlap(mention: str, place_name: str) -> bool:
    """Loose check that two names refer to the same thing.

    True when either name is a substring of the other after lowercasing and
    stripping common punctuation. Intentionally permissive — false positives
    are caught by manual review when confidence is low; false negatives would
    silently drop legitimate matches.
    """
    a = _normalize(mention)
    b = _normalize(place_name)
    if not a or not b:
        return False
    return a in b or b in a


def _normalize(s: str) -> str:
    s = s.lower().strip()
    for ch in [",", ".", "'", "’", "&", "-"]:
        s = s.replace(ch, " ")
    return " ".join(s.split())
