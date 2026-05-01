"use client";

import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import {
  TAG_LABELS,
  hasActiveFilters,
  type Filters,
  type SortKey,
  type Tag,
} from "@/lib/types";

type Props = {
  sortKey: SortKey;
  onSortKeyChange: (s: SortKey) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  availableCuisines: string[];
  availableNeighborhoods: string[];
  availableTags: Tag[];
  totalCount: number;
  filteredCount: number;
  /** True when the search input in the page header has any text. Drives the
   *  "Clear" button visibility — search is cleared by the same button. */
  hasSearchQuery: boolean;
  onClearFilters: () => void;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank", label: "Sort: Rank" },
  { value: "food", label: "Sort: Food score" },
  { value: "service", label: "Sort: Service score" },
  { value: "volume", label: "Sort: Most reviewed" },
];

const SORT_OPTIONS_HIDE_SERVICE = SORT_OPTIONS.filter((o) => o.value !== "service");

const PRICE_OPTIONS: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "$" },
  { value: 2, label: "$$" },
  { value: 3, label: "$$$" },
  { value: 4, label: "$$$$" },
];

const MIN_SCORE_OPTIONS: number[] = [5, 6, 7, 7.5, 8, 8.5, 9];
const MIN_MENTIONS_OPTIONS: number[] = [2, 5, 10, 25, 50];

export function FilterBar({
  sortKey,
  onSortKeyChange,
  filters,
  onFiltersChange,
  availableCuisines,
  availableNeighborhoods,
  availableTags,
  totalCount,
  filteredCount,
  hasSearchQuery,
  onClearFilters,
}: Props) {
  const active = hasActiveFilters(filters) || hasSearchQuery;
  const sortOptions = filters.hideService ? SORT_OPTIONS_HIDE_SERVICE : SORT_OPTIONS;

  // Single wrap-friendly row. Each select carries its field name as the
  // placeholder/active option (e.g. "All cuisines", "Any price") so we
  // don't need separate inline labels — that frees a lot of horizontal
  // budget for small laptops where this used to spill onto two lines.
  return (
    <div className="border-b border-rule px-6 py-2.5 bg-paper flex gap-2 items-center flex-wrap">
      <select
        value={sortKey}
        onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
        className={selectClasses}
        aria-label="Sort"
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <span className="text-rule-strong">·</span>

      <select
        value={filters.cuisine ?? ""}
        onChange={(e) => onFiltersChange({ ...filters, cuisine: e.target.value || null })}
        className={selectClasses}
        aria-label="Cuisine"
      >
        <option value="">All cuisines</option>
        {availableCuisines.map((slug) => (
          <option key={slug} value={slug}>
            {CUISINES_BY_SLUG[slug]?.label ?? slug}
          </option>
        ))}
      </select>

      <select
        value={filters.neighborhood ?? ""}
        onChange={(e) => onFiltersChange({ ...filters, neighborhood: e.target.value || null })}
        className={selectClasses}
        aria-label="Neighborhood"
      >
        <option value="">All neighborhoods</option>
        {availableNeighborhoods.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <select
        value={filters.priceLevel ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onFiltersChange({
            ...filters,
            priceLevel: raw ? (Number(raw) as 1 | 2 | 3 | 4) : null,
          });
        }}
        className={selectClasses}
        aria-label="Price"
      >
        <option value="">Any price</option>
        {PRICE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {availableTags.length > 0 && (
        <select
          value={filters.tag ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, tag: (e.target.value || null) as Tag | null })
          }
          className={selectClasses}
          aria-label="Vibe"
        >
          <option value="">Any vibe</option>
          {availableTags.map((t) => (
            <option key={t} value={t}>
              {TAG_LABELS[t]}
            </option>
          ))}
        </select>
      )}

      <select
        value={filters.minFoodScore ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onFiltersChange({ ...filters, minFoodScore: raw ? Number(raw) : null });
        }}
        className={selectClasses}
        aria-label="Minimum food score"
      >
        <option value="">Any food score</option>
        {MIN_SCORE_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {v.toFixed(1)}+
          </option>
        ))}
      </select>

      <select
        value={filters.minMentions ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onFiltersChange({ ...filters, minMentions: raw ? Number(raw) : null });
        }}
        className={selectClasses}
        aria-label="Minimum reviewers"
      >
        <option value="">Any reviewers</option>
        {MIN_MENTIONS_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {v}+
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 cursor-pointer select-none font-mono text-mono-sm uppercase tracking-wider text-ink-2">
        <input
          type="checkbox"
          checked={filters.hideService}
          onChange={(e) => onFiltersChange({ ...filters, hideService: e.target.checked })}
          className="cursor-pointer accent-accent"
        />
        <span>Hide service</span>
      </label>

      {active && (
        <button
          type="button"
          onClick={onClearFilters}
          className="font-mono text-mono-sm uppercase tracking-wider text-accent hover:text-accent-deep cursor-pointer"
        >
          Clear
        </button>
      )}

      <div className="ml-auto font-mono text-mono-sm uppercase tracking-wider text-ink-3">
        {active ? (
          <span>
            <span className="text-ink font-semibold">{filteredCount}</span> of {totalCount}
          </span>
        ) : (
          <span>
            <span className="text-ink font-semibold">{totalCount}</span> restaurants
          </span>
        )}
      </div>
    </div>
  );
}

// Editorial select chrome: paper background, rule-strong border, ink text,
// mono uppercase letter-spaced. cursor-pointer + active-state border swap so
// it feels clickable. No leading inline label — the placeholder option ("All
// cuisines", "Any price") doubles as the field's identity.
const selectClasses =
  "font-mono text-mono uppercase tracking-wider border border-rule-strong bg-paper px-2 py-1 text-ink cursor-pointer hover:border-ink focus:outline-none focus:border-ink";
