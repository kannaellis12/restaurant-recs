"use client";

import { useState, useTransition } from "react";
import { reassignFlag, searchPlacesForReassign } from "./actions";
import type { PlaceLite } from "@/lib/google-places";

type Props = {
  flagId: string;
  citySlug: string;
};

/**
 * Inline manual reassign UI for low-confidence flags. Toggled open from the
 * FlagCard's "Reassign" button. Keeps the searching state local; submits
 * via two server actions: searchPlacesForReassign + reassignFlag.
 */
export function ManualReassign({ flagId, citySlug }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceLite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [reassigning, startReassign] = useTransition();

  const handleSearch = () => {
    setError(null);
    setResults(null);
    setSelectedPlaceId(null);
    if (!query.trim()) return;
    startSearch(async () => {
      try {
        const places = await searchPlacesForReassign(citySlug, query);
        setResults(places);
        if (places.length === 1) setSelectedPlaceId(places[0].placeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      }
    });
  };

  const handleReassign = () => {
    if (!selectedPlaceId) return;
    startReassign(async () => {
      try {
        const fd = new FormData();
        fd.append("flagId", flagId);
        fd.append("placeId", selectedPlaceId);
        await reassignFlag(fd);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reassign failed");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        Reassign…
      </button>
    );
  }

  return (
    <div className="w-full mt-3 border-t border-gray-200 dark:border-gray-800 pt-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="Restaurant name (e.g. 'Carmine Lonardo')"
          className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 bg-white dark:bg-gray-900"
          autoFocus
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:text-gray-700 px-2"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</div>
      )}

      {results && results.length === 0 && (
        <div className="text-sm text-gray-500 mt-3">No matches in {citySlug}.</div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-1 mt-3">
          {results.map((p) => (
            <label
              key={p.placeId}
              data-selected={selectedPlaceId === p.placeId}
              className="flex items-start gap-3 p-2 rounded border border-transparent hover:border-gray-200 dark:hover:border-gray-800 cursor-pointer data-[selected=true]:border-blue-600 data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-950/40"
            >
              <input
                type="radio"
                name={`place-${flagId}`}
                value={p.placeId}
                checked={selectedPlaceId === p.placeId}
                onChange={() => setSelectedPlaceId(p.placeId)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{p.name}</div>
                {p.address && (
                  <div className="text-xs text-gray-500">{p.address}</div>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  {p.types.slice(0, 4).join(" · ") || "—"}
                  {p.rating !== null && (
                    <>
                      {" · "}★ {p.rating.toFixed(1)}
                      {p.reviewCount !== null && ` (${p.reviewCount})`}
                    </>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={handleReassign}
            disabled={!selectedPlaceId || reassigning}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {reassigning ? "Reassigning…" : "Reassign to selected"}
          </button>
        </div>
      )}
    </div>
  );
}
