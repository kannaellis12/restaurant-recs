"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/supabase-admin";
import { CITIES_BY_SLUG } from "@/lib/cities";
import { cuisinesFromTypes } from "@/lib/cuisine-inference";
import { fetchPlaceById, searchPlaces, type PlaceLite } from "@/lib/google-places";

const AUTH_COOKIE = "admin-auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type LoginState = { error?: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { error: "ADMIN_PASSWORD not configured on the server." };
  }
  if (password !== expected) {
    return { error: "Wrong password." };
  }
  const c = await cookies();
  c.set(AUTH_COOKIE, password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const c = await cookies();
  c.delete(AUTH_COOKIE);
  redirect("/admin");
}

/**
 * Mark a flag as resolved (no other state changes — caller has decided the
 * resolver's guess is correct, or fixed it manually elsewhere).
 */
export async function resolveFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  if (!flagId) return;
  await adminClient()
    .from("flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);
  revalidatePath("/admin");
}

/**
 * Search Google Places (city-biased) to find candidates the admin can pick
 * from when reassigning a low-confidence flag. Returns up to 5 results.
 */
export async function searchPlacesForReassign(
  citySlug: string,
  query: string,
): Promise<PlaceLite[]> {
  const city = CITIES_BY_SLUG[citySlug];
  if (!city) throw new Error(`Unknown city slug: ${citySlug}`);
  if (!query.trim()) return [];
  return searchPlaces(query.trim(), city.center, { max: 5 });
}

/**
 * Reassign a low-confidence flag to a different (admin-chosen) restaurant.
 *
 * Steps:
 *   1. Look up the flag's extraction + city
 *   2. Fetch the chosen Place's details
 *   3. Upsert the restaurant row (via the upsert_restaurant Postgres RPC)
 *   4. Patch the extraction's restaurant_id, vote_weight=1.0, method=manual
 *   5. Resolve the flag
 */
export async function reassignFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  const placeId = String(formData.get("placeId") ?? "");
  if (!flagId || !placeId) return;

  const supabase = adminClient();

  const { data: flag } = await supabase
    .from("flags")
    .select(
      "id, extraction_id, extraction:extractions ( neighborhood_hint, comment:reddit_comments ( thread:reddit_threads ( city_slug ) ) )",
    )
    .eq("id", flagId)
    .single();

  if (!flag?.extraction_id) {
    throw new Error("Flag has no extraction to reassign.");
  }

  // Walk the embed shape; supabase-js without generated types can't infer
  // one-vs-many on nested embeds so we cast.
  const ext = flag.extraction as unknown as {
    neighborhood_hint: string | null;
    comment: { thread: { city_slug: string } | null } | null;
  } | null;
  const citySlug = ext?.comment?.thread?.city_slug;
  if (!citySlug) throw new Error("Could not determine city for this flag.");

  const place = await fetchPlaceById(placeId);
  const cuisines = cuisinesFromTypes(place.types);

  // Upsert restaurant via the Postgres RPC. Returns the restaurant uuid.
  const { data: restaurantId, error: rpcErr } = await supabase.rpc(
    "upsert_restaurant",
    {
      p_place_id: place.placeId,
      p_name: place.name,
      p_city_slug: citySlug,
      p_lng: place.lng,
      p_lat: place.lat,
      p_neighborhood: ext?.neighborhood_hint ?? null,
      p_address: place.address,
      p_website: place.website,
      p_price_level: place.priceLevel,
      p_google_rating: place.rating,
      p_google_review_ct: place.reviewCount,
      p_cuisines: cuisines,
    },
  );
  if (rpcErr) throw new Error(`upsert_restaurant failed: ${rpcErr.message}`);

  await supabase
    .from("extractions")
    .update({
      restaurant_id: restaurantId,
      resolution_confidence: 1.0,
      resolution_method: "manual",
      vote_weight: 1.0,
    })
    .eq("id", flag.extraction_id);

  await supabase
    .from("flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}

/**
 * Assign cuisines to a restaurant flagged with `kind = missing_cuisine`.
 * The form sends one or more `cuisines` entries (max 3, validated client-
 * side) plus the flag id. We update the restaurant row and resolve the flag.
 */
export async function assignCuisines(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  const cuisines = formData
    .getAll("cuisines")
    .map(String)
    .filter(Boolean)
    .slice(0, 3);
  if (!flagId || cuisines.length === 0) return;

  const supabase = adminClient();

  // Look up which restaurant this flag is about, then write to it.
  const { data: flag } = await supabase
    .from("flags")
    .select("restaurant_id")
    .eq("id", flagId)
    .single();
  if (!flag?.restaurant_id) return;

  await supabase
    .from("restaurants")
    .update({ cuisines })
    .eq("id", flag.restaurant_id);

  await supabase
    .from("flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}

/**
 * Mark a restaurant as closed (Google says it's permanently shut, OR an admin
 * has decided it's gone). Also dismisses the flag since the cuisine question
 * is moot — closed restaurants don't appear on /[city].
 */
export async function markRestaurantClosed(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!flagId || !restaurantId) return;

  const supabase = adminClient();

  await supabase
    .from("restaurants")
    .update({ closed: true })
    .eq("id", restaurantId);

  await supabase
    .from("flags")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}

/**
 * Update a restaurant's website without making any other changes. Doesn't
 * touch the flag — the admin can still assign cuisine / mark closed / skip
 * after correcting the URL.
 */
export async function updateRestaurantWebsite(
  formData: FormData,
): Promise<void> {
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const rawWebsite = String(formData.get("website") ?? "").trim();
  if (!restaurantId) return;

  // Empty string clears the website; otherwise prepend https:// if missing.
  let website: string | null = null;
  if (rawWebsite) {
    website = /^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`;
  }

  await adminClient()
    .from("restaurants")
    .update({ website })
    .eq("id", restaurantId);

  revalidatePath("/admin");
}

/**
 * Close a flag without making any other changes. Used when the admin can't
 * (or doesn't want to) take a specific action — e.g. a missing-cuisine flag
 * for a restaurant whose data is too thin to tag confidently.
 */
export async function skipFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  if (!flagId) return;

  await adminClient()
    .from("flags")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}

/**
 * Dismiss a flag — the mention was a false positive (extract pulled
 * something that isn't a real restaurant). Also nulls the extraction's
 * restaurant_id and zeros its vote weight so it stops contributing to
 * scores.
 */
export async function dismissFlag(formData: FormData): Promise<void> {
  const flagId = String(formData.get("flagId") ?? "");
  if (!flagId) return;
  const supabase = adminClient();

  const { data: flag } = await supabase
    .from("flags")
    .select("extraction_id")
    .eq("id", flagId)
    .single();

  if (flag?.extraction_id) {
    await supabase
      .from("extractions")
      .update({ restaurant_id: null, vote_weight: 0 })
      .eq("id", flag.extraction_id);
  }

  await supabase
    .from("flags")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
    })
    .eq("id", flagId);

  revalidatePath("/admin");
}
