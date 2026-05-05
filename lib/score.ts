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

const TAG_STICK_THRESHOLD = 2;

type ExtractionRow = {
  restaurant_id: string | null;
  food_sentiment: "positive" | "negative" | "mixed" | null;
  service_sentiment: "positive" | "negative" | "mixed" | null;
  vote_weight: number | string;
  comment_id: string;
  tags: string[] | null;
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
  /** Distinct comments that named the place but supplied NEITHER sentiment
   *  (bare-name responses in neutral search threads — see extract.py rule 6).
   *  Volume signal only; doesn't affect food_score or service_score. */
  mention_only_users: number;
  total_unique_users: number;
  tags: string[];
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
      .select("restaurant_id, food_sentiment, service_sentiment, vote_weight, comment_id, tags")
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
      users = {
        food: new Set<string>(),
        service: new Set<string>(),
        mentionOnly: new Set<string>(),
        tagCounts: new Map<string, number>(),
      };
      usersByRestaurant.set(row.restaurant_id, users);
    }
    accumulate(agg, users, row);
  }

  // Finalize: compute scores from the running totals, drop zero-volume rows.
  const scored: Array<
    { restaurant_id: string } & Aggregate & { city_rank: number | null }
  > = [];
  for (const [id, agg] of byRestaurant) {
    if (agg.total_unique_users === 0) continue;
    agg.food_score = aspectScore(agg.food_positive, agg.food_negative);
    agg.service_score = aspectScore(agg.service_positive, agg.service_negative);
    const counts = usersByRestaurant.get(id)?.tagCounts ?? new Map();
    agg.tags = [...counts.entries()]
      .filter(([, n]) => n >= TAG_STICK_THRESHOLD)
      .map(([t]) => t)
      .sort();
    scored.push({ restaurant_id: id, ...agg, city_rank: null });
  }

  // 4. Rank by Bayesian-smoothed food score, then total volume. Restaurants
  //    whose ONLY signal is negative (zero positive on both aspects) get
  //    city_rank=null so they fall out of the public list — but we still
  //    upsert their score row so /admin can see the data.
  const rankable = scored.filter((s) => !isOnlyNegative(s));
  rankable.sort((a, b) => {
    const rA = rankScore(a);
    const rB = rankScore(b);
    if (rA !== rB) return rB - rA;
    return b.total_unique_users - a.total_unique_users;
  });
  rankable.forEach((s, i) => {
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

  return rankable.length;
}

// ---------- internals -------------------------------------------------------

type UserTracking = {
  food: Set<string>;
  service: Set<string>;
  mentionOnly: Set<string>;
  tagCounts: Map<string, number>;
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
    mention_only_users: 0,
    total_unique_users: 0,
    tags: [],
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

  // Volume-only: comment named the place but expressed no sentiment.
  // Counted in total_unique_users for rank tiebreak; surfaced on the
  // restaurant card as "+ N more mentions".
  if (row.food_sentiment === null && row.service_sentiment === null) {
    users.mentionOnly.add(row.comment_id);
  }

  for (const tag of row.tags ?? []) {
    users.tagCounts.set(tag, (users.tagCounts.get(tag) ?? 0) + 1);
  }

  // Derived counts in lock-step.
  agg.food_unique_users = users.food.size;
  agg.service_unique_users = users.service.size;
  agg.mention_only_users = users.mentionOnly.size;
  agg.total_unique_users = new Set([
    ...users.food,
    ...users.service,
    ...users.mentionOnly,
  ]).size;

  // Canonical 3-decimal precision (matches Python).
  agg.food_positive = round3(agg.food_positive);
  agg.food_negative = round3(agg.food_negative);
  agg.service_positive = round3(agg.service_positive);
  agg.service_negative = round3(agg.service_negative);
}

function isOnlyNegative(s: Aggregate): boolean {
  // Negative votes exist on at least one aspect AND zero positive votes on
  // both aspects. Mixed sentiments split 0.5 to positive, so a "mixed"
  // review keeps the restaurant rankable.
  const pos = s.food_positive + s.service_positive;
  const neg = s.food_negative + s.service_negative;
  return pos === 0 && neg > 0;
}

// Beta(α=2, β=1.5) prior — slight positive lean since Reddit mentions of a
// restaurant skew toward recommendations. Neutral prior ≈ 0.571 (~5.7 / 10).
// Mirrors pipeline/stages/score.py — keep them in sync.
const SCORE_PRIOR_ALPHA = 2.0;
const SCORE_PRIOR_BETA = 1.5;

function aspectScore(positive: number, negative: number): number | null {
  if (positive + negative === 0) return null;
  return round3(
    (positive + SCORE_PRIOR_ALPHA) /
      (positive + negative + SCORE_PRIOR_ALPHA + SCORE_PRIOR_BETA),
  );
}

function rankScore(s: Aggregate): number {
  // The Beta prior in aspectScore already shrinks low-N scores toward the
  // midline, so ranking just sorts by food_score. Volume tie-break lives
  // in the comparator.
  return s.food_score ?? 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
