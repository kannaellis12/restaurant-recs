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
        "places.businessStatus",
        "places.addressComponents",
    ]
)


# Address-component types we'll accept as a "neighborhood", in priority order.
# `neighborhood` is most specific; `sublocality_level_1` is the common fallback
# in cities where Google doesn't tag explicit neighborhoods. `sublocality`
# itself is a coarser parent — last resort.
_NEIGHBORHOOD_TYPES = ("neighborhood", "sublocality_level_1", "sublocality")

# Google Places Text Search API price-level enum -> our integer scale.
PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": 1,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


# Place types where the food isn't the point — Google Places returns these
# when someone evaluates food *at* the venue (e.g. concession stands at an
# amusement park) but the venue itself isn't a restaurant. We reject these.
NON_RESTAURANT_TYPES = {
    "amusement_park",
    "stadium",
    "park",
    "airport",
    "shopping_mall",
    "museum",
    "tourist_attraction",  # debatable; many tourist spots aren't food-focused
    "gas_station",
    "convenience_store",
    "gym",
    "spa",
    "school",
    "university",
    "hospital",
    "lodging",  # hotel — drop unless restaurant is also in types (handled below)
}

# These are "ok" types — if a place has both a denied type AND an allowed type,
# it's probably a restaurant inside a hotel/mall (the food IS the point) and
# we keep it.
RESTAURANT_TYPES = {
    "restaurant",
    "cafe",
    "bakery",
    "bar",
    "bar_and_grill",
    "fast_food_restaurant",
    "meal_takeaway",
    "meal_delivery",
    "food",
    "ice_cream_shop",
    "coffee_shop",
    "pizza_restaurant",
    "sandwich_shop",
    "deli",
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
    # Drop candidates whose place type isn't food-focused (amusement parks,
    # museums, etc.). Hotels and malls survive only if a restaurant-y type is
    # also present (the food IS the point inside them).
    candidates = [c for c in candidates if _is_food_place(c.types)]

    if not candidates:
        return ResolveResult(
            mention=mention,
            city_slug=city_slug,
            neighborhood_hint=neighborhood_hint,
            method="no_match",
            confidence=0.0,
            reasoning=(
                f"All Google results for {query!r} were non-food venues "
                "(amusement park / museum / etc.)."
            ),
        )

    # Drop permanently-closed places. Temporarily closed (CLOSED_TEMPORARILY)
    # are kept — they may reopen and we still want the historical signal.
    candidates = [
        c for c in candidates if c.business_status != "CLOSED_PERMANENTLY"
    ]
    if not candidates:
        return ResolveResult(
            mention=mention,
            city_slug=city_slug,
            neighborhood_hint=neighborhood_hint,
            method="no_match",
            confidence=0.0,
            reasoning=(
                f"All Google results for {query!r} are permanently closed."
            ),
        )

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
            # NOTE: do NOT pass `includedType: "restaurant"` here — Google
            # Places categorizes many actual food spots as cafe / bakery /
            # bar_and_grill / meal_takeaway / etc. Filtering to "restaurant"
            # silently drops legitimate matches (we saw this with Fruition,
            # Noble Pig, Wolf's Tacos in the first Denver run).
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
        business_status=place.get("businessStatus"),
        derived_neighborhood=neighborhood_from_components(place.get("addressComponents")),
    )


def neighborhood_from_components(components: Optional[list]) -> Optional[str]:
    """Pick the best neighborhood-ish name out of Google's addressComponents.

    Prefers more specific types (`neighborhood`) over coarser ones
    (`sublocality_level_1`, `sublocality`). Returns None if none found —
    common in cities/areas where Google doesn't tag neighborhood data.
    """
    if not components:
        return None
    by_type: dict = {}
    for c in components:
        types = c.get("types") or []
        for t in types:
            if t in _NEIGHBORHOOD_TYPES and t not in by_type:
                by_type[t] = c.get("longText") or c.get("shortText")
    for t in _NEIGHBORHOOD_TYPES:
        val = by_type.get(t)
        if val:
            return val
    return None


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


