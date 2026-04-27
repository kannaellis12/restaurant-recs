"use client";

import { CUISINES_BY_SLUG } from "@/lib/cuisines";
import { hasActiveFilters, type Filters, type SortKey } from "@/lib/types";

type Props = {
  sortKey: SortKey;
  onSortKeyChange: (s: SortKey) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  availableCuisines: string[];
  availableNeighborhoods: string[];
  totalCount: number;
  filteredCount: number;
  onClearFilters: () => void;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank", label: "Rank" },
  { value: "food", label: "Food score" },
  { value: "service", label: "Service score" },
  { value: "volume", label: "Most reviewed" },
];

const SORT_OPTIONS_HIDE_SERVICE = SORT_OPTIONS.filter((o) => o.value !== "service");

const PRICE_OPTIONS: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "$" },
  { value: 2, label: "$$" },
  { value: 3, label: "$$$" },
  { value: 4, label: "$$$$" },
];

export function FilterBar({
  sortKey,
  onSortKeyChange,
  filters,
  onFiltersChange,
  availableCuisines,
  availableNeighborhoods,
  totalCount,
  filteredCount,
  onClearFilters,
}: Props) {
  const active = hasActiveFilters(filters);
  const sortOptions = filters.hideService ? SORT_OPTIONS_HIDE_SERVICE : SORT_OPTIONS;

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-2 flex gap-3 items-center flex-wrap text-sm">
      <Field label="Sort">
        <select
          value={sortKey}
          onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
          className={selectClasses}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <span className="text-gray-300 dark:text-gray-700">|</span>

      <Field label="Cuisine">
        <select
          value={filters.cuisine ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, cuisine: e.target.value || null })
          }
          className={selectClasses}
        >
          <option value="">All</option>
          {availableCuisines.map((slug) => (
            <option key={slug} value={slug}>
              {CUISINES_BY_SLUG[slug]?.label ?? slug}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Neighborhood">
        <select
          value={filters.neighborhood ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, neighborhood: e.target.value || null })
          }
          className={selectClasses}
        >
          <option value="">All</option>
          {availableNeighborhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Price">
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
        >
          <option value="">Any</option>
          {PRICE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.hideService}
          onChange={(e) =>
            onFiltersChange({ ...filters, hideService: e.target.checked })
          }
          className="cursor-pointer"
        />
        <span className="text-gray-700 dark:text-gray-300">Hide service reviews</span>
      </label>

      {active && (
        <button
          onClick={onClearFilters}
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Clear filters
        </button>
      )}

      <div className="ml-auto text-gray-500 dark:text-gray-400">
        {active ? (
          <span>
            <span className="font-semibold">{filteredCount}</span> of {totalCount} restaurant
            {totalCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span>
            <span className="font-semibold">{totalCount}</span> restaurant
            {totalCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

const selectClasses =
  "rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
