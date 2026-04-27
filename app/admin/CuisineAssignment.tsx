"use client";

import { useState, useTransition } from "react";
import { CUISINES, MAX_CUISINES_PER_RESTAURANT } from "@/lib/cuisines";
import { assignCuisines } from "./actions";

type Props = {
  flagId: string;
};

/**
 * Multi-select of the 26 cuisines, capped at 3, with a Save button that
 * fires the `assignCuisines` server action. Rendered inside a FlagCard
 * when the flag's kind is `missing_cuisine`.
 */
export function CuisineAssignment({ flagId }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const toggle = (slug: string) => {
    setSelected((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= MAX_CUISINES_PER_RESTAURANT) return prev;
      return [...prev, slug];
    });
  };

  const handleSubmit = () => {
    if (selected.length === 0) return;
    const fd = new FormData();
    fd.append("flagId", flagId);
    for (const s of selected) fd.append("cuisines", s);
    startTransition(async () => {
      await assignCuisines(fd);
    });
  };

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
        Assign cuisine{" "}
        <span className="text-gray-400">
          ({selected.length}/{MAX_CUISINES_PER_RESTAURANT})
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CUISINES.map((c) => {
          const isSelected = selected.includes(c.slug);
          const disabled = !isSelected && selected.length >= MAX_CUISINES_PER_RESTAURANT;
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => toggle(c.slug)}
              disabled={disabled || pending}
              data-selected={isSelected}
              className="text-xs border border-gray-300 dark:border-gray-700 rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900 data-[selected=true]:bg-blue-600 data-[selected=true]:border-blue-600 data-[selected=true]:text-white data-[selected=true]:hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={selected.length === 0 || pending}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
        >
          {pending
            ? "Saving…"
            : `Save ${selected.length} cuisine${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
