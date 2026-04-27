"use client";

import { useState, useTransition } from "react";
import { CUISINES, CUISINES_BY_SLUG, MAX_CUISINES_PER_RESTAURANT } from "@/lib/cuisines";
import { markRestaurantClosed, updateRestaurant } from "./actions";

export type EditableRestaurant = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  cuisines: string[];
  price_level: number | null;
  website: string | null;
};

const PRICE_OPTIONS: { value: number | null; label: string }[] = [
  { value: 1, label: "$" },
  { value: 2, label: "$$" },
  { value: 3, label: "$$$" },
  { value: 4, label: "$$$$" },
  { value: null, label: "—" },
];

export function RestaurantEditor({ restaurant }: { restaurant: EditableRestaurant }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <RestaurantRow r={restaurant} onEdit={() => setOpen(true)} />;
  }
  return <RestaurantEditForm r={restaurant} onClose={() => setOpen(false)} />;
}

function RestaurantRow({
  r,
  onEdit,
}: {
  r: EditableRestaurant;
  onEdit: () => void;
}) {
  const cuisineLabels =
    r.cuisines.map((c) => CUISINES_BY_SLUG[c]?.label ?? c).join(", ") || "—";
  const price = r.price_level ? "$".repeat(r.price_level) : "—";
  let host = "—";
  if (r.website) {
    try {
      host = new URL(r.website).host;
    } catch {
      host = r.website;
    }
  }
  return (
    <div className="grid grid-cols-[2fr_1.2fr_1.5fr_0.5fr_1.2fr_auto] gap-3 items-baseline border-b border-gray-100 dark:border-gray-900 py-2 text-sm">
      <div className="font-medium truncate">{r.name}</div>
      <div className="text-gray-500 truncate">{r.neighborhood ?? "—"}</div>
      <div className="text-gray-500 truncate">{cuisineLabels}</div>
      <div className="text-gray-500">{price}</div>
      <div className="text-gray-500 truncate">{host}</div>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        Edit
      </button>
    </div>
  );
}

function RestaurantEditForm({
  r,
  onClose,
}: {
  r: EditableRestaurant;
  onClose: () => void;
}) {
  const [neighborhood, setNeighborhood] = useState(r.neighborhood ?? "");
  const [cuisines, setCuisines] = useState<string[]>(r.cuisines);
  const [priceLevel, setPriceLevel] = useState<number | null>(r.price_level);
  const [website, setWebsite] = useState(r.website ?? "");
  const [pending, startTransition] = useTransition();
  const [closing, startClose] = useTransition();

  const toggleCuisine = (slug: string) => {
    setCuisines((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= MAX_CUISINES_PER_RESTAURANT) return prev;
      return [...prev, slug];
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("restaurantId", r.id);
      fd.append("neighborhood", neighborhood);
      for (const c of cuisines) fd.append("cuisines", c);
      if (priceLevel !== null) fd.append("priceLevel", String(priceLevel));
      fd.append("website", website);
      await updateRestaurant(fd);
      onClose();
    });
  };

  const handleClose = () => {
    if (!confirm(`Mark ${r.name} as permanently closed?`)) return;
    startClose(async () => {
      const fd = new FormData();
      fd.append("restaurantId", r.id);
      await markRestaurantClosed(fd);
      onClose();
    });
  };

  return (
    <div className="border-y border-gray-300 dark:border-gray-700 bg-paper-2 -mx-4 px-4 py-4 my-1">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">{r.name}</h3>
          {r.address && (
            <div className="text-xs text-gray-500 mt-0.5">{r.address}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Neighborhood
          </span>
          <input
            type="text"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            placeholder="e.g. RiNo, Congress Park"
            className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded px-2 py-1.5"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Website
          </span>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
            className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded px-2 py-1.5"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
          Price level
        </div>
        <div className="flex gap-1">
          {PRICE_OPTIONS.map((p) => {
            const isSelected = priceLevel === p.value;
            return (
              <button
                key={String(p.value)}
                type="button"
                onClick={() => setPriceLevel(p.value)}
                data-selected={isSelected}
                className="text-xs border border-gray-300 dark:border-gray-700 rounded px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-900 data-[selected=true]:bg-blue-600 data-[selected=true]:border-blue-600 data-[selected=true]:text-white"
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
          Cuisines{" "}
          <span className="text-gray-400">
            ({cuisines.length}/{MAX_CUISINES_PER_RESTAURANT})
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CUISINES.map((c) => {
            const isSelected = cuisines.includes(c.slug);
            const disabled =
              !isSelected && cuisines.length >= MAX_CUISINES_PER_RESTAURANT;
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => toggleCuisine(c.slug)}
                disabled={disabled}
                data-selected={isSelected}
                className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900 data-[selected=true]:bg-blue-600 data-[selected=true]:border-blue-600 data-[selected=true]:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 justify-between items-center mt-5">
        <button
          type="button"
          onClick={handleClose}
          disabled={closing}
          className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-300 dark:hover:border-red-800 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50"
        >
          {closing ? "Closing…" : "Mark permanently closed"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
