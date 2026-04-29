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
  selectedTag: Tag | null;
  onSelectTag: (t: Tag | null) => void;
};

/**
 * "Best for X" callouts. For each tag with ≥3 tagged restaurants in the city,
 * surface the top-ranked one (by city_rank, lowest = best). We render the
 * three most-used tags so we don't overflow the header on small viewports.
 *
 * Clicking a callout toggles the corresponding tag filter.
 */
export function TagPicks({ restaurants, selectedTag, onSelectTag }: Props) {
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
    <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex gap-2 overflow-x-auto">
      {picks.map(({ tag, top }) => {
        const active = selectedTag === tag;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelectTag(active ? null : tag)}
            className={[
              "shrink-0 text-left rounded-md border px-3 py-2 transition-colors",
              active
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900",
            ].join(" ")}
          >
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              Best for {TAG_LABELS[tag].toLowerCase()}
            </div>
            <div className="text-sm font-semibold mt-0.5">{top.name}</div>
          </button>
        );
      })}
    </div>
  );
}
