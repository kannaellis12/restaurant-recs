"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, { type Map as MapboxMap, type Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { City } from "@/lib/cities";
import type { RestaurantSummary } from "@/lib/types";
import type { Camera } from "./viewState";

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type Props = {
  city: City;
  /** The visible set — drives marker rendering. Already filtered by the
   *  viewport, search, and any user filters; sliced to one page. */
  restaurants: RestaurantSummary[];
  /** The full city set — drives flyTo lookups. Without this we'd fail to
   *  fly to a TagPick lead that's outside the current viewport (because
   *  it'd be missing from `restaurants`). After flyTo lands, the moveend
   *  bounds update naturally pulls the restaurant into `restaurants` for
   *  marker rendering. */
  allRestaurants: RestaurantSummary[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Fires whenever the map's visible bounds change (after load + on every
   * moveend). CityView uses this to filter the list to what's in view.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
  /**
   * Fires alongside onBoundsChange with the current center + zoom. CityView
   * persists this so a zoomed-in view survives navigating to a detail page
   * and back (see viewState.ts).
   */
  onCameraChange?: (camera: Camera) => void;
  /**
   * When present, the map opens at this camera instead of the city default —
   * restores a previously zoomed-in view on a return visit. Read once at
   * map init; later changes to the prop are ignored (the user is driving
   * the camera by then).
   */
  initialCamera?: Camera | null;
  /**
   * Fires only when the user actively starts dragging or zooming the
   * map (not on programmatic flyTo). CityView uses this on mobile to
   * dismiss the pin-preview card as soon as the user goes back to
   * panning around — same pattern Airbnb uses on its mobile map.
   */
  onUserInteractStart?: () => void;
};

// Each marker is a column-flex of (circle, stem). Mapbox positions the wrapper
// via translate3d on the SVG marker container; we only style our children.
type MarkerHandle = {
  marker: Marker;
  /** the visible circle that holds the rank numeral */
  circle: HTMLDivElement;
  /** the vertical line under the circle that points to the geo location */
  stem: HTMLDivElement;
};

