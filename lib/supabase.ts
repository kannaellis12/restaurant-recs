import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client used by Server Components.
 *
 * Uses the anon key — the only tables the frontend reads (cities,
 * restaurants, restaurant_scores, restaurants_with_scores view) all have
 * public read policies via RLS, so no service-role privileges are needed
 * for browsing. The service role is reserved for the Python pipeline and
 * the (future) /admin route.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing — check .env.local",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

/**
 * Row shape returned by the `restaurants_with_scores` view (defined in
 * supabase/migrations/0003_views.sql).
 */
export type RestaurantWithScoresRow = {
  id: string;
  place_id: string;
  slug: string;
  name: string;
  city_slug: string;
  neighborhood: string | null;
  address: string | null;
  website: string | null;
  price_level: number | null;
  cuisines: string[];
  closed: boolean;
  lng: number;
  lat: number;
  food_score: number | null;
  food_unique_users: number;
  service_score: number | null;
  service_unique_users: number;
  total_unique_users: number;
  /** Vibe/occasion tags from the restaurant_scores aggregation. */
  tags: string[];
  city_rank: number | null;
  /** `regularOpeningHours` blob from Google Places. May be null when
   *  Google has no hours data for the place. */
  hours: {
    weekdayDescriptions?: string[];
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }>;
    openNow?: boolean;
  } | null;
};
