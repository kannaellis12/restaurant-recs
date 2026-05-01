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
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  hideService: boolean;
  /** restaurant ids that are top-3 for the given tag — drives the ★ chip */
  topByTag: Map<Tag, Set<string>>;
  /** number of additional locations sharing this restaurant's name in the
   *  current view (chains like Corvus Coffee × 3). 0 for standalones. */
  siblingCountById: Map<string, number>;
};

export function RestaurantList({
  restaurants,
  totalInView,
  page,
  totalPages,
  onPageChange,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  hideService,
  topByTag,
  siblingCountById,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
      className="overflow-y-auto border-r border-rule flex flex-col bg-paper"
    >
      {restaurants.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3">
            No restaurants in this view
          </div>
          <div className="font-body text-body-sm italic text-ink-2 mt-2">
            Zoom out, clear a filter, or try a different search.
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-3 border-b border-rule sticky top-0 bg-paper/95 backdrop-blur z-10 font-mono text-mono-sm uppercase tracking-wider text-ink-3">
            {totalInView <= restaurants.length ? (
              <>
                Showing{" "}
                <span className="text-ink font-semibold">{restaurants.length}</span> in this view
              </>
            ) : (
              <>
                Showing{" "}
                <span className="text-ink font-semibold">
                  {start}–{end}
                </span>{" "}
                of {totalInView} in this view
              </>
            )}
          </div>
          <ol className="flex-1">
            {restaurants.map((r, i) => {
              const isTop = i < 3 && page === 1;
              const isSelected = selectedId === r.id;
              const isHovered = hoveredId === r.id;
              const siblings = siblingCountById.get(r.id) ?? 0;
              return (
                <li key={r.id}>
                  <div
                    ref={(el) => {
                      if (el) itemRefs.current.set(r.id, el);
                      else itemRefs.current.delete(r.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(r.id);
                      }
                    }}
                    onMouseEnter={() => onHover(r.id)}
                    onMouseLeave={() => onHover(null)}
                    data-selected={isSelected}
                    data-hovered={isHovered}
                    data-top={isTop}
                    className={[
                      // Editorial list row: tight rank gutter, generous info
                      // column, scores hugging the right. Whole-row click →
                      // fly map (commit-light). The restaurant name is only
                      // a real <Link> to the detail page once the row has
                      // been clicked once; until then it's a plain heading.
                      // That two-step ("locate on the map, then commit")
                      // keeps the detail page from being the default action.
                      "grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 px-5 py-3",
                      "border-b border-rule items-start cursor-pointer outline-none",
                      "transition-colors hover:bg-paper-2 focus-visible:bg-paper-2",
                      "data-[selected=true]:bg-paper-2",
                    ].join(" ")}
                  >
                    {/* Rank — mono uppercase, accent for top-3 */}
                    <div
                      className={[
                        "font-mono text-mono-sm uppercase tracking-wider pt-1 leading-none",
                        isTop
                          ? "text-accent font-semibold"
                          : "text-ink-3",
                      ].join(" ")}
                    >
                      {String(r.cityRank).padStart(2, "0")}
                    </div>

                    {/* Info column: name + meta + tags */}
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        {isSelected ? (
                          <Link
                            href={`/${r.citySlug}/${r.placeId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-display font-medium text-h4 leading-[1.1] tracking-tight text-ink truncate underline decoration-accent decoration-1 underline-offset-[5px] hover:text-accent-deep transition-colors"
                            title="View this restaurant's quotes and details"
                          >
                            {r.name} →
                          </Link>
                        ) : (
                          <h3 className="font-display font-medium text-h4 leading-[1.1] tracking-tight text-ink truncate">
                            {r.name}
                          </h3>
                        )}
                        {siblings > 0 && (
                          <span
                            className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 shrink-0"
                            title="Multiple locations in this view share this name. Click through to see them all."
                          >
                            {siblings + 1} locations
                          </span>
                        )}
                      </div>
                      <MetaLine
                        neighborhood={r.neighborhood}
                        cuisines={r.cuisines}
                        priceLevel={r.priceLevel}
                      />
                      {r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.tags.map((t) => {
                            const isTopForTag = topByTag.get(t)?.has(r.id) ?? false;
                            return (
                              <span
                                key={t}
                                className={[
                                  "font-mono text-mono-sm uppercase tracking-[0.06em]",
                                  "px-2 py-0.5 rounded-full border",
                                  isTopForTag
                                    ? "border-accent bg-accent-soft text-accent-deep font-semibold"
                                    : "border-rule-strong text-ink-2",
                                ].join(" ")}
                                title={isTopForTag ? `Top ${TAG_LABELS[t]} in this city` : undefined}
                              >
                                {isTopForTag && <span aria-hidden="true">★ </span>}
                                {TAG_LABELS[t]}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Scores — serif food score in accent, smaller service
                        below. "no data" renders as a faint em-dash in the
                        same slot so the column doesn't reflow. */}
                    <div className="text-right shrink-0 pl-2">
                      <ScoreNumeral
                        label="Food"
                        score={r.foodScore}
                        count={r.foodUniqueUsers}
                        accent
                      />
                      {!hideService && (
                        <div className="mt-2">
                          <ScoreNumeral
                            label="Service"
                            score={r.serviceScore}
                            count={r.serviceUniqueUsers}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
          )}
        </>
      )}
    </div>
  );
}

function MetaLine({
  neighborhood,
  cuisines,
  priceLevel,
}: {
  neighborhood: string | null;
  cuisines: string[];
  priceLevel: 1 | 2 | 3 | 4 | null;
}) {
  const cuisineLabel =
    cuisines.length > 0
      ? cuisines.map((c) => CUISINES_BY_SLUG[c]?.label ?? c).join(" / ")
      : null;
  const items = [
    neighborhood,
    cuisineLabel,
    priceLevel ? "$".repeat(priceLevel) : null,
  ].filter((x): x is string => Boolean(x));
  if (items.length === 0) return null;
  return (
    <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {items.map((it, i) => (
        <span key={i} className="contents">
          {i > 0 && <span className="text-rule-strong">·</span>}
          <span>{it}</span>
        </span>
      ))}
    </div>
  );
}

function ScoreNumeral({
  label,
  score,
  count,
  accent = false,
}: {
  /** "Food" / "Service" — rendered in mono uppercase above the numeral. */
  label: string;
  score: number | null;
  count: number;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 leading-none">
        {label}
      </div>
      {score === null ? (
        <>
          <div
            className={[
              "font-display font-medium leading-none tracking-tight mt-1",
              accent ? "text-2xl" : "text-xl",
              "text-ink-3",
            ].join(" ")}
          >
            —
          </div>
          <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-1">
            no data
          </div>
        </>
      ) : (
        <>
          <div
            className={[
              "font-display font-medium leading-none tracking-tight mt-1",
              accent ? "text-2xl text-accent" : "text-xl text-ink",
            ].join(" ")}
          >
            {(score * 10).toFixed(1)}
            <span className="font-mono text-mono-sm text-ink-3 ml-0.5">/10</span>
          </div>
          <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-1">
            {count} mention{count === 1 ? "" : "s"}
          </div>
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
    <div className="px-5 py-3 border-t border-rule flex items-center justify-between gap-3 bg-paper sticky bottom-0">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="font-mono text-mono-sm uppercase tracking-wider text-ink-2 px-2.5 py-1 border border-rule-strong rounded-sm disabled:opacity-30 hover:bg-paper-2"
      >
        ← Prev
      </button>
      <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3">
        Page <span className="text-ink font-semibold">{page}</span> of {totalPages}
      </div>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="font-mono text-mono-sm uppercase tracking-wider text-ink-2 px-2.5 py-1 border border-rule-strong rounded-sm disabled:opacity-30 hover:bg-paper-2"
      >
        Next →
      </button>
    </div>
  );
}
