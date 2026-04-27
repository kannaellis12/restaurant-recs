"use client";

import { useState, useTransition } from "react";
import {
  markRestaurantClosed,
  skipFlag,
  updateRestaurantWebsite,
} from "./actions";

type Props = {
  flagId: string;
  restaurantId: string;
  currentWebsite: string | null;
};

/**
 * Secondary actions on a missing_cuisine card. Sit alongside the cuisine
 * Save button (which is rendered separately in CuisineAssignment).
 */
export function MissingCuisineActions({
  flagId,
  restaurantId,
  currentWebsite,
}: Props) {
  const [editingWebsite, setEditingWebsite] = useState(false);
  const [websiteDraft, setWebsiteDraft] = useState(currentWebsite ?? "");
  const [pending, startTransition] = useTransition();

  const handleSaveWebsite = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("restaurantId", restaurantId);
      fd.append("website", websiteDraft);
      await updateRestaurantWebsite(fd);
      setEditingWebsite(false);
    });
  };

  if (editingWebsite) {
    return (
      <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-3">
        <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">
          Website
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={websiteDraft}
            onChange={(e) => setWebsiteDraft(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 bg-white dark:bg-gray-900"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSaveWebsite();
              }
            }}
          />
          <button
            type="button"
            onClick={handleSaveWebsite}
            disabled={pending}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {pending ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingWebsite(false);
              setWebsiteDraft(currentWebsite ?? "");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 px-2"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <form
        action={markRestaurantClosed}
        onSubmit={(e) => {
          // Confirm before closing — destructive (hides the restaurant from /[city]).
          if (!confirm("Mark this restaurant as permanently closed?")) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="flagId" value={flagId} />
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <button
          type="submit"
          className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-300 dark:hover:border-red-800 hover:text-red-700 dark:hover:text-red-400 transition-colors"
        >
          Mark permanently closed
        </button>
      </form>

      <button
        type="button"
        onClick={() => setEditingWebsite(true)}
        className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        Edit website
      </button>

      <form action={skipFlag}>
        <input type="hidden" name="flagId" value={flagId} />
        <button
          type="submit"
          className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2"
        >
          Skip
        </button>
      </form>
    </div>
  );
}
