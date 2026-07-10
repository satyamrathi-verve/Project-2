"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

/*
  Contents of a column's Excel-style filter popup — rendered inside DataTable's
  own `column.filter` popup (DataTable owns the funnel trigger + positioning).

  Provides:
    - Sort ascending / Sort descending
    - a search box
    - a checkbox list of the column's distinct values (Select all / Clear all)

  Reusable by any list screen: pass the column's distinct `options`, the current
  `value` (a Set of included values, or undefined = no filter / all pass), and an
  `onChange`. Filtering the rows is the caller's job — this only owns the UI +
  selection.
*/

function IconArrow({ dir, className = "" }: { dir: "up" | "down"; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {dir === "up" ? <path d="M12 19V5M6 11l6-6 6 6" /> : <path d="M12 5v14M18 13l-6 6-6-6" />}
    </svg>
  );
}

export function ColumnFilterMenu({
  options,
  value,
  onChange,
  sortDir,
  onSortAsc,
  onSortDesc,
}: {
  /** All distinct values for the column (display strings). */
  options: string[];
  /** Included values, or undefined when no filter is applied (all pass). */
  value?: ReadonlySet<string>;
  /** undefined clears the filter (all pass); a Set keeps only those values. */
  onChange: (next: Set<string> | undefined) => void;
  /** Current sort direction if this column is the active sort. */
  sortDir?: "asc" | "desc";
  onSortAsc?: () => void;
  onSortDesc?: () => void;
}) {
  const [query, setQuery] = useState("");

  const included = value ?? new Set(options); // no filter -> everything checked
  const shown = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(o: string) {
    const next = new Set(included);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(next.size === options.length ? undefined : next);
  }

  const sortRow =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors";

  return (
    <div className="text-slate-700 dark:text-slate-200">
      {/* sort */}
      <button
        type="button"
        onClick={() => onSortAsc?.()}
        className={cx(sortRow, sortDir === "asc" ? "bg-brand/10 text-brand dark:bg-brand/20 dark:text-blue-300" : "hover:bg-slate-100 dark:hover:bg-slate-700/60")}
      >
        <IconArrow dir="up" className="h-4 w-4 flex-none" />
        Sort ascending
      </button>
      <button
        type="button"
        onClick={() => onSortDesc?.()}
        className={cx(sortRow, sortDir === "desc" ? "bg-brand/10 text-brand dark:bg-brand/20 dark:text-blue-300" : "hover:bg-slate-100 dark:hover:bg-slate-700/60")}
      >
        <IconArrow dir="down" className="h-4 w-4 flex-none" />
        Sort descending
      </button>

      <div className="my-1.5 border-t border-slate-100 dark:border-slate-700/60" />

      {/* search + select/clear */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search values…"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
      />
      <div className="mt-2 flex items-center justify-between px-0.5 text-xs">
        <span className="text-slate-400 dark:text-slate-500">{included.size} selected</span>
        <span className="flex gap-3">
          <button type="button" onClick={() => onChange(undefined)} className="font-medium text-brand hover:underline dark:text-blue-400">
            Select all
          </button>
          <button type="button" onClick={() => onChange(new Set())} className="font-medium text-brand hover:underline dark:text-blue-400">
            Clear all
          </button>
        </span>
      </div>

      {/* value checklist */}
      <div className="mt-1.5 max-h-52 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-2.5 py-5 text-center text-xs text-slate-400 dark:text-slate-500">No values match.</p>
        ) : (
          shown.map((o) => (
            <label
              key={o}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/60"
            >
              <input
                type="checkbox"
                checked={included.has(o)}
                onChange={() => toggle(o)}
                className="h-4 w-4 flex-none rounded border-slate-300 accent-brand dark:border-slate-600"
              />
              <span className="truncate">{o || "—"}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
