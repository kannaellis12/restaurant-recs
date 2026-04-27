"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { City } from "@/lib/cities";
import { EMPTY_FILTERS, type Filters, type RestaurantSummary, type SortKey } from "@/lib/types";
import { RestaurantList } from "./RestaurantList";
import { CityMap } from "./CityMap";
import { FilterBar } from "./FilterBar";

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
};

export function CityView({ city, restaurants }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

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

  const visible = useMemo(() => {
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
    // Note: filters.hideService is a UI toggle, not a data filter — it hides
    // service score badges in RestaurantList instead of removing rows.
    return [...r].sort(comparator(sortKey));
  }, [restaurants, filters, sortKey]);

  // If filtering removed the currently-selected restaurant, clear the
  // selection so the map doesn't fly to a hidden pin.
  useEffect(() => {
    if (selectedId && !visible.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

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

      <FilterBar
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        filters={filters}
        onFiltersChange={setFilters}
        availableCuisines={availableCuisines}
        availableNeighborhoods={availableNeighborhoods}
        totalCount={restaurants.length}
        filteredCount={visible.length}
        onClearFilters={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
        <RestaurantList
          restaurants={visible}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          hideService={filters.hideService}
        />
        <CityMap
          city={city}
          restaurants={visible}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
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
