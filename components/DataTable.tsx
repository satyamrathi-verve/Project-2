import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
  /** Set to allow clicking this header to sort — needs `sort`/`onSortChange` on the table too. */
  sortable?: boolean;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.

  Optional premium extras (all backward-compatible):
    stickyHeader    — header stays visible while the page scrolls
    onRowClick      — makes rows clickable (adds pointer + hover cue)
    sort/onSortChange — pass together with `sortable` columns for clickable,
                      arrow-indicated header sorting; the table doesn't reorder
                      rows itself — sort the array you pass in based on `sort`
                      so the caller stays the source of truth.
    selectable      — adds a checkbox column with a select-all header checkbox;
                      pass selectedIds (Set) + onSelectionChange to control it
    headerAccessory — small node rendered in the leading header cell (e.g. a
                      customize-columns trigger). NOTE: the table wrapper clips
                      overflow, so render any dropdown/popup at page level with
                      fixed positioning, not inside the accessory itself.
*/
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
  stickyHeader = false,
  sort,
  onSortChange,
  onRowClick,
  headerAccessory,
  selectable = false,
  selectedIds,
  onSelectionChange,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  stickyHeader?: boolean;
  sort?: SortState;
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  headerAccessory?: ReactNode;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: string[]) => void;
}) {
  const sel = selectedIds ?? new Set<string>();
  const allIds = rows.map((r) => r.id);
  const allSelected = rows.length > 0 && allIds.every((id) => sel.has(id));
  const someSelected = allIds.some((id) => sel.has(id));
  const showLeading = selectable || Boolean(headerAccessory);

  const toggleAll = () => onSelectionChange?.(allSelected ? [] : allIds);
  const toggleRow = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.(Array.from(next));
  };

  const checkboxClass =
    "h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:border-slate-600";

  return (
    <div className="themed overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className={`border-b border-slate-200 bg-slate-50/90 text-left backdrop-blur dark:border-slate-800 dark:bg-slate-800/60 ${
                stickyHeader ? "sticky top-0 z-10" : ""
              }`}
            >
              {showLeading && (
                <th className="w-14 whitespace-nowrap px-3 py-3">
                  <span className="flex items-center gap-2">
                    {headerAccessory}
                    {selectable && (
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allSelected && someSelected;
                        }}
                        onChange={toggleAll}
                        className={checkboxClass}
                      />
                    )}
                  </span>
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                if (c.sortable && onSortChange) {
                  return (
                    <th
                      key={c.key}
                      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${c.className ?? ""}`}
                    >
                      <button
                        onClick={() => onSortChange(c.key)}
                        className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        {c.header}
                        <span className="text-[10px] text-slate-400">
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                }
                return (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${c.className ?? ""}`}
                  >
                    {c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (showLeading ? 1 : 0)}
                  className="px-4 py-14 text-center text-slate-400 dark:text-slate-500"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-brand/[0.03] dark:border-slate-800 dark:hover:bg-brand/[0.08] ${
                    onRowClick ? "cursor-pointer" : ""
                  } ${selectable && sel.has(row.id) ? "bg-brand/[0.04] dark:bg-brand/[0.1]" : ""}`}
                >
                  {showLeading && (
                    <td className="w-14 px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {selectable && (
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={sel.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          className={checkboxClass}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3.5 text-slate-700 dark:text-slate-300 ${c.className ?? ""}`}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
