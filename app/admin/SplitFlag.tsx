"use client";

import { useMemo, useState } from "react";
import { splitFlag } from "./actions";

type Props = {
  flagId: string;
  /** The current `mention_text`, used to pre-populate naive splits. */
  originalMention: string;
};

/**
 * "Split…" affordance for low-confidence flags whose mention is actually
 * multiple restaurants in one string ("Woody's Wings + Tuti Grill +
 * Uncle Henry"). On submit, the server creates one new low-confidence
 * flag per name and deletes the original. Admin then reassigns each
 * new flag through the existing reassign flow.
 */
export function SplitFlag({ flagId, originalMention }: Props) {
  const [open, setOpen] = useState(false);
  const initialNames = useMemo(() => naiveSplit(originalMention), [originalMention]);
  const [names, setNames] = useState<string>(initialNames.join("\n"));

  const distinctCount = useMemo(() => {
    const seen = new Set<string>();
    for (const raw of names.split("\n")) {
      const v = raw.trim().replace(/\s+/g, " ").toLowerCase();
      if (v) seen.add(v);
    }
    return seen.size;
  }, [names]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
        title="Break this multi-restaurant mention into separate flags, one per restaurant"
      >
        Split…
      </button>
    );
  }

  return (
    <form
      action={splitFlag}
      className="border border-gray-300 dark:border-gray-700 rounded p-3 mt-2 w-full"
    >
      <input type="hidden" name="flagId" value={flagId} />
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        Split into separate restaurants
      </div>
      <p className="text-xs text-gray-500 mb-2">
        One restaurant per line. Each line becomes a new low-confidence flag
        you&apos;ll resolve via Reassign. The original flag goes away.
      </p>
      <textarea
        name="names"
        value={names}
        onChange={(e) => setNames(e.target.value)}
        rows={Math.max(3, names.split("\n").length)}
        className="w-full text-sm border border-gray-300 dark:border-gray-700 rounded p-2 bg-white dark:bg-gray-900 font-mono"
      />
      <div className="flex items-center justify-between mt-2 gap-3">
        <div className="text-xs text-gray-500">
          {distinctCount} distinct name{distinctCount === 1 ? "" : "s"}
          {distinctCount < 2 && " (need at least 2 to split)"}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={distinctCount < 2}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded px-3 py-1.5"
          >
            Split into {distinctCount}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Best-effort split on the common multi-mention separators we've seen in
 * extracted text: ` + `, ` & `, `, `, ` and `. Plus normalize whitespace.
 * Always returns at least one entry (the original) so the textarea isn't
 * accidentally empty if the heuristic fails.
 */
function naiveSplit(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/\s*[,+&]\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}
