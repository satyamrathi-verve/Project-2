import type { SortState } from "@/components/DataTable";

/*
  Reusable, memo-friendly row sorting that pairs with useTableSort.

  A screen describes each sortable column once — how to read its value and how
  to compare it — then calls sortRows(rows, sort, columns) inside a useMemo.
  Returns a NEW array (never mutates the input) and is a pure function, so it
  drops straight into Receipts today and Invoices / Payments / Customers later.

  Comparison kinds:
    text   — alphanumeric, locale + number aware ("RCP-9" before "RCP-10")
    number — numeric
    date   — chronological (parses date strings / Date values)
*/

export type SortType = "text" | "number" | "date";

export interface SortColumn<T> {
  /** Value to compare rows by for this column. */
  accessor: (row: T) => string | number | null | undefined;
  /** How to compare it. Defaults to "text". */
  type?: SortType;
}

// Shared collator: `numeric` so "RCP-9" sorts before "RCP-10", case-insensitive.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  type: SortType
): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return -1; // blanks sort lowest (first ascending, last descending)
  if (bNil) return 1;
  if (type === "number") return Number(a) - Number(b);
  if (type === "date") return new Date(a as string | number).getTime() - new Date(b as string | number).getTime();
  return collator.compare(String(a), String(b));
}

/**
 * Sort `rows` by the active `sort` using the per-column accessors/types.
 * With no active sort (or an unknown key) the input order is returned unchanged.
 */
export function sortRows<T>(
  rows: T[],
  sort: SortState | undefined,
  columns: Record<string, SortColumn<T>>
): T[] {
  if (!sort) return rows;
  const col = columns[sort.key];
  if (!col) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  // Array.prototype.sort is stable (ES2019+), so equal rows keep their order.
  return [...rows].sort((a, b) => compare(col.accessor(a), col.accessor(b), col.type ?? "text") * dir);
}
