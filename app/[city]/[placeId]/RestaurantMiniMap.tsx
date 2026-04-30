"use client";

import { useEffect, useRef } from "react";
import mapboxgl, { type Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { RestaurantSummary } from "@/lib/types";

type Props = {
  restaurant: RestaurantSummary;
};

/**
 * Tiny single-pin map for the restaurant detail page header. Intentionally
 * sparse — no list interaction, no bounds emission, no selection state.
 * The big CityMap stays focused on the city-list use case.
 */
export function RestaurantMiniMap({ restaurant }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error("NEXT_PUBLIC_MAPBOX_TOKEN is missing from .env.local");
      return;
    }
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "/mapbox-style.json",
      center: restaurant.location,
      zoom: 14,
      interactive: false, // pure visual; click → detail page already, no need to pan
    });
    mapRef.current = map;

    map.once("load", () => {
      const wrapper = document.createElement("div");
      const inner = document.createElement("div");
      inner.className =
        "w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-md";
      wrapper.appendChild(inner);
      new mapboxgl.Marker({ element: wrapper })
        .setLngLat(restaurant.location)
        .addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [restaurant.location]);

  return <div ref={containerRef} className="w-full h-full" />;
}