def _is_food_place(types: list[str]) -> bool:
    """True if the candidate looks like somewhere people go to eat.

    Logic:
      - If any restaurant-y type is present, accept (handles hotel restaurants).
      - Else if any non-restaurant type is present, reject.
      - Else accept (Google returned a result with no useful types).
    """
    type_set = set(types or [])
    if type_set & RESTAURANT_TYPES:
        return True
    if type_set & NON_RESTAURANT_TYPES:
        return False
    return True


# ---------------------------------------------------------------------------
# Cuisine inference from Google Places types
#
# Google's place types are pretty well-aligned with our 26-cuisine taxonomy
# (lib/cuisines.ts). We translate them at upsert time so the frontend can
# filter restaurants by cuisine immediately. Restaurants that match no entry
# below get cuisines = [] and can be hand-tagged in /admin (later) or
# inferred via LLM (also later).
# ---------------------------------------------------------------------------

PLACES_TYPE_TO_CUISINE: dict[str, str] = {
    # American
    "american_restaurant":      "american-casual",
    "diner":                    "american-casual",
    "fast_food_restaurant":     "american-casual",
    "hamburger_restaurant":     "american-casual",
    # BBQ
    "barbecue_restaurant":      "bbq",
    # Steakhouse
    "steak_house":              "steakhouse",
    # Butcher / Charcuterie (whole cuts, prep — like Butchers at RiNo)
    "butcher_shop":             "butcher",
    # Deli (sandwiches + cured meats — like Carmine Lonardo's, NY-style delis)
    "deli":                     "deli",
    # Pizza
    "pizza_restaurant":         "pizza",
    # Italian
    "italian_restaurant":       "italian",
    # French (also captures bistros/brasseries Google buckets here)
    "french_restaurant":        "french",
    # Mexican / Latin
    "mexican_restaurant":       "mexican",
    "taco_restaurant":          "mexican",
    # Caribbean / Latin variants — Google's type set is sparse here.
    # `caribbean_restaurant` is the most likely to actually appear; the
    # rest (Venezuelan, Honduran) tend to be tagged generically by Google
    # and end up admin-assigned via the missing_cuisine queue.
    "caribbean_restaurant":     "caribbean",
    # Mediterranean / Greek
    "mediterranean_restaurant": "mediterranean",
    "greek_restaurant":         "mediterranean",
    # Spanish / Tapas
    "spanish_restaurant":       "spanish",
    # Middle Eastern
    "middle_eastern_restaurant": "middle-eastern",
    "lebanese_restaurant":      "middle-eastern",
    "turkish_restaurant":       "middle-eastern",
    # East Asian
    "chinese_restaurant":       "chinese",
    "japanese_restaurant":      "japanese",
    "sushi_restaurant":         "japanese",
    "ramen_restaurant":         "ramen",
    "korean_restaurant":        "korean",
    "thai_restaurant":          "thai",
    "vietnamese_restaurant":    "vietnamese",
    # South Asian
    "indian_restaurant":        "indian",
    # Filipino
    "filipino_restaurant":      "filipino",
    # African
    "african_restaurant":       "ethiopian-african",
    # Seafood
    "seafood_restaurant":       "seafood",
    # Vegetarian / Vegan
    "vegetarian_restaurant":    "vegetarian-vegan",
    "vegan_restaurant":         "vegetarian-vegan",
    # Brunch / Breakfast
    "breakfast_restaurant":     "brunch-breakfast",
    "brunch_restaurant":        "brunch-breakfast",
    # Bakery / Cafe / Dessert
    "bakery":                   "bakery-cafe-dessert",
    "cafe":                     "bakery-cafe-dessert",
    "coffee_shop":              "bakery-cafe-dessert",
    "ice_cream_shop":           "bakery-cafe-dessert",
    "dessert_shop":             "bakery-cafe-dessert",
    "donut_shop":               "bakery-cafe-dessert",
    # Markets / Food halls (food courts, public markets — distinct from
    # full-service restaurants; many have stalls people specifically rec).
    "market":                   "market",
    "food_court":               "market",
    # Cocktails (Google's type set is sparse here — admin will tag most
    # cocktail bars manually via the /admin restaurant editor).
    "cocktail_bar":             "cocktails",
    # Bar / Gastropub
    "bar":                      "bar-gastropub",
    "bar_and_grill":            "bar-gastropub",
    "pub":                      "bar-gastropub",
    # Brewery — has its own vibe (taproom-first, beer-driven menu) that
    # bar/gastropub doesn't quite capture. Splits out per admin feedback.
    "brewery":                  "brewery",
    # Winery — wine-led venue, distinct from a generic bar/gastropub.
    "winery":                   "winery",
    "wine_bar":                 "winery",
}


