"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, { type Map as MapboxMap, type Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { City } from "@/lib/cities";
import type { RestaurantSummary } from "@/lib/types";

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type Props = {
  city: City;
  restaurants: RestaurantSummary[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Fires whenever the map's visible bounds change (after load + on every
   * moveend). CityView uses this to filter the list to what's in view.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
};

export function CityMap({
  city,
  restaurants,
  selectedId,
  hoveredId,
  onSelect,
  onBoundsChange,
}: Props) {
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
      // Editorial paper-on-ink style from the design handoff. Hides default
      // food POIs so our pins are the only food markers on the map.
      style: "/mapbox-style.json",
      center: city.center,
      zoom: city.zoom,
    });
    mapRef.current = map;

    const emitBounds = () => {
      if (!onBoundsChange) return;
      const b = map.getBounds();
      if (!b) return;
      onBoundsChange({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };

    const onLoad = () => {
      setMapLoaded(true);
      emitBounds();
    };
    map.on("load", onLoad);
    map.on("moveend", emitBounds);

    return () => {
      map.off("load", onLoad);
      map.off("moveend", emitBounds);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // We intentionally exclude `onBoundsChange` from deps — re-running this
    // effect would tear down and re-create the map on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Reflect selection / hover state on every visible marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach(({ marker, el }, id) => {
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;
      el.dataset.selected = String(isSelected);
      el.dataset.hovered = String(isHovered);
      el.style.transform = isSelected ? "scale(1.4)" : isHovered ? "scale(1.15)" : "scale(1)";
      // z-index has to live on the wrapper Mapbox positions (not on `el`,
      // which is the inner visual div). Setting it on `el` looks correct
      // in dev tools but doesn't change marker stacking because the
      // translate3d transform on the wrapper creates its own stacking
      // context — siblings (other markers) are stacked relative to each
      // other by document order, not by inner z-index. Empty string
      // clears the inline style and falls back to Mapbox defaults.
      const wrapper = marker.getElement();
      wrapper.style.zIndex = isSelected ? "10" : isHovered ? "5" : "";
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
  }, [selectedId, hoveredId, restaurants, mapLoaded]);

  // Fly to the newly-selected restaurant. Split out from the visual-state
  // effect above so it ONLY runs when selectedId changes — including
  // `restaurants` in the deps would re-fire flyTo on every render (since
  // the parent's filter memo produces a new array reference each time),
  // and each flyTo emits `moveend` → bounds change → re-render → flyTo
  // again, which is a tight infinite loop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedId) return;
    const r = restaurants.find((x) => x.id === selectedId);
    if (!r) return;
    map.flyTo({ center: r.location, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    // `restaurants` is read via closure and intentionally NOT a dep — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mapLoaded]);

  // Hover-to-pan with a 300ms idle debounce: when the user lingers on a
  // list item we pan the map to that restaurant. Quick scroll-through
  // passes (each <300ms hover) never trigger a pan, so scrolling the list
  // doesn't whip the map back and forth. We pan at current zoom (no zoom
  // change) since hover is "look at where this is", not "commit to it".
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !hoveredId) return;
    const timer = setTimeout(() => {
      const r = restaurants.find((x) => x.id === hoveredId);
      if (!r) return;
      map.flyTo({ center: r.location, zoom: map.getZoom(), duration: 500 });
    }, 300);
    return () => clearTimeout(timer);
    // `restaurants` read via closure (same reason as selectedId effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredId, mapLoaded]);

  return <div ref={containerRef} className="w-full h-full" />;
}
