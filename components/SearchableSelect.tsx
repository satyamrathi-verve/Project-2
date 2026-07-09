"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inputClass } from "@/components/FormField";

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

/*
  A searchable dropdown for long lists (customers, GL accounts, …). Type to
  filter, click to pick. Reuse this instead of a plain <select> whenever a
  screen needs to search through more than a handful of options.
*/
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <div ref={rootRef} className="relative">
      <input
        className={`${inputClass} w-full`}
        value={open ? query : selected?.label ?? ""}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        placeholder={placeholder}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No matches.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setQuery("");
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-brand/10 ${
                  o.value === value
                    ? "bg-brand/5 font-semibold text-brand"
                    : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {o.label}
                {o.sublabel && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
