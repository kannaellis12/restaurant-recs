"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { TAG_LABELS, type RestaurantSummary, type Tag } from "@/lib/types";
import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import { CityRequest } from "../CityRequest";

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
      className="overflow-y-auto md:border-r md:border-rule flex flex-col bg-paper"
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
                <span className="text-ink font-semibold">{restaurants.length}</span>{" "}
                {/* "in this view" is desktop-only — on mobile the map's
                    viewport doesn't filter the list, so the qualifier is
                    misleading. Mobile reads "X restaurants" instead. */}
                <span className="hidden md:inline">in this view</span>
                <span className="md:hidden">restaurants</span>
              </>
            ) : (
              <>
                Showing{" "}
                <span className="text-ink font-semibold">
                  {start}–{end}
                </span>{" "}
                of {totalInView}{" "}
                <span className="hidden md:inline">in this view</span>
                <span className="md:hidden">restaurants</span>
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
                      "relative grid grid-cols-[24px_minmax(0,1fr)] md:grid-cols-[24px_minmax(0,1fr)_auto] gap-x-3 gap-y-0 px-5 py-3",
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
                        {/* The name is ALWAYS a Link to the detail page —
                            no prior-selection gate. Row body is still
                            clickable for fly-to-map (handled by the outer
                            div's onClick); stopPropagation here keeps
                            name-clicks from also triggering that. */}
                        <Link
                          href={`/${r.citySlug}/${r.placeId}`}
                          onClick={(e) => e.stopPropagation()}
                          className={[
                            "font-display font-medium text-h4 leading-[1.1] tracking-tight truncate transition-colors",
                            "underline decoration-1 underline-offset-[5px]",
                            isSelected
                              ? "text-accent-deep decoration-accent"
                              : "text-ink decoration-rule hover:text-accent-deep hover:decoration-accent",
                            // Mobile: stretch this link over the entire
                            // card so a tap anywhere goes to the detail
                            // page. The fly-to-map gesture isn't useful
                            // when only one pane is visible at a time.
                            // Desktop keeps its two-step (click row →
                            // fly, click name → detail).
                            "before:absolute before:inset-0 before:content-[''] md:before:hidden",
                          ].join(" ")}
                          title="View this restaurant's quotes and details"
                        >
                          {r.name}
                        </Link>
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
                        // Same pattern as MetaLine: single row with
                        // mask-fade on mobile for consistent card
                        // height regardless of how many vibes a place
                        // has. Desktop wraps as before.
                        <div className="flex gap-1 mt-2 overflow-x-auto md:overflow-visible md:flex-wrap [mask-image:linear-gradient(to_right,black_92%,transparent_100%)] md:[mask-image:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {r.tags.map((t) => {
                            const isTopForTag = topByTag.get(t)?.has(r.id) ?? false;
                            return (
                              <span
                                key={t}
                                className={[
                                  "font-mono text-mono-sm uppercase tracking-[0.06em] whitespace-nowrap shrink-0",
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
                      {/* Compact mobile-only scores. The full vertical
                          score column (right side) eats ~35% of a 320px
                          viewport — that squeezes the info column hard
                          enough that cuisine names wrap mid-word. On
                          mobile we drop that column and tuck a single-
                          line summary under the info instead. */}
                      <div className="md:hidden mt-2 flex items-baseline gap-x-2 gap-y-1 flex-wrap font-mono text-mono-sm uppercase tracking-wider">
                        <CompactScore
                          label="Food"
                          score={r.foodScore}
                          count={r.foodUniqueUsers}
                          accent
                        />
                        {!hideService && (
                          <>
                            <span className="text-rule-strong">·</span>
                            <CompactScore
                              label="Service"
                              score={r.serviceScore}
                              count={r.serviceUniqueUsers}
                            />
                          </>
                        )}
                      </div>
                    </div>

                    {/* Scores — serif food score in accent, smaller service
                        below. "no data" renders as a faint em-dash in the
                        same slot so the column doesn't reflow. Hidden on
                        mobile in favor of the inline summary above. */}
                    <div className="hidden md:block text-right shrink-0 pl-2">
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
          {/* Request-a-city footer for the list panel. Lives at the
              very end of the scroll so it doesn't compete with the
              actual results, but is the natural next step for a user
              who scrolled the whole list and didn't find their place. */}
          <div className="px-5 py-8 border-t border-rule">
            <CityRequest />
          </div>
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
    // Mobile: single horizontally-scrollable row with a right-edge mask
    // so a long meta line (e.g. "BAR / GASTROPUB · AMERICAN (CASUAL) ·
    // $$$") doesn't bloat the card to two or three lines. Desktop: keep
    // the original wrap behavior since space isn't as tight there.
    <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 mt-1 flex items-baseline gap-x-2 gap-y-1 overflow-x-auto md:overflow-visible whitespace-nowrap md:whitespace-normal md:flex-wrap [mask-image:linear-gradient(to_right,black_92%,transparent_100%)] md:[mask-image:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
  /** "Food" / "Service" — rendered inline before the mention count. */
  label: string;
  score: number | null;
  count: number;
  accent?: boolean;
}) {
  // Two-line layout: big serif numeral on top, "FOOD · 19 mentions" mono
  // line underneath. The label rides with the count instead of taking its
  // own line above the numeral — saves a line per score block, which is
  // the difference between "breathable" and "crowded" in the half-width
  // list panel. Color of the numeral (terracotta vs ink) carries the
  // primary food/service distinction; the inline label is the backup.
  if (score === null) {
    return (
      <div>
        <div
          className={[
            "font-display font-medium leading-none tracking-tight",
            accent ? "text-2xl" : "text-xl",
            "text-ink-3",
          ].join(" ")}
        >
          —
        </div>
        <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-1">
          {label} <span className="text-rule-strong">·</span> no data
        </div>
      </div>
    );
  }
  return (
    <div>
      <div
        className={[
          "font-display font-medium leading-none tracking-tight",
          accent ? "text-2xl text-accent" : "text-xl text-ink",
        ].join(" ")}
      >
        {(score * 10).toFixed(1)}
        <span className="font-mono text-mono-sm text-ink-3 ml-0.5">/10</span>
      </div>
      <div className="font-mono text-mono-sm uppercase tracking-wider text-ink-3 mt-1">
        {label} <span className="text-rule-strong">·</span> {count} mention
        {count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/**
 * Mobile-only one-liner score: "FOOD 8.9 (10)". Renders as inline
 * baseline-aligned spans so it sits naturally on the bottom of the
 * info column alongside the meta line. Also reused by the map's
 * pin-preview card on mobile.
 */
export function CompactScore({
  label,
  score,
  count,
  accent = false,
}: {
  label: string;
  score: number | null;
  count: number;
  accent?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-ink-3">
      <span>{label}</span>
      <span
        className={[
          "font-display font-medium leading-none tracking-tight text-base",
          accent ? "text-accent" : "text-ink",
        ].join(" ")}
      >
        {score === null ? "—" : (score * 10).toFixed(1)}
      </span>
      {score !== null && <span>({count})</span>}
    </span>
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
