"use client";

import { useCallback, useState } from "react";
import type { SortState } from "@/components/DataTable";

/*
  Reusable table-sort STATE.

  This tracks which column is the active sort and in which direction. It does
  NOT reorder any data itself — a list screen owns the state via this hook,
  feeds `sort` + `toggleSort` straight into <DataTable>, and (once it's ready to
  actually sort) derives its visible rows from `sort`.

  Rules:
  - Only one column is ever active at a time — selecting a new column replaces
    the previous one.
  - Clicking the already-active column flips its direction (asc <-> desc).

  Designed to be dropped into Receipts today and reused verbatim by Invoices,
  Payments and Customers later: every list that renders a <DataTable> shares
  this same hook.

    const { sort, toggleSort } = useTableSort();
    <DataTable sort={sort} onSortChange={toggleSort} columns={cols} rows={rows} />
*/

export type SortDirection = "asc" | "desc";
// Re-exported so a screen can grab the type from one place alongside the hook.
export type { SortState };

export interface UseTableSortOptions {
  /** Column (and direction) active on first render. Omit for "nothing sorted yet". */
  initial?: SortState;
  /** Direction applied the first time a column becomes active. Defaults to "asc". */
  defaultDirection?: SortDirection;
}

export interface TableSort {
  /** The active sort, or `undefined` when no column is selected. */
  sort: SortState | undefined;
  /** Header-click handler: activates a column, or flips it if already active. */
  toggleSort: (key: string) => void;
  /** Set or clear the sort directly (e.g. to restore a saved preference). */
  setSort: (sort: SortState | undefined) => void;
  /** Whether a given column is currently the active sort column. */
  isActive: (key: string) => boolean;
}

export function useTableSort({ initial, defaultDirection = "asc" }: UseTableSortOptions = {}): TableSort {
  const [sort, setSort] = useState<SortState | undefined>(initial);

  const toggleSort = useCallback(
    (key: string) => {
      setSort((prev) =>
        prev && prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } // same column -> flip direction
          : { key, dir: defaultDirection } // new column -> activate it (only one active at a time)
      );
    },
    [defaultDirection]
  );

  const isActive = useCallback((key: string) => sort?.key === key, [sort]);

  return { sort, toggleSort, setSort, isActive };
}
