"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { TAG_LABELS, type RestaurantSummary, type Tag } from "@/lib/types";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";

type Props = {
  restaurants: RestaurantSummary[];
  totalInView: number;
  page: number;
  totalPages: number;
  onPageChange: (n: number) => void;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  hideService: boolean;
  /** restaurant ids that are top-3 for the given tag — drives the ★ chip */
  topByTag: Map<Tag, Set<string>>;
};

export function RestaurantList({
  restaurants,
  totalInView,
  page,
  totalPages,
  onPageChange,
  selectedId,
  hoveredId,
  onHover,
  hideService,
  topByTag,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const el = itemRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  const start = (page - 1) * 50 + 1;
  const end = start + restaurants.length - 1;

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto border-r border-gray-200 dark:border-gray-800 flex flex-col"
    >
      {restaurants.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No restaurants in this view. Zoom out, clear a filter, or try a different search.
        </div>
      ) : (
        <>
          <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-900 sticky top-0 bg-white/95 dark:bg-gray-950/95 backdrop-blur z-10">
            {totalInView <= restaurants.length ? (
              <>
                Showing <span className="font-semibold">{restaurants.length}</span> in this view
              </>
            ) : (
              <>
                Showing <span className="font-semibold">{start}–{end}</span> of {totalInView} in
                this view
              </>
            )}
          </div>
          <ol className="flex-1">
            {restaurants.map((r) => (
              <li key={r.id}>
                <Link
                  ref={(el) => {
                    if (el) itemRefs.current.set(r.id, el);
                    else itemRefs.current.delete(r.id);
                  }}
                  href={`/${r.citySlug}/${r.placeId}`}
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
                      {r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.tags.map((t) => {
                            const isTop = topByTag.get(t)?.has(r.id) ?? false;
                            return (
                              <span
                                key={t}
                                className={[
                                  "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                                  isTop
                                    ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 font-semibold"
                                    : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400",
                                ].join(" ")}
                                title={isTop ? `Top ${TAG_LABELS[t]} in this city` : undefined}
                              >
                                {isTop && <span aria-hidden="true">★ </span>}
                                {TAG_LABELS[t]}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
          )}
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3 bg-white dark:bg-gray-950 sticky bottom-0">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        ← Prev
      </button>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Page <span className="font-semibold">{page}</span> of {totalPages}
      </div>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        Next →
      </button>
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
  // 0–1 internal score → 0.0–10.0 displayed. Reads as a 1-decimal rating
  // rather than a percentage — avoids implying "X% of people liked it",
  // and the Beta-prior smoothing in score.py keeps the ends honest
  // (no 10.0 / 0.0 unless sample sizes are huge).
  const value = score * 10;
  const color =
    value >= 7.5
      ? "text-green-700 dark:text-green-400"
      : value >= 5.0
        ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
  return (
    <span>
      <span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <span className={`font-semibold ml-1 ${color}`}>{value.toFixed(1)}</span>
      <span className="text-gray-500 ml-1">
        · {count} reviewer{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}
