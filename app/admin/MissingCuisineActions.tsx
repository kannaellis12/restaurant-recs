"use client";

import { useState, useTransition } from "react";
import {
  markNotARestaurant,
  markRestaurantClosed,
  skipFlag,
  updateRestaurantDetails,
} from "./actions";

type Props = {
  flagId: string;
  restaurantId: string;
  currentName: string;
  currentWebsite: string | null;
};

/**
 * Secondary actions on a missing_cuisine card. Sit alongside the cuisine
 * Save button (which is rendered separately in CuisineAssignment).
 */
export function MissingCuisineActions({
  flagId,
  restaurantId,
  currentName,
  currentWebsite,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(currentName);
  const [websiteDraft, setWebsiteDraft] = useState(currentWebsite ?? "");
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("restaurantId", restaurantId);
      fd.append("name", nameDraft);
      fd.append("website", websiteDraft);
      await updateRestaurantDetails(fd);
      setEditing(false);
    });
  };

  if (editing) {
    return (
      <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Name
          </span>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Restaurant name"
            className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 bg-white dark:bg-gray-900"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Website
          </span>
          <input
            type="url"
            value={websiteDraft}
            onChange={(e) => setWebsiteDraft(e.target.value)}
            placeholder="https://example.com"
            className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 bg-white dark:bg-gray-900"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNameDraft(currentName);
              setWebsiteDraft(currentWebsite ?? "");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5"
          >
            {pending ? "Saving…" : "Save details"}
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

      <form
        action={markNotARestaurant}
        onSubmit={(e) => {
          if (
            !confirm(
              "Mark this as not a restaurant? Closes the row AND nulls out its extractions so the bad signal stops counting.",
            )
          ) {
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
          Not a restaurant
        </button>
      </form>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        Edit name + website
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
