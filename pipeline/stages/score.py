"""Score stage — aggregate extractions into per-restaurant scores.

For each restaurant in a city:
  - food_score = 0.75 * positive_rate + 0.25 * pos_neg_ratio_normalized
  - service_score = same shape
  - food_unique_users = distinct comments that supplied a food sentiment
  - service_unique_users = distinct comments that supplied a service sentiment
  - total_unique_users = distinct comments touching either aspect

Then sort restaurants by a Bayesian-smoothed food score (penalizes "100% liked
it" with N=1 against e.g. "92% liked it" with N=80) and write city_rank.

Idempotent: upserts into `restaurant_scores` keyed on restaurant_id.

Note on "unique users": we use comment_id as the proxy because the same
Reddit user posting multiple comments would still produce multiple
extractions tied to different comments. Tying back to comment.author for
true per-author dedup is a future refinement.
"""
from __future__ import annotations

from typing import Optional

from pipeline import db


# ---------- public API ------------------------------------------------------


def compute_scores_for_city(city_slug: str) -> int:
    """Recompute and persist scores for every restaurant in a city.

    Returns the number of restaurants scored.
    """
    client = db.get_client()
    restaurants = (
        client.table("restaurants")
        .select("id")
        .eq("city_slug", city_slug)
        .eq("closed", False)
        .execute()
    )

    scored: list[dict] = []
    for r in restaurants.data or []:
        agg = _aggregate_for_restaurant(r["id"])
        if agg["total_unique_users"] == 0:
            # No extractions touch this restaurant — skip; we'd otherwise
            # write a row of zeros that ranks dead-last and clutters the UI.
            continue
        scored.append({"restaurant_id": r["id"], **agg})

    # Restaurants whose ONLY signal is negative (no positive votes on either
    # aspect) get city_rank=NULL so they fall out of the public list. The
    # row stays so /admin can still inspect them, and they'll auto-reappear
    # once a positive mention surfaces in a later pipeline run.
    rankable = [s for s in scored if not _is_only_negative(s)]
    rankable.sort(key=lambda s: (-_rank_score(s), -s["total_unique_users"]))
    for i, s in enumerate(rankable, start=1):
        s["city_rank"] = i
    for s in scored:
        if _is_only_negative(s):
            s["city_rank"] = None

    if scored:
        client.table("restaurant_scores").upsert(
            scored, on_conflict="restaurant_id"
        ).execute()

    return len(rankable)


# ---------- internals -------------------------------------------------------


TAG_STICK_THRESHOLD = 2  # Min extractions that must reference a tag for it to stick.


def _aggregate_for_restaurant(restaurant_id: str) -> dict:
    client = db.get_client()
    rows = (
        client.table("extractions")
        .select("food_sentiment, service_sentiment, vote_weight, comment_id, tags")
        .eq("restaurant_id", restaurant_id)
        .execute()
        .data
        or []
    )

    food_pos = food_neg = 0.0
    service_pos = service_neg = 0.0
    food_users: set[str] = set()
    service_users: set[str] = set()
    tag_counts: dict[str, int] = {}

    for row in rows:
        w = float(row.get("vote_weight") or 1.0)
        comment_id = row["comment_id"]

        food = row.get("food_sentiment")
        if food is not None:
            food_users.add(comment_id)
            if food == "positive":
                food_pos += w
            elif food == "negative":
                food_neg += w
            elif food == "mixed":
                food_pos += w * 0.5
                food_neg += w * 0.5

        service = row.get("service_sentiment")
        if service is not None:
            service_users.add(comment_id)
            if service == "positive":
                service_pos += w
            elif service == "negative":
                service_neg += w
            elif service == "mixed":
                service_pos += w * 0.5
                service_neg += w * 0.5

        for tag in (row.get("tags") or []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    sticky_tags = sorted(
        t for t, n in tag_counts.items() if n >= TAG_STICK_THRESHOLD
    )

    return {
        "food_score":           _aspect_score(food_pos, food_neg),
        "food_positive":        round(food_pos, 3),
        "food_negative":        round(food_neg, 3),
        "food_unique_users":    len(food_users),
        "service_score":        _aspect_score(service_pos, service_neg),
        "service_positive":     round(service_pos, 3),
        "service_negative":     round(service_neg, 3),
        "service_unique_users": len(service_users),
        "total_unique_users":   len(food_users | service_users),
        "tags":                 sticky_tags,
    }


SCORE_PRIOR_ALPHA = 2.0   # Pseudo-positive votes baked in.
SCORE_PRIOR_BETA = 1.5    # Pseudo-negative votes baked in.
# Neutral prior = α / (α + β) ≈ 0.571 (~5.7 on the displayed 0–10 scale).
# The slight positive lean reflects that most Reddit mentions of a
# restaurant are recommendations rather than pans, so a single mention
# with no other context should land slightly above the midline.


def _aspect_score(positive: float, negative: float) -> Optional[float]:
    """Beta(α=2, β=1.5)-smoothed positive rate, returned in [0, 1].

    Returns None when there's no signal at all (caller renders "no data").
    Otherwise:
      - 1 positive, 0 negative → 0.667 (~6.7 on the 0–10 scale)
      - 50 positive, 0 negative → 0.972 (~9.7)
      - 1 negative, 0 positive → 0.444 (~4.4)
      - 50 negative, 0 positive → 0.037 (~0.4)
      - 5 positive, 5 negative → 0.519 (~5.2)
    Reaching 1.0 or 0.0 is effectively impossible at any sample size,
    which keeps the displayed score honest about confidence.
    """
    if positive + negative == 0:
        return None
    return round(
        (positive + SCORE_PRIOR_ALPHA)
        / (positive + negative + SCORE_PRIOR_ALPHA + SCORE_PRIOR_BETA),
        3,
    )


def _is_only_negative(s: dict) -> bool:
    """True when a restaurant has negative votes but zero positive votes on
    BOTH aspects — i.e. every Reddit mention was a pan. We keep these rows
    in restaurant_scores (admin needs visibility) but null out city_rank so
    the public list filter excludes them.

    Mixed sentiments contribute 0.5 to positive, so a "mixed" review keeps
    a restaurant rankable.
    """
    food_pos = float(s.get("food_positive") or 0)
    service_pos = float(s.get("service_positive") or 0)
    food_neg = float(s.get("food_negative") or 0)
    service_neg = float(s.get("service_negative") or 0)
    return (food_pos + service_pos) == 0 and (food_neg + service_neg) > 0


def _rank_score(s: dict) -> float:
    """Sort key for the ranked list. The Beta prior in `_aspect_score` already
    pulls low-N scores toward the midline, so the rank score is just the
    food score itself. Total-volume tie-breaks live in the sort tuple.
    """
    return float(s.get("food_score") or 0.0)