def cuisines_from_types(types: Optional[list]) -> list:
    """Map a Google Places `types` list to our cuisine slugs.

    Returns up to 3 distinct cuisine slugs in the order they appear in
    Google's response (their first type tends to be most specific).
    """
    if not types:
        return []
    seen: set = set()
    out: list = []
    for t in types:
        slug = PLACES_TYPE_TO_CUISINE.get(t)
        if slug and slug not in seen:
            seen.add(slug)
            out.append(slug)
            if len(out) >= 3:
                break
    return out


def _normalize(s: str) -> str:
    s = s.lower().strip()
    for ch in [",", ".", "'", "’", "&", "-"]:
        s = s.replace(ch, " ")
    return " ".join(s.split())


def reresolve_unresolved_extractions(city_slug: str) -> dict:
    """Retry resolution for extractions in this city that previously failed.

    Useful after tuning the resolver: old `restaurant_id IS NULL` extractions
    get a second chance against the new logic. Successful retries:
      - upsert the matched restaurant
      - patch the extraction's restaurant_id, confidence, method, vote_weight
      - mark any open flags for that extraction as resolved

    Returns counts: {checked, resolved, still_failed}.
    """
    # Local import to avoid a resolve <-> db circular import at module load.
    from pipeline import db

    client = db.get_client()

    # Walk threads → comments → extractions to find unresolved ones for this city.
    threads = (
        client.table("reddit_threads")
        .select("id")
        .eq("city_slug", city_slug)
        .execute()
        .data
        or []
    )
    if not threads:
        return {"checked": 0, "resolved": 0, "still_failed": 0}
    thread_ids = [t["id"] for t in threads]

    # Walk in chunks: PostgREST puts IN-clause values in the URL, and a few
    # hundred UUIDs blows past Supabase's request line limit.
    def _chunked(seq, size):
        for i in range(0, len(seq), size):
            yield seq[i : i + size]

    comment_ids: list[str] = []
    for chunk in _chunked(thread_ids, 100):
        rows = (
            client.table("reddit_comments")
            .select("id")
            .in_("thread_id", chunk)
            .execute()
            .data
            or []
        )
        comment_ids.extend(c["id"] for c in rows)
    if not comment_ids:
        return {"checked": 0, "resolved": 0, "still_failed": 0}

    unresolved: list[dict] = []
    for chunk in _chunked(comment_ids, 100):
        rows = (
            client.table("extractions")
            .select("id, mention_text, neighborhood_hint")
            .is_("restaurant_id", "null")
            .in_("comment_id", chunk)
            .execute()
            .data
            or []
        )
        unresolved.extend(rows)

    n_resolved = 0
    n_still = 0
    for ext in unresolved:
        result = resolve_mention(
            ext["mention_text"], city_slug, ext.get("neighborhood_hint")
        )
        db.insert_place_resolution(
            mention=ext["mention_text"],
            city_slug=city_slug,
            candidate_place_id=result.candidate.place_id if result.candidate else None,
            confidence=result.confidence,
            method=result.method,
            reasoning=result.reasoning,
        )
        if result.candidate and result.confidence >= 0.6:
            neighborhood = (
                ext.get("neighborhood_hint") or result.candidate.derived_neighborhood
            )
            rest_id = db.upsert_restaurant(
                candidate=result.candidate,
                city_slug=city_slug,
                neighborhood=neighborhood,
                cuisines=cuisines_from_types(result.candidate.types),
            )
            client.table("extractions").update(
                {
                    "restaurant_id": rest_id,
                    "resolution_confidence": result.confidence,
                    "resolution_method": result.method,
                    "vote_weight": db._vote_weight(result),
                }
            ).eq("id", ext["id"]).execute()
            client.table("flags").update({"status": "resolved"}).eq(
                "extraction_id", ext["id"]
            ).eq("status", "open").execute()
            n_resolved += 1
        else:
            n_still += 1

    return {"checked": len(unresolved), "resolved": n_resolved, "still_failed": n_still}
