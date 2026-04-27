import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * TypeScript port of pipeline/stages/score.py::compute_scores_for_city.
 *
 * Used by the /admin "Recompute scores" button so admins can refresh
 * /[city] immediately after dismissing/reassigning flags, without waiting
 * for the next Python pipeline run. Same algorithm as the pipeline:
 *
 *   food_score    = 0.75 * positive_rate + 0.25 * pos/neg_ratio_normalized
 *   service_score = same shape
 *   rank_score    = food_score * (food_n / (food_n + 5))   (Bayesian smoothing)
 *
 * If you change the formula here, change it in pipeline/stages/score.py too.
 */

type ExtractionRow = {
  restaurant_id: string | null;
  food_sentiment: "positive" | "negative" | "mixed" | null;
  service_sentiment: "positive" | "negative" | "mixed" | null;
  vote_weight: number | string;
  comment_id: string;
};

type Aggregate = {
  food_score: number | null;
  food_positive: number;
  food_negative: number;
  food_unique_users: number;
  service_score: number | null;
  service_positive: number;
  service_negative: number;
  service_unique_users: number;
  total_unique_users: number;
};

export async function computeScoresForCity(citySlug: string): Promise<number> {
  const supabase = adminClient();

  // 1. Fetch open restaurants for this city
  const { data: restaurants, error: rErr } = await supabase
    .from("restaurants")
    .select("id")
    .eq("city_slug", citySlug)
    .eq("closed", false);
  if (rErr) throw new Error(`Failed to fetch restaurants: ${rErr.message}`);
  if (!restaurants || restaurants.length === 0) return 0;

  const restaurantIds = restaurants.map((r) => r.id as string);

  // 2. Fetch all extractions linked to these restaurants. Chunk by 100 to
  //    keep the IN-clause URL under PostgREST's request-line limit.
  const extractions: ExtractionRow[] = [];
  const CHUNK = 100;
  for (let i = 0; i < restaurantIds.length; i += CHUNK) {
    const chunk = restaurantIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("extractions")
      .select("restaurant_id, food_sentiment, service_sentiment, vote_weight, comment_id")
      .in("restaurant_id", chunk);
    if (error) throw new Error(`Failed to fetch extractions: ${error.message}`);
    if (data) extractions.push(...(data as unknown as ExtractionRow[]));
  }

  // 3. Aggregate per restaurant. We keep the unique-user Sets in a parallel
  //    map so they never leak into the upsert payload — PostgREST would
  //    reject unknown columns ("Could not find the '_foodUsers' column…").
  const byRestaurant = new Map<string, Aggregate>();
  const usersByRestaurant = new Map<string, UserTracking>();
  for (const row of extractions) {
    if (!row.restaurant_id) continue;
    let agg = byRestaurant.get(row.restaurant_id);
    let users = usersByRestaurant.get(row.restaurant_id);
    if (!agg) {
      agg = newAggregate();
      byRestaurant.set(row.restaurant_id, agg);
    }
    if (!users) {
      users = { food: new Set<string>(), service: new Set<string>() };
      usersByRestaurant.set(row.restaurant_id, users);
    }
    accumulate(agg, users, row);
  }

  // Finalize: compute scores from the running totals, drop zero-volume rows.
  const scored: Array<{ restaurant_id: string } & Aggregate & { city_rank: number }> = [];
  for (const [id, agg] of byRestaurant) {
    if (agg.total_unique_users === 0) continue;
    agg.food_score = aspectScore(agg.food_positive, agg.food_negative);
    agg.service_score = aspectScore(agg.service_positive, agg.service_negative);
    scored.push({ restaurant_id: id, ...agg, city_rank: 0 });
  }

  // 4. Rank by Bayesian-smoothed food score, then total volume.
  scored.sort((a, b) => {
    const rA = rankScore(a);
    const rB = rankScore(b);
    if (rA !== rB) return rB - rA;
    return b.total_unique_users - a.total_unique_users;
  });
  scored.forEach((s, i) => {
    s.city_rank = i + 1;
  });

  // 5. Upsert into restaurant_scores. Chunk to keep the request body sane.
  if (scored.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < scored.length; i += BATCH) {
      const batch = scored.slice(i, i + BATCH);
      const { error } = await supabase
        .from("restaurant_scores")
        .upsert(batch, { onConflict: "restaurant_id" });
      if (error) throw new Error(`Failed to upsert scores: ${error.message}`);
    }
  }

  return scored.length;
}

// ---------- internals -------------------------------------------------------

type UserTracking = {
  food: Set<string>;
  service: Set<string>;
};

function newAggregate(): Aggregate {
  return {
    food_score: null,
    food_positive: 0,
    food_negative: 0,
    food_unique_users: 0,
    service_score: null,
    service_positive: 0,
    service_negative: 0,
    service_unique_users: 0,
    total_unique_users: 0,
  };
}

function accumulate(agg: Aggregate, users: UserTracking, row: ExtractionRow) {
  const w = Number(row.vote_weight) || 1.0;

  if (row.food_sentiment !== null) {
    users.food.add(row.comment_id);
    if (row.food_sentiment === "positive") agg.food_positive += w;
    else if (row.food_sentiment === "negative") agg.food_negative += w;
    else if (row.food_sentiment === "mixed") {
      agg.food_positive += w * 0.5;
      agg.food_negative += w * 0.5;
    }
  }
  if (row.service_sentiment !== null) {
    users.service.add(row.comment_id);
    if (row.service_sentiment === "positive") agg.service_positive += w;
    else if (row.service_sentiment === "negative") agg.service_negative += w;
    else if (row.service_sentiment === "mixed") {
      agg.service_positive += w * 0.5;
      agg.service_negative += w * 0.5;
    }
  }

  // Derived counts in lock-step.
  agg.food_unique_users = users.food.size;
  agg.service_unique_users = users.service.size;
  agg.total_unique_users = new Set([...users.food, ...users.service]).size;

  // Canonical 3-decimal precision (matches Python).
  agg.food_positive = round3(agg.food_positive);
  agg.food_negative = round3(agg.food_negative);
  agg.service_positive = round3(agg.service_positive);
  agg.service_negative = round3(agg.service_negative);
}

function aspectScore(positive: number, negative: number): number | null {
  const total = positive + negative;
  if (total === 0) return null;
  const rate = positive / total;
  let ratioNorm: number;
  if (negative === 0) ratioNorm = 1.0;
  else ratioNorm = Math.min(positive / negative / 5.0, 1.0);
  return round3(0.75 * rate + 0.25 * ratioNorm);
}

function rankScore(s: Aggregate): number {
  const food = s.food_score ?? 0;
  const n = s.food_unique_users;
  const smoothing = n > 0 ? n / (n + 5) : 0;
  return food * smoothing;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
