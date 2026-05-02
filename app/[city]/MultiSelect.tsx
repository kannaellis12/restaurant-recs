"use client";

import { useEffect, useRef, useState } from "react";

export type MultiSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  /** Field name shown when nothing is selected (e.g. "Cuisine"). */
  label: string;
  options: MultiSelectOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  /** Text for the in-panel "clear" row, e.g. "All cuisines" or "Any vibe".
   *  Clicking it deselects everything. */
  clearLabel: string;
  /** Trigger button max width — keeps the filter row tidy on small screens. */
  maxWidthClass?: string;
};

/**
 * Editorial-styled multi-select. Trigger reads as the field name (no "All …"
 * placeholder per the design — empty state is implicit), with a count
 * appended once the user picks something. Panel is a checkbox list with a
 * dedicated "clear" row at the top for one-click reset.
 *
 * Native `<select>` can't do multi-select as a dropdown (it renders a
 * listbox), so this is a custom popover. Closes on outside click + Escape.
 */
export function MultiSelect<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  clearLabel,
  maxWidthClass = "max-w-[200px]",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = new Set<T>(selected);

  const toggle = (value: T) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const trigger =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${options.find((o) => o.value === selected[0])?.label ?? ""}`
        : `${label} (${selected.length})`;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          "font-mono text-mono uppercase tracking-wider border bg-paper pl-2 pr-1.5 py-1 text-ink cursor-pointer hover:border-ink focus:outline-none focus:border-ink inline-flex items-center gap-1.5",
          selected.length > 0 ? "border-ink" : "border-rule-strong",
          maxWidthClass,
        ].join(" ")}
      >
        <span className="truncate min-w-0">{trigger}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 10 6"
          className={`w-2.5 h-1.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute top-full left-0 mt-1 z-30 min-w-[220px] max-h-[320px] overflow-y-auto bg-paper border border-rule-strong shadow-md"
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full text-left font-mono text-mono uppercase tracking-wider px-3 py-2 border-b border-rule text-ink-3 hover:bg-paper-2 cursor-pointer"
          >
            {clearLabel}
          </button>
          {options.map((o) => {
            const checked = selectedSet.has(o.value);
            return (
              <label
                key={String(o.value)}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-paper-2 font-mono text-mono uppercase tracking-wider text-ink"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.value)}
                  className="cursor-pointer accent-accent"
                />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
