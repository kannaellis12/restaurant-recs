"use client";

import { useMemo } from "react";
import {
  TAGS,
  TAG_LABELS,
  type RestaurantSummary,
  type Tag,
} from "@/lib/types";

type Props = {
  restaurants: RestaurantSummary[];
  /** Currently-selected restaurant id. Drives the active-state highlight on
   *  whichever pick (if any) corresponds to the selection. */
  selectedId: string | null;
  /** Mirrors the row-click in RestaurantList: select-and-fly the map to the
   *  picked restaurant. Clicking an already-active pick clears the
   *  selection. We deliberately do NOT touch the tag filter here — the
   *  FilterBar's Vibe dropdown owns that. */
  onSelect: (id: string | null) => void;
};

/**
 * "Best for X" shortcuts. For each tag with ≥3 tagged restaurants in the
 * city, surface the highest-ranked one. We show the three most-used tags
 * so we don't overflow the header on small viewports.
 *
 * Clicking a pick mirrors clicking that restaurant's row in the list:
 * the map flies to the pin, the row highlights, and the restaurant name
 * becomes a clickable link to the detail page. No filter side-effect —
 * filters live in the FilterBar where the user expects them.
 */
export function TagPicks({ restaurants, selectedId, onSelect }: Props) {
  const picks = useMemo(() => {
    type Pick = { tag: Tag; top: RestaurantSummary; n: number };
    const out: Pick[] = [];
    for (const tag of TAGS) {
      const tagged = restaurants.filter((r) => r.tags.includes(tag));
      if (tagged.length < 3) continue;
      const top = [...tagged].sort((a, b) => a.cityRank - b.cityRank)[0];
      out.push({ tag, top, n: tagged.length });
    }
    return out.sort((a, b) => b.n - a.n).slice(0, 3);
  }, [restaurants]);

  if (picks.length === 0) return null;

  return (
    <div className="border-b border-rule px-6 py-2 flex gap-4 overflow-x-auto bg-paper items-baseline">
      <span className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 shrink-0">
        ★ Top picks
      </span>
      {picks.map(({ tag, top }) => {
        const active = selectedId === top.id;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelect(active ? null : top.id)}
            className={[
              "shrink-0 text-left transition-colors flex items-baseline gap-2 px-2 py-1 cursor-pointer",
              active
                ? "bg-accent-soft"
                : "hover:bg-paper-2",
            ].join(" ")}
            title={`Best for ${TAG_LABELS[tag].toLowerCase()} — locate ${top.name} on the map`}
          >
            <span className="font-mono text-mono-sm uppercase tracking-wider text-ink-3">
              {TAG_LABELS[tag]}
            </span>
            <span className="font-display text-base leading-none tracking-tight text-ink whitespace-nowrap">
              {top.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
