"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { City } from "@/lib/cities";
import {
  EMPTY_FILTERS,
  TAGS,
  type Filters,
  type RestaurantSummary,
  type SortKey,
  type Tag,
} from "@/lib/types";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import { TAG_LABELS } from "@/lib/types";
import { RestaurantList, CompactScore } from "./RestaurantList";
import { CityMap, type MapBounds } from "./CityMap";
import { FilterBar } from "./FilterBar";
import { TagPicks } from "./TagPicks";
import { RequestedCityBanner } from "../CityRequest";

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
};

const PAGE_SIZE = 50;

export function CityView({ city, restaurants }: Props) {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  // Initial filter state honors URL params so detail-page chips can deep-link
  // back into a pre-applied filter (e.g. /denver?cuisine=italian, ?tag=date_night).
  // After mount the filters live in local state — we don't keep them in sync
  // with the URL on subsequent changes.
  const [filters, setFilters] = useState<Filters>(() => {
    // Deep links from the detail page pass single comma-free values
    // (e.g. /denver?cuisine=italian, ?tag=date_night). We still split on
    // commas so a future link could pre-select multiple options.
    const splitParam = (raw: string | null): string[] =>
      raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return {
      ...EMPTY_FILTERS,
      cuisines: splitParam(searchParams.get("cuisine")),
      neighborhoods: splitParam(searchParams.get("neighborhood")),
      tags: splitParam(searchParams.get("tag")) as Filters["tags"],
    };
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [page, setPage] = useState(1);
  // Mobile-only: which of the two stacked panes (list / map) is showing.
  // On md+ both render side-by-side and this state is ignored. Default
  // to "list" because that's where the user reads the answer to "what
  // are the best restaurants?" — the map is the secondary "where" view.
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  // Tracks whether the layout is in side-by-side mode (md+). Drives the
  // viewport filter below: panning the map only narrows the list when
  // the list and map are visible together. On mobile the user toggles
  // between them, so a stale map viewport shouldn't constrain a list
  // they're now reading on its own. Default true to match SSR (desktop
  // is the more common starting assumption for the Tailwind md+ class
  // mirror in the layout) — useEffect corrects on mount.
  const [isDesktopLayout, setIsDesktopLayout] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktopLayout(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktopLayout(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const availableCuisines = useMemo(() => {
    const s = new Set<string>();
    for (const r of restaurants) for (const c of r.cuisines) s.add(c);
    return Array.from(s).sort();
  }, [restaurants]);

  const availableNeighborhoods = useMemo(() => {
    const s = new Set<string>();
    for (const r of restaurants) if (r.neighborhood) s.add(r.neighborhood);
    return Array.from(s).sort();
  }, [restaurants]);

  const availableTags = useMemo<Tag[]>(() => {
    const present = new Set<Tag>();
    for (const r of restaurants) for (const t of r.tags) present.add(t);
    // Preserve the canonical taxonomy order rather than alphabetical.
    return TAGS.filter((t) => present.has(t));
  }, [restaurants]);

  // Top-3 ranked restaurants per tag, used by RestaurantList to mark tag
  // chips with a "★ Top" indicator. Computed against the full restaurant
  // set (NOT the visible/paged subset) so the indicator is stable.
  const topByTag = useMemo<Map<Tag, Set<string>>>(() => {
    const out = new Map<Tag, Set<string>>();
    for (const tag of TAGS) {
      const tagged = restaurants.filter((r) => r.tags.includes(tag));
      if (tagged.length === 0) continue;
      tagged.sort((a, b) => a.cityRank - b.cityRank);
      out.set(tag, new Set(tagged.slice(0, 3).map((r) => r.id)));
    }
    return out;
  }, [restaurants]);

  // Apply only the user-driven filters — cuisine / neighborhood / price /
  // vibe / score thresholds. The viewport and search are NOT applied here
  // because we want a stable "set the user is looking at conceptually"
  // that doesn't change as the map pans. The selection-clearing effect
  // below uses this set: a TagPick lead that's outside the viewport
  // shouldn't get auto-deselected just because the bounds haven't
  // updated yet.
  const userFiltered = useMemo(() => {
    let r = restaurants;
    // Multi-select filters use OR semantics within a category and AND
    // across categories: e.g. selecting Italian + French shows
    // restaurants in either cuisine, while also requiring the selected
    // neighborhood / price / vibe.
    if (filters.cuisines.length > 0) {
      const set = new Set(filters.cuisines);
      r = r.filter((x) => x.cuisines.some((c) => set.has(c)));
    }
    if (filters.neighborhoods.length > 0) {
      const set = new Set(filters.neighborhoods);
      r = r.filter((x) => x.neighborhood !== null && set.has(x.neighborhood));
    }
    if (filters.priceLevels.length > 0) {
      const set = new Set<number>(filters.priceLevels);
      r = r.filter((x) => x.priceLevel !== null && set.has(x.priceLevel));
    }
    if (filters.tags.length > 0) {
      const set = new Set<string>(filters.tags);
      r = r.filter((x) => x.tags.some((t) => set.has(t)));
    }
    if (filters.minFoodScore !== null) {
      // Score is stored on a 0–1 scale; the filter dropdown speaks 0–10.
      const threshold = filters.minFoodScore / 10;
      r = r.filter((x) => x.foodScore !== null && x.foodScore >= threshold);
    }
    if (filters.minMentions !== null) {
      const m = filters.minMentions;
      r = r.filter((x) => x.totalUniqueUsers >= m);
    }
    return r;
  }, [restaurants, filters]);

  // Layer the search + viewport on top, then sort. Pagination happens in
  // a separate memo so we can re-page without re-running the filter pass.
  const filtered = useMemo(() => {
    let r = userFiltered;
    const isSearching = searchQuery.trim().length > 0;
    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      r = r.filter((x) => x.name.toLowerCase().includes(q));
    }
    // Viewport filter is suppressed while searching — a name search is an
    // intentional lookup, not a "what's near me" browse, so we shouldn't
    // hide a match just because it's off-screen. Once the user picks a
    // result the map will fly to it and the viewport filter resumes.
    // It's also suppressed on mobile, where the user toggles between
    // list and map and a stale viewport from the last map session
    // shouldn't constrain a list they're now reading on its own.
    if (mapBounds && !isSearching && isDesktopLayout) {
      r = r.filter((x) => {
        const [lng, lat] = x.location;
        return (
          lng >= mapBounds.west &&
          lng <= mapBounds.east &&
          lat >= mapBounds.south &&
          lat <= mapBounds.north
        );
      });
    }
    return [...r].sort(comparator(sortKey));
  }, [userFiltered, sortKey, searchQuery, mapBounds, isDesktopLayout]);

  // Chain collapse: when multiple restaurants in the visible set share the
  // same name (Corvus Coffee × 3, Pinche Tacos × 2), keep only the
  // highest-ranked one in the list ("the lead") and stash a count of its
  // siblings for the UI to show as "+ N locations". Order matches the
  // current sort, so the lead is whichever copy sorted to the front.
  //
  // Match key is the case-insensitive whitespace-collapsed name. Different-
  // brand chains (Big Mamma group's Paris restaurants, which all have
  // different names) aren't grouped — that'd require external chain data
  // we don't have.
  const { collapsed, siblingCountById } = useMemo(() => {
    const seen = new Map<string, RestaurantSummary>();
    const counts = new Map<string, number>();
    const leadOrder: RestaurantSummary[] = [];
    for (const r of filtered) {
      const key = r.name.toLowerCase().replace(/\s+/g, " ").trim();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, r);
        counts.set(r.id, 0);
        leadOrder.push(r);
      } else {
        counts.set(existing.id, (counts.get(existing.id) ?? 0) + 1);
      }
    }
    return { collapsed: leadOrder, siblingCountById: counts };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(collapsed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => collapsed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [collapsed, safePage],
  );

  // Reset to page 1 whenever the filtered set changes shape — bounds, filters,
  // sort, or search. Otherwise a user on page 5 could land on an empty slice.
  useEffect(() => {
    setPage(1);
  }, [filters, sortKey, searchQuery, mapBounds]);

  // If a USER-driven filter (cuisine / neighborhood / vibe / score) excludes
  // the currently-selected restaurant, clear the selection so we don't
  // leave a stale highlight on a row that isn't visible.
  //
  // We deliberately check against `userFiltered`, NOT `filtered` — the
  // latter also applies viewport bounds, and clicking a TagPick lead
  // that's outside the current viewport would otherwise immediately
  // deselect because the stale bounds don't include the new pick yet.
  // (The flyTo expands the viewport on the next moveend; selection just
  // needs to survive that brief in-between render.)
  useEffect(() => {
    if (selectedId && !userFiltered.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [userFiltered, selectedId]);

  // Search submit: if the user types something and presses enter, select
  // the top match. Match against the COLLAPSED set (one entry per chain
  // name), so search results map directly to what the user sees in the
  // list and on the map. The selection auto-flies the map via CityMap's
  // selectedId effect.
  const onSearchSubmit = () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const match =
      collapsed.find((r) => r.name.toLowerCase() === q) ??
      collapsed.find((r) => r.name.toLowerCase().startsWith(q)) ??
      collapsed.find((r) => r.name.toLowerCase().includes(q));
    if (match) setSelectedId(match.id);
  };

  return (
    <div className="h-screen flex flex-col bg-paper">
      <RequestedCityBanner />
      {/* Mobile: two rows (brand+breadcrumb, then full-width search) so
          the wordmark and search don't fight for horizontal space.
          Desktop (sm+): single row, original layout. The "← All cities"
          link is suppressed on mobile because the Cities crumb already
          links there — keeping it would just pad the row. */}
      <header className="border-b border-rule px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          <Link href="/" aria-label="Restaurants of Reddit — home" className="shrink-0">
            <Image
              src="/brand/RoR-logo-no-tagline.svg"
              alt="Restaurants of Reddit"
              width={220}
              height={48}
              priority
              className="h-7 sm:h-8 w-auto"
            />
          </Link>
          <nav className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 flex items-baseline gap-2 min-w-0">
            <Link href="/" className="hover:text-ink transition-colors shrink-0">
              Cities
            </Link>
            <span className="text-rule-strong shrink-0">/</span>
            <span className="text-ink truncate">{city.name}</span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSearchSubmit();
            }}
            className="flex items-center flex-1 sm:flex-none"
          >
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search restaurants…"
              aria-label="Search restaurants"
              className="font-mono text-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 border border-rule-strong bg-paper px-2.5 py-1.5 text-ink focus:outline-none focus:border-ink w-full sm:w-56"
            />
          </form>
          <Link
            href="/"
            className="hidden sm:inline font-mono text-mono-sm uppercase tracking-wider text-ink-3 hover:text-ink transition-colors"
          >
            ← All cities
          </Link>
        </div>
      </header>

      <TagPicks
        restaurants={restaurants}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      <FilterBar
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        filters={filters}
        onFiltersChange={setFilters}
        availableCuisines={availableCuisines}
        availableNeighborhoods={availableNeighborhoods}
        availableTags={availableTags}
        totalCount={restaurants.length}
        filteredCount={collapsed.length}
        hasSearchQuery={searchQuery.length > 0}
        onClearFilters={() => {
          setFilters(EMPTY_FILTERS);
          setSearchQuery("");
        }}
      />

      {/* Mobile-only view toggle. md+ keeps the side-by-side layout so
          this strip never renders. Active tab uses an ink underline;
          inactive sits on the rule color so the two borders form one
          continuous baseline. */}
      <div className="md:hidden bg-paper grid grid-cols-2">
        <button
          type="button"
          onClick={() => setMobileView("list")}
          aria-pressed={mobileView === "list"}
          className={[
            "font-mono text-mono-sm uppercase tracking-wider py-1.5 cursor-pointer transition-colors border-b-2",
            mobileView === "list"
              ? "text-ink border-ink"
              : "text-ink-3 hover:text-ink border-rule",
          ].join(" ")}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => setMobileView("map")}
          aria-pressed={mobileView === "map"}
          className={[
            "font-mono text-mono-sm uppercase tracking-wider py-1.5 cursor-pointer transition-colors border-b-2",
            mobileView === "map"
              ? "text-ink border-ink"
              : "text-ink-3 hover:text-ink border-rule",
          ].join(" ")}
        >
          Map
        </button>
      </div>

      {/* List + map. Mobile: one column, one row sized to 1fr so the
          visible pane fills the available viewport. Desktop: two
          columns side-by-side, default auto rows. The wrapping divs
          use `display: contents` so they don't add a layout layer to
          the grid — they only exist to flip visibility per mobile tab. */}
      <div className="flex-1 grid grid-cols-1 grid-rows-1 md:grid-cols-2 md:grid-rows-none overflow-hidden">
        <div className={`${mobileView === "list" ? "contents" : "hidden"} md:contents`}>
          <RestaurantList
            restaurants={visible}
            totalInView={collapsed.length}
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onHover={setHoveredId}
            hideService={filters.hideService}
            topByTag={topByTag}
            siblingCountById={siblingCountById}
          />
        </div>
        {/* The map wrapper is a real block (not display:contents) so we
            can apply overflow-hidden + min-h-0 to it. iOS Safari has
            had subtle layout-sizing issues when grid items rely on
            display:contents to participate, and Mapbox markers
            propagate to absolute positions inside the map container —
            without the explicit clip, markers projecting outside the
            visible canvas leak into the paper background below the
            map. The list wrapper above can stay on display:contents
            because RestaurantList does its own internal scrolling. */}
        <div
          className={[
            "min-h-0 overflow-hidden",
            mobileView === "map" ? "" : "hidden md:block",
          ].join(" ")}
        >
          <CityMap
            city={city}
            restaurants={visible}
            allRestaurants={restaurants}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onBoundsChange={setMapBounds}
            // On mobile, panning or zooming the map should dismiss the
            // pin-preview card the same way Airbnb's mobile map does.
            // Desktop has the list visible alongside, so a sticky
            // selection there is fine and we don't pass the callback.
            onUserInteractStart={
              isDesktopLayout ? undefined : () => setSelectedId(null)
            }
          />
        </div>
      </div>

      {/* Mobile pin-preview card. Tapping a marker in map view selects
          a restaurant and surfaces this card over the bottom of the
          viewport — same pattern Airbnb uses. Tap the card to view
          details, tap × to dismiss, or pan/zoom the map (handled by
          CityMap's onUserInteractStart) to dismiss implicitly. */}
      {!isDesktopLayout && mobileView === "map" && selectedId && (() => {
        const r = restaurants.find((x) => x.id === selectedId);
        if (!r) return null;
        const cuisineLabel = r.cuisines
          .map((c) => CUISINES_BY_SLUG[c]?.label ?? c)
          .join(" / ");
        const metaItems = [
          r.neighborhood,
          cuisineLabel || null,
          r.priceLevel ? "$".repeat(r.priceLevel) : null,
        ].filter((x): x is string => Boolean(x));
        return (
          <div className="md:hidden fixed bottom-3 left-3 right-3 z-30">
            <Link
              href={`/${r.citySlug}/${r.slug}`}
              className="block bg-paper border border-rule shadow-lg pl-5 pr-12 py-4 hover:bg-paper-2 transition-colors"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-mono-sm uppercase tracking-wider text-accent shrink-0">
                  {String(r.cityRank).padStart(2, "0")}
                </span>
                <h3 className="font-display font-medium text-h4 leading-tight tracking-tight text-ink truncate">
                  {r.name}
                </h3>
              </div>
              {metaItems.length > 0 && (
                <div className="mt-1 font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
                  {metaItems.join(" · ")}
                </div>
              )}
              {r.mentionOnlyUsers > 0 && (
                <div className="mt-1 font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3">
                  + {r.mentionOnlyUsers} more mention
                  {r.mentionOnlyUsers === 1 ? "" : "s"}
                </div>
              )}
              {r.tags.length > 0 && (
                <div className="mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
                  {r.tags.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-mono-sm uppercase tracking-[0.06em] whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full border border-rule-strong text-ink-2"
                    >
                      {TAG_LABELS[t]}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-baseline gap-x-2 font-mono text-mono-sm uppercase tracking-wider">
                <CompactScore
                  label="Food"
                  score={r.foodScore}
                  count={r.foodUniqueUsers}
                  accent
                />
                {!filters.hideService && (
                  <>
                    <span className="text-rule-strong">·</span>
                    <CompactScore
                      label="Service"
                      score={r.serviceScore}
                      count={r.serviceUniqueUsers}
                    />
                  </>
                )}
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close preview"
              className="absolute top-2 right-2 p-1.5 text-ink-3 hover:text-ink cursor-pointer text-lg leading-none"
            >
              ×
            </button>
          </div>
        );
      })()}
    </div>
  );
}

function comparator(key: SortKey): (a: RestaurantSummary, b: RestaurantSummary) => number {
  switch (key) {
    case "rank":
      return (a, b) => a.cityRank - b.cityRank;
    case "food":
      return (a, b) => (b.foodScore ?? -1) - (a.foodScore ?? -1);
    case "service":
      return (a, b) => (b.serviceScore ?? -1) - (a.serviceScore ?? -1);
    case "volume":
      return (a, b) => b.totalUniqueUsers - a.totalUniqueUsers;
    case "recent":
      // Not implemented yet — fall back to rank order.
      return (a, b) => a.cityRank - b.cityRank;
  }
}
