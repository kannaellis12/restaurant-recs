"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { City } from "@/lib/cities";
import {
  EMPTY_FILTERS,
  TAGS,
  type Filters,
  type RestaurantSummary,
  type SortKey,
  type Tag,
} from "@/lib/types";
import { RestaurantList } from "./RestaurantList";
import { CityMap, type MapBounds } from "./CityMap";
import { FilterBar } from "./FilterBar";
import { TagPicks } from "./TagPicks";

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
};

const PAGE_SIZE = 50;

export function CityView({ city, restaurants }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [page, setPage] = useState(1);

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

  // 1. Apply filters + search + viewport bounds, 2. sort.
  // Pagination happens in a separate memo so we can re-page without
  // re-running the filter pass.
  const filtered = useMemo(() => {
    let r = restaurants;
    if (filters.cuisine) {
      const c = filters.cuisine;
      r = r.filter((x) => x.cuisines.includes(c));
    }
    if (filters.neighborhood) {
      r = r.filter((x) => x.neighborhood === filters.neighborhood);
    }
    if (filters.priceLevel) {
      r = r.filter((x) => x.priceLevel === filters.priceLevel);
    }
    if (filters.tag) {
      const t = filters.tag;
      r = r.filter((x) => x.tags.includes(t));
    }
    const isSearching = searchQuery.trim().length > 0;
    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      r = r.filter((x) => x.name.toLowerCase().includes(q));
    }
    // Viewport filter is suppressed while searching — a name search is an
    // intentional lookup, not a "what's near me" browse, so we shouldn't
    // hide a match just because it's off-screen. Once the user picks a
    // result the map will fly to it and the viewport filter resumes.
    if (mapBounds && !isSearching) {
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
  }, [restaurants, filters, sortKey, searchQuery, mapBounds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  // Reset to page 1 whenever the filtered set changes shape — bounds, filters,
  // sort, or search. Otherwise a user on page 5 could land on an empty slice.
  useEffect(() => {
    setPage(1);
  }, [filters, sortKey, searchQuery, mapBounds]);

  // If filtering removed the currently-selected restaurant from the FULL
  // filtered set (not just the current page), clear it. The selected pin
  // is allowed to be off the current page — it'll re-highlight when the
  // user paginates back to it.
  useEffect(() => {
    if (selectedId && !filtered.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  // Search submit: if the user types something and presses enter (or just
  // types and the first match becomes obvious), select the top match. The
  // map auto-flies to the selection via CityMap's selectedId effect.
  const onSearchSubmit = () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    const match =
      restaurants.find((r) => r.name.toLowerCase() === q) ??
      restaurants.find((r) => r.name.toLowerCase().startsWith(q)) ??
      restaurants.find((r) => r.name.toLowerCase().includes(q));
    if (match) setSelectedId(match.id);
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← All cities
          </Link>
          <h1 className="text-2xl font-bold">{city.name}</h1>
          <span className="text-sm text-gray-500">{city.country}</span>
        </div>
      </header>

      <TagPicks
        restaurants={restaurants}
        selectedTag={filters.tag}
        onSelectTag={(t) => setFilters({ ...filters, tag: t })}
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
        filteredCount={filtered.length}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearchSubmit={onSearchSubmit}
        onClearFilters={() => {
          setFilters(EMPTY_FILTERS);
          setSearchQuery("");
        }}
      />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
        <RestaurantList
          restaurants={visible}
          totalInView={filtered.length}
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          hideService={filters.hideService}
          topByTag={topByTag}
        />
        <CityMap
          city={city}
          restaurants={visible}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onBoundsChange={setMapBounds}
        />
      </div>
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
