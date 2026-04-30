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

  /** Sticky vibe/occasion tags (≥2 supporting extractions). Closed taxonomy. */
  tags: Tag[];

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

export const TAGS = [
  "date_night",
  "hidden_gem",
  "hole_in_the_wall",
  "great_views",
  "cheap_eats",
  "special_occasion",
  "late_night",
  "outdoor_seating",
] as const;

export type Tag = (typeof TAGS)[number];

export const TAG_LABELS: Record<Tag, string> = {
  date_night: "Date night",
  hidden_gem: "Hidden gem",
  hole_in_the_wall: "Hole in the wall",
  great_views: "Great views",
  cheap_eats: "Cheap eats",
  special_occasion: "Special occasion",
  late_night: "Late night",
  outdoor_seating: "Outdoor seating",
};

export type SortKey = "rank" | "food" | "service" | "volume" | "recent";

export type Filters = {
  cuisine: string | null;
  neighborhood: string | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  tag: Tag | null;
  /** Minimum food score on the 0–10 scale. Null = no minimum. */
  minFoodScore: number | null;
  /** Minimum total unique reviewers (food OR service). Null = no minimum. */
  minMentions: number | null;
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
  tag: null,
  minFoodScore: null,
  minMentions: null,
  hideService: false,
};

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.cuisine !== null ||
    f.neighborhood !== null ||
    f.priceLevel !== null ||
    f.tag !== null ||
    f.minFoodScore !== null ||
    f.minMentions !== null ||
    f.hideService
  );
}
