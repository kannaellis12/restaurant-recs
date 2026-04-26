"use client";

import { useState } from "react";
import Link from "next/link";
import type { City } from "@/lib/cities";
import type { RestaurantSummary } from "@/lib/types";
import { RestaurantList } from "./RestaurantList";
import { CityMap } from "./CityMap";

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
};

export function CityView({ city, restaurants }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
        <div className="text-sm text-gray-500">
          {restaurants.length} restaurant{restaurants.length === 1 ? "" : "s"}
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
        <RestaurantList
          restaurants={restaurants}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
        />
        <CityMap
          city={city}
          restaurants={restaurants}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}
