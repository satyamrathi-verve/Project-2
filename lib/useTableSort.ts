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
  /**
   * Whether a third click on the active column clears the sort (returns to the
   * original order). Defaults to true — the Zoho-style asc → desc → off cycle.
   * Set false for a 2-state asc <-> desc toggle that never clears.
   */
  allowUnsorted?: boolean;
}

export interface TableSort {
  /** The active sort, or `undefined` when no column is selected (original order). */
  sort: SortState | undefined;
  /** Header-click handler: cycles the clicked column through asc → desc → off. */
  toggleSort: (key: string) => void;
  /** Set or clear the sort directly (e.g. to restore a saved preference). */
  setSort: (sort: SortState | undefined) => void;
  /** Whether a given column is currently the active sort column. */
  isActive: (key: string) => boolean;
}

export function useTableSort({
  initial,
  defaultDirection = "asc",
  allowUnsorted = true,
}: UseTableSortOptions = {}): TableSort {
  const [sort, setSort] = useState<SortState | undefined>(initial);

  // Tri-state cycle, one active column at a time:
  //   new column    -> ascending          (1st click)
  //   active + asc   -> descending         (2nd click)
  //   active + desc  -> cleared / original (3rd click; or back to asc if reset off)
  const toggleSort = useCallback(
    (key: string) => {
      setSort((prev) => {
        if (!prev || prev.key !== key) return { key, dir: defaultDirection };
        if (prev.dir === "asc") return { key, dir: "desc" };
        return allowUnsorted ? undefined : { key, dir: defaultDirection };
      });
    },
    [defaultDirection, allowUnsorted]
  );

  const isActive = useCallback((key: string) => sort?.key === key, [sort]);

  return { sort, toggleSort, setSort, isActive };
}
