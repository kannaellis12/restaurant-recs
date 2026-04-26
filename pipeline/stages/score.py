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

    # Rank: descending by Bayesian-smoothed food score, then by total volume.
    scored.sort(key=lambda s: (-_rank_score(s), -s["total_unique_users"]))
    for i, s in enumerate(scored, start=1):
        s["city_rank"] = i

    if scored:
        client.table("restaurant_scores").upsert(
            scored, on_conflict="restaurant_id"
        ).execute()

    return len(scored)


# ---------- internals -------------------------------------------------------


def _aggregate_for_restaurant(restaurant_id: str) -> dict:
    client = db.get_client()
    rows = (
        client.table("extractions")
        .select("food_sentiment, service_sentiment, vote_weight, comment_id")
        .eq("restaurant_id", restaurant_id)
        .execute()
        .data
        or []
    )

    food_pos = food_neg = 0.0
    service_pos = service_neg = 0.0
    food_users: set[str] = set()
    service_users: set[str] = set()

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
    }


def _aspect_score(positive: float, negative: float) -> Optional[float]:
    """RedditRecs-derived: 75% rate + 25% normalized pos/neg ratio.

    Returns None when there's no signal for this aspect (the column should
    stay NULL so the UI can show "no data" rather than 0%).
    """
    total = positive + negative
    if total == 0:
        return None
    rate = positive / total
    if negative == 0:
        ratio_norm = 1.0
    else:
        # Cap the ratio contribution at 5:1 so a single negative review
        # doesn't dominate when there are 50 positives.
        ratio_norm = min((positive / negative) / 5.0, 1.0)
    return round(0.75 * rate + 0.25 * ratio_norm, 3)


def _rank_score(s: dict) -> float:
    """Combined ranking score with Bayesian smoothing on volume.

    A restaurant with 100% food positive and 1 reviewer should NOT outrank
    one with 92% and 80 reviewers. The smoothing factor `n / (n + 5)` pulls
    low-N scores toward zero until volume builds up.
    """
    food = s.get("food_score") or 0.0
    food_n = s.get("food_unique_users") or 0
    smoothing = food_n / (food_n + 5) if food_n > 0 else 0.0
    return float(food) * smoothing
