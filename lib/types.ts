/**
 * Shared types for the web app. The pipeline writes to Supabase using these
 * shapes; the frontend reads from Supabase and renders them.
 */

export type Sentiment = "positive" | "negative" | "mixed";

export type RestaurantSummary = {
  id: string;
  placeId: string;
  name: string;
  citySlug: string;
  neighborhood: string | null;
  address: string | null;
  website: string | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  /** [longitude, latitude] in Mapbox order */
  location: [number, number];
  cuisines: string[];

  /** 0..1; null when no food sentiment was extracted */
  foodScore: number | null;
  foodUniqueUsers: number;

  /** 0..1; null when the comments don't discuss service */
  serviceScore: number | null;
  serviceUniqueUsers: number;

  /** Total unique users (food OR service) — used for "volume" sort */
  totalUniqueUsers: number;

  /** 1-indexed rank within the city, recomputed each refresh */
  cityRank: number;
};

export type SortKey = "rank" | "food" | "service" | "volume" | "recent";

export type Filters = {
  cuisine: string | null;
  neighborhood: string | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  /**
   * View toggle, not a row filter: when true the UI hides every service
   * score badge and the "Sort by service" option. Doesn't change which
   * restaurants are included. The premise of the site is "food first" so
   * a one-click escape from the service column lets you focus on that.
   */
  hideService: boolean;
};

export const EMPTY_FILTERS: Filters = {
  cuisine: null,
  neighborhood: null,
  priceLevel: null,
  hideService: false,
};

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.cuisine !== null ||
    f.neighborhood !== null ||
    f.priceLevel !== null ||
    f.hideService
  );
}
