"use client";

import { useEffect, useRef } from "react";
import type { RestaurantSummary } from "@/lib/types";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";

type Props = {
  restaurants: RestaurantSummary[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  hideService: boolean;
};

export function RestaurantList({
  restaurants,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  hideService,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const el = itemRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto border-r border-gray-200 dark:border-gray-800"
    >
      {restaurants.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No restaurants yet — pipeline hasn&apos;t run for this city.
        </div>
      ) : (
        <ol>
          {restaurants.map((r) => (
            <li key={r.id}>
              <a
                ref={(el) => {
                  if (el) itemRefs.current.set(r.id, el);
                  else itemRefs.current.delete(r.id);
                }}
                href={`/${r.citySlug}/${r.placeId}`}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(r.id);
                }}
                onMouseEnter={() => onHover(r.id)}
                onMouseLeave={() => onHover(null)}
                data-selected={selectedId === r.id}
                data-hovered={hoveredId === r.id}
                className="block px-4 py-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-900 data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-950/40"
              >
                <div className="flex gap-3 items-start">
                  <div className="text-gray-400 dark:text-gray-600 font-mono text-sm w-7 pt-0.5 shrink-0">
                    #{r.cityRank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate text-base">{r.name}</h3>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {[
                        r.neighborhood,
                        r.cuisines.map((c) => CUISINES_BY_SLUG[c]?.label ?? c).join(", "),
                        r.priceLevel ? "$".repeat(r.priceLevel) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="flex gap-4 mt-2 text-xs">
                      <ScoreBadge label="Food" score={r.foodScore} count={r.foodUniqueUsers} />
                      {!hideService && (
                        <ScoreBadge
                          label="Service"
                          score={r.serviceScore}
                          count={r.serviceUniqueUsers}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ScoreBadge({
  label,
  score,
  count,
}: {
  label: string;
  score: number | null;
  count: number;
}) {
  if (score === null) {
    return (
      <span className="text-gray-400 dark:text-gray-600">
        <span className="font-medium">{label}</span>
        <span className="italic ml-1">no data</span>
      </span>
    );
  }
  const pct = Math.round(score * 100);
  const color =
    pct >= 85
      ? "text-green-700 dark:text-green-400"
      : pct >= 70
        ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
  return (
    <span>
      <span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <span className={`font-semibold ml-1 ${color}`}>{pct}%</span>
      <span className="text-gray-500 ml-1">
        · {count} reviewer{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}
