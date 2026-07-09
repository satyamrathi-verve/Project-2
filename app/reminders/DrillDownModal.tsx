"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { inputClass } from "@/components/FormField";
import { IconX } from "@/components/ui";

const PAGE_SIZE = 10;

/*
  One generic modal reused by all four Auto Email Shoot KPI drill-downs
  (Total Outstanding, Overdue, Eligible for Reminder, Reminders Sent). Each
  caller supplies already-shaped rows, DataTable columns, a search
  predicate, and per-column sort comparators — the modal owns search, sort,
  pagination and CSV export so that behaviour stays identical across all
  four drill-downs instead of being reimplemented four times.
*/
export function DrillDownModal<T extends { id: string }>({
  title,
  subtitle,
  rows,
  columns,
  searchPlaceholder = "Search…",
  searchPredicate,
  sortComparators,
  defaultSort,
  csvHeader,
  toCsvRow,
  filename,
  onClose,
}: {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  searchPredicate: (row: T, query: string) => boolean;
  sortComparators: Record<string, (a: T, b: T) => number>;
  defaultSort: SortState;
  csvHeader: string[];
  toCsvRow: (row: T) => (string | number)[];
  filename: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [page, setPage] = useState(1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q ? rows.filter((r) => searchPredicate(r, q)) : rows;
    const cmp = sortComparators[sort.key];
    if (cmp) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => cmp(a, b) * dir);
    }
    return out;
  }, [rows, search, searchPredicate, sort, sortComparators]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function exportCsv() {
    const csv = [csvHeader, ...filtered.map(toCsvRow)]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="themed flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/30">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className={`${inputClass} w-64`}
          />
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Export CSV
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <DataTable
            columns={columns}
            rows={paged}
            sort={sort}
            onSortChange={(key) =>
              setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }))
            }
            stickyHeader
            empty="No records match your search."
          />
        </div>
        <div className="border-t border-slate-200 dark:border-slate-800">
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}
