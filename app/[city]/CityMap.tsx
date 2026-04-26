"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, { type Map as MapboxMap, type Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { City } from "@/lib/cities";
import type { RestaurantSummary } from "@/lib/types";

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
};

export function CityMap({ city, restaurants, selectedId, hoveredId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, { marker: Marker; el: HTMLDivElement }>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize the map exactly once. We gate marker work behind `mapLoaded`
  // because Mapbox's projection isn't ready until the 'load' event fires —
  // markers added before then snap to the canvas origin (top-left), which
  // looks like every pin "moving to the corner" right after first paint.
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
      style: "mapbox://styles/mapbox/streets-v12",
      center: city.center,
      zoom: city.zoom,
    });
    mapRef.current = map;

    const onLoad = () => setMapLoaded(true);
    map.on("load", onLoad);

    return () => {
      map.off("load", onLoad);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [city.center, city.zoom]);

  // Sync markers whenever the restaurant set or load state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const incomingIds = new Set(restaurants.map((r) => r.id));
    markersRef.current.forEach(({ marker }, id) => {
      if (!incomingIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    for (const r of restaurants) {
      if (markersRef.current.has(r.id)) continue;

      // Wrapper is what Mapbox positions via `transform: translate3d(...)`.
      // We never touch its style.transform — overwriting it would clobber the
      // map projection and snap the marker to the canvas origin (the
      // "everything jumps to the corner" bug).
      const wrapper = document.createElement("div");
      wrapper.style.cursor = "pointer";

      // Inner holds the visual styling and the select/hover scale animation.
      const inner = document.createElement("div");
      inner.className =
        "w-7 h-7 rounded-full bg-white dark:bg-gray-900 border-2 border-gray-700 dark:border-gray-300 text-gray-900 dark:text-gray-100 flex items-center justify-center text-xs font-bold shadow-md transition-all";
      inner.textContent = String(r.cityRank);

      wrapper.appendChild(inner);
      wrapper.addEventListener("click", () => onSelect(r.id));

      const marker = new mapboxgl.Marker({ element: wrapper }).setLngLat(r.location).addTo(map);
      // Store `inner` as `el` — selection/hover effects modify the inner
      // element, leaving Mapbox's transform on the wrapper alone.
      markersRef.current.set(r.id, { marker, el: inner });
    }
  }, [restaurants, onSelect, mapLoaded]);

  // Reflect selection / hover state on the markers and pan to the selected one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach(({ el }, id) => {
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;
      el.dataset.selected = String(isSelected);
      el.dataset.hovered = String(isHovered);
      el.style.transform = isSelected ? "scale(1.4)" : isHovered ? "scale(1.15)" : "scale(1)";
      el.style.zIndex = isSelected ? "10" : isHovered ? "5" : "1";
      if (isSelected) {
        el.style.background = "#2563eb";
        el.style.borderColor = "#1d4ed8";
        el.style.color = "#ffffff";
      } else {
        el.style.background = "";
        el.style.borderColor = isHovered ? "#60a5fa" : "";
        el.style.color = "";
      }
    });

    if (selectedId) {
      const r = restaurants.find((r) => r.id === selectedId);
      if (r) map.flyTo({ center: r.location, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    }
  }, [selectedId, hoveredId, restaurants, mapLoaded]);

  return <div ref={containerRef} className="w-full h-full" />;
}
