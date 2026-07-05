import { EMPTY_FILTERS, type Filters, type SortKey } from "@/lib/types";

/** Map camera: center [lng, lat] + zoom. Mirrors what Mapbox reports/consumes. */
export type Camera = { center: [number, number]; zoom: number };

/**
 * The slice of a city page's UI state we restore when the user navigates
 * away (e.g. to a restaurant detail page) and comes back. Deliberately
 * excludes transient bits (hover, selection, pagination) — those either
 * fight existing effects or aren't worth the flicker to restore.
 */
export type ViewState = {
  filters: Filters;
  sortKey: SortKey;
  searchQuery: string;
  camera: Camera | null;
};

const KEY_PREFIX = "ror:cityview:";

const storageKey = (citySlug: string) => KEY_PREFIX + citySlug;

/** Read the persisted view for a city, or null if none / unavailable. */
export function loadViewState(citySlug: string): ViewState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(citySlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    // Merge onto defaults so a snapshot written by an older schema (missing a
    // newly-added filter field) rehydrates cleanly instead of throwing.
    return {
      filters: { ...EMPTY_FILTERS, ...(parsed.filters ?? {}) },
      sortKey: parsed.sortKey ?? "rank",
      searchQuery: parsed.searchQuery ?? "",
      camera: parsed.camera ?? null,
    };
  } catch {
    return null;
  }
}

/** Persist the view for a city. Best-effort — quota / private-mode failures
 *  are swallowed since losing the snapshot only costs a filter/zoom reset. */
export function saveViewState(citySlug: string, state: ViewState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(citySlug), JSON.stringify(state));
  } catch {
    // no-op
  }
}