export function CityMap({
  city,
  restaurants,
  allRestaurants,
  selectedId,
  hoveredId,
  onSelect,
  onBoundsChange,
  onCameraChange,
  initialCamera,
  onUserInteractStart,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, MarkerHandle>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);
  // Captured once — the restored camera only matters at map creation. After
  // that the user (or a flyTo) owns the camera, so a changed prop is ignored.
  const initialCameraRef = useRef(initialCamera);

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
      // A restored camera (from a return visit) wins over the city default.
      center: initialCameraRef.current?.center ?? city.center,
      zoom: initialCameraRef.current?.zoom ?? city.zoom,
    });
    mapRef.current = map;

    const emitBounds = () => {
      const b = map.getBounds();
      if (!b) return;
      onBoundsChange?.({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
      if (onCameraChange) {
        const c = map.getCenter();
        onCameraChange({ center: [c.lng, c.lat], zoom: map.getZoom() });
      }
    };

    const onLoad = () => {
      setMapLoaded(true);
      emitBounds();
    };
    // movestart fires for both user-initiated drags/zooms and programmatic
    // flyTo. The `originalEvent` field is only populated when the move
    // came from a user gesture, which is exactly the signal we want here.
    const onMovestart = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) onUserInteractStart?.();
    };
    map.on("load", onLoad);
    map.on("moveend", emitBounds);
    map.on("movestart", onMovestart);

    // iOS Safari changes the available viewport when the URL bar
    // collapses / expands, and the mobile list-vs-map toggle flips
    // the grid cell that hosts the map. Mapbox doesn't auto-measure
    // on element resize (only on window.resize), so without this
    // markers project to stale screen positions and end up rendering
    // outside the visible canvas (pins floating below the map on a
    // paper background). The observer kicks Mapbox to resize the
    // canvas the moment the cell changes size.
    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.off("load", onLoad);
      map.off("moveend", emitBounds);
      map.off("movestart", onMovestart);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // We intentionally exclude the callbacks (`onBoundsChange`,
    // `onCameraChange`) from deps — re-running this effect would tear down
    // and re-create the map on every render. They're stable setState-style
    // callbacks, so the versions captured at init stay correct.
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

    // Top-3 = first 3 in the visible (paged + sorted + filtered) list. They
    // get bigger marker circles so the eye lands on them first when scanning
    // the map. The list-side rank numbering still uses real city_rank, so a
    // viewport that doesn't include the city's #1 still highlights its OWN
    // top 3 — accurate to the meaning of "the cream of what you're looking at".
    const top3Ids = new Set(restaurants.slice(0, 3).map((r) => r.id));

    for (const r of restaurants) {
      const existing = markersRef.current.get(r.id);
      if (existing) {
        // Resize circle if its top-3 status changed (e.g. user paginated).
        applyTopState(existing.circle, top3Ids.has(r.id));
        continue;
      }

      // Wrapper is what Mapbox positions via `transform: translate3d(...)`.
      // Never touch its style.transform — overwriting it would clobber the
      // map projection and snap the marker to the canvas origin.
      const wrapper = document.createElement("div");
      wrapper.style.cursor = "pointer";
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.alignItems = "center";

      const circle = document.createElement("div");
      circle.style.borderRadius = "50%";
      circle.style.display = "grid";
      circle.style.placeItems = "center";
      circle.style.fontFamily = "var(--font-mono)";
      circle.style.fontWeight = "600";
      circle.style.boxShadow = "0 6px 16px oklch(0 0 0 / 0.08)";
      circle.style.transition =
        "transform 120ms ease, background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease, width 120ms ease, height 120ms ease, font-size 120ms ease";
      circle.textContent = String(r.cityRank).padStart(2, "0");
      applyDefaultColors(circle);
      applyTopState(circle, top3Ids.has(r.id));

      const stem = document.createElement("div");
      stem.style.width = "1.5px";
      stem.style.height = "8px";
      stem.style.background = "var(--color-accent)";
      stem.style.transition = "height 120ms ease, background-color 120ms ease, opacity 120ms ease";

      wrapper.appendChild(circle);
      wrapper.appendChild(stem);
      wrapper.addEventListener("click", () => onSelect(r.id));

      // anchor: 'bottom' so the stem's tip lands on the actual lat/lng,
      // not the center of the circle. Without this, every pin sits ~14px
      // above where it actually should be on the geography.
      const marker = new mapboxgl.Marker({ element: wrapper, anchor: "bottom" })
        .setLngLat(r.location)
        .addTo(map);
      markersRef.current.set(r.id, { marker, circle, stem });
    }
  }, [restaurants, onSelect, mapLoaded]);

  // Reflect selection / hover state on every visible marker. Active = the
  // hovered or selected pin (selected wins). Other pins are dimmed when
  // anything is active so the eye lands cleanly on the focused one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const activeId = selectedId ?? hoveredId;

    markersRef.current.forEach(({ marker, circle, stem }, id) => {
      const isActive = id === activeId;
      const isDimmed = activeId !== null && !isActive;

      circle.style.opacity = isDimmed ? "0.25" : "1";
      stem.style.opacity = isDimmed ? "0.25" : "1";

      if (isActive) {
        // Active state: ink fill (paper text), slight scale, taller stem.
        circle.style.background = "var(--color-ink)";
        circle.style.borderColor = "var(--color-ink)";
        circle.style.color = "var(--color-paper)";
        circle.style.transform = "scale(1.18)";
        stem.style.background = "var(--color-ink)";
        stem.style.height = "14px";
      } else {
        applyDefaultColors(circle);
        circle.style.transform = "scale(1)";
        stem.style.background = "var(--color-accent)";
        stem.style.height = "8px";
      }

      // z-index lives on the wrapper Mapbox positions (not on `circle`).
      // Setting it on `circle` looks correct in dev tools but doesn't change
      // marker stacking because the translate3d transform on the wrapper
      // creates its own stacking context — siblings (other markers) stack
      // by document order, not by inner z-index.
      const wrapper = marker.getElement();
      wrapper.style.zIndex = isActive ? "10" : "";
    });
  }, [selectedId, hoveredId, restaurants, mapLoaded]);

  // Fly to the newly-selected restaurant. Split out from the visual-state
  // effect above so it ONLY runs when selectedId changes — including
  // `restaurants` in the deps would re-fire flyTo on every render (since
  // the parent's filter memo produces a new array reference each time),
  // and each flyTo emits `moveend` → bounds change → re-render → flyTo
  // again, which is a tight infinite loop.
  //
  // We look the restaurant up in `allRestaurants` (the full city set) NOT
  // `restaurants` (the visible/paged set). Otherwise, selecting a TagPick
  // lead that's outside the current viewport (e.g. Golden Saigon down in
  // Aurora when the map is centered on downtown Denver) would silently
  // do nothing — the restaurant gets dropped by the viewport filter
  // before it reaches `restaurants`. After flyTo lands, the moveend
  // bounds update naturally pulls it into the visible set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedId) return;
    const r = allRestaurants.find((x) => x.id === selectedId);
    if (!r) return;
    map.flyTo({ center: r.location, zoom: Math.max(map.getZoom(), 13), duration: 600 });
    // `allRestaurants` is read via closure and intentionally NOT a dep —
    // see comment above on the infinite-loop hazard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mapLoaded]);

  return <div ref={containerRef} className="w-full h-full" />;
}

/** Default (non-active) circle styling — terracotta fill, paper numeral. */
function applyDefaultColors(circle: HTMLDivElement) {
  circle.style.background = "var(--color-accent)";
  circle.style.border = "1.5px solid var(--color-accent)";
  circle.style.color = "var(--color-paper)";
}

/** Top-3 pins are physically larger so the eye lands on them first when
 *  scanning a dense map. */
function applyTopState(circle: HTMLDivElement, isTop: boolean) {
  if (isTop) {
    circle.style.width = "36px";
    circle.style.height = "36px";
    circle.style.fontSize = "13px";
  } else {
    circle.style.width = "28px";
    circle.style.height = "28px";
    circle.style.fontSize = "11px";
  }
}
