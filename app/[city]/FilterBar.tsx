"use client";

import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import {
  TAG_LABELS,
  hasActiveFilters,
  type Filters,
  type SortKey,
  type Tag,
} from "@/lib/types";
import { MultiSelect } from "./MultiSelect";

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

  return (
    <div className="border-b border-rule px-6 py-2.5 bg-paper flex gap-2 items-center flex-wrap">
      <select
        value={sortKey}
        onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
        className={`${selectClasses} max-w-[200px]`}
        aria-label="Sort"
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <span className="text-rule-strong">·</span>

      <MultiSelect
        label="Cuisine"
        clearLabel="All cuisines"
        options={availableCuisines.map((slug) => ({
          value: slug,
          label: CUISINES_BY_SLUG[slug]?.label ?? slug,
        }))}
        selected={filters.cuisines}
        onChange={(next) => onFiltersChange({ ...filters, cuisines: next })}
      />

      <MultiSelect
        label="Neighborhood"
        clearLabel="All neighborhoods"
        options={availableNeighborhoods.map((n) => ({ value: n, label: n }))}
        selected={filters.neighborhoods}
        onChange={(next) => onFiltersChange({ ...filters, neighborhoods: next })}
      />

      <MultiSelect
        label="Price"
        clearLabel="Any price"
        options={PRICE_OPTIONS}
        selected={filters.priceLevels}
        onChange={(next) =>
          onFiltersChange({ ...filters, priceLevels: next as Filters["priceLevels"] })
        }
        maxWidthClass="max-w-[140px]"
      />

      {availableTags.length > 0 && (
        <MultiSelect
          label="Vibe"
          clearLabel="Any vibe"
          options={availableTags.map((t) => ({ value: t, label: TAG_LABELS[t] }))}
          selected={filters.tags}
          onChange={(next) =>
            onFiltersChange({ ...filters, tags: next as Filters["tags"] })
          }
        />
      )}

      <select
        value={filters.minFoodScore ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onFiltersChange({ ...filters, minFoodScore: raw ? Number(raw) : null });
        }}
        className={`${selectClasses} max-w-[180px]`}
        aria-label="Minimum food rating"
      >
        <option value="">Food rating</option>
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
        className={`${selectClasses} max-w-[180px]`}
        aria-label="Minimum mentions"
      >
        <option value=""># of mentions</option>
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

const selectClasses =
  "font-mono text-mono uppercase tracking-wider border border-rule-strong bg-paper px-2 py-1 text-ink cursor-pointer hover:border-ink focus:outline-none focus:border-ink truncate";
