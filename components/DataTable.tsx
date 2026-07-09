import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
}

/*
  A plain, reusable table. Copy this pattern for every list screen (invoices,
  receipts, GL accounts…). Pass your columns and rows; it handles the empty state.

  Optional premium extras (all backward-compatible):
    stickyHeader — header stays visible while the page scrolls
    onRowClick   — makes rows clickable (adds pointer + hover cue)
*/
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
  stickyHeader = false,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  stickyHeader?: boolean;
  onRowClick?: (row: T) => void;
}) {
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
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center text-slate-400 dark:text-slate-500">
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
                  }`}
                >
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
