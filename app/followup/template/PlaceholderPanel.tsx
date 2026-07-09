"use client";

import { useMemo, useState } from "react";
import { IconSearch } from "@/components/ui";
import { PLACEHOLDER_CATALOG, PLACEHOLDER_CATEGORIES } from "./reminderTemplateConfig";

export function PlaceholderPanel({ onInsert }: { onInsert: (token: string) => void }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PLACEHOLDER_CATALOG.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.token.toLowerCase().includes(q)
    );
    return PLACEHOLDER_CATEGORIES.map((category) => ({
      category,
      items: filtered.filter((p) => p.category === category),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search placeholders…"
          aria-label="Search placeholders"
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
        />
      </div>

      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">No placeholders match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {g.category}
              </p>
              <div className="mt-1.5 space-y-1.5">
                {g.items.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => onInsert(p.token)}
                    title={p.description}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-brand hover:bg-brand/5 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-brand dark:hover:bg-brand/10"
                  >
                    <span className="min-w-0">
                      <code className="font-mono font-semibold text-brand dark:text-blue-300">{p.token}</code>
                      <span className="ml-1.5 text-slate-500 dark:text-slate-400">{p.label}</span>
                    </span>
                    <span className="flex-none text-slate-300 dark:text-slate-600">Insert</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
