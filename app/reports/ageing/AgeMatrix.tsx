"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { FormField, inputClass } from "@/components/FormField";
import {
  BUCKET_COLORS,
  BUCKET_LABELS,
  BUCKET_ORDER,
  formatCompactINR,
  formatDate,
  formatINR,
  type BucketKey,
  type CustomerMatrixRow,
} from "./analytics";

type SortKey = "name" | "outstanding" | "maxAgeing" | "count";

/*
  Section 1 — Interactive Age Matrix.

  One row per customer, one column per ageing bucket. Each cell shows the
  outstanding amount + invoice count for that bucket, coloured by severity
  (green → dark red as ageing increases). Hovering a cell shows the full
  breakdown; clicking it drills into the existing Invoice-wise table below,
  pre-filtered to that customer + bucket (see onCellClick).
*/
export function AgeMatrix({
  rows,
  onCellClick,
}: {
  rows: CustomerMatrixRow[];
  onCellClick: (customerId: string, bucket: BucketKey) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("outstanding");

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
      : rows;
    const sorted = [...filtered];
    switch (sortKey) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "maxAgeing":
        sorted.sort((a, b) => b.maxAgeingDays - a.maxAgeingDays);
        break;
      case "count":
        sorted.sort((a, b) => b.totalInvoiceCount - a.totalInvoiceCount);
        break;
      default:
        sorted.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    }
    return sorted;
  }, [rows, search, sortKey]);

  return (
    <Card
      title="Interactive Age Matrix"
      subtitle="Where receivables are concentrated, customer by customer. Click a cell to drill into its invoices."
      className="mb-6"
      bodyClassName="p-0"
      action={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer…"
            className={`${inputClass} w-44`}
          />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={inputClass}>
            <option value="outstanding">Sort: Outstanding</option>
            <option value="name">Sort: Customer</option>
            <option value="maxAgeing">Sort: Max Ageing</option>
            <option value="count">Sort: Invoice Count</option>
          </select>
        </div>
      }
    >
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/90">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Customer
              </th>
              {BUCKET_ORDER.map((k) => (
                <th
                  key={k}
                  className="whitespace-nowrap px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  {BUCKET_LABELS[k]}
                </th>
              ))}
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Outstanding
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={BUCKET_ORDER.length + 2} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                  No customers match this search.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.customerId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{row.name}</td>
                  {BUCKET_ORDER.map((bucket) => (
                    <MatrixCell
                      key={bucket}
                      row={row}
                      bucket={bucket}
                      onClick={() => row.buckets[bucket].amount > 0 && onCellClick(row.customerId, bucket)}
                    />
                  ))}
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-white">
                    {formatINR(row.totalOutstanding)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MatrixCell({
  row,
  bucket,
  onClick,
}: {
  row: CustomerMatrixRow;
  bucket: BucketKey;
  onClick: () => void;
}) {
  const stat = row.buckets[bucket];
  const hasAmount = stat.amount > 0;
  const avgAgeing = stat.count > 0 ? Math.round(stat.sumAgeingDays / stat.count) : 0;
  const contribution = row.totalOutstanding > 0 ? Math.round((stat.amount / row.totalOutstanding) * 100) : 0;

  return (
    <td className="group relative px-2 py-2 text-center align-middle">
      <button
        type="button"
        onClick={onClick}
        disabled={!hasAmount}
        className={`w-full rounded-lg px-2 py-1.5 text-xs transition-transform ${
          hasAmount ? `${BUCKET_COLORS[bucket]} cursor-pointer hover:scale-[1.03]` : "text-slate-300 dark:text-slate-600"
        }`}
      >
        {hasAmount ? (
          <>
            <div className="font-semibold leading-tight">{formatCompactINR(stat.amount)}</div>
            <div className="text-[10px] leading-tight opacity-75">
              {stat.count} Inv.
            </div>
          </>
        ) : (
          "—"
        )}
      </button>

      {hasAmount && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 print:hidden"
        >
          <p className="mb-1 font-semibold text-slate-900 dark:text-white">{row.name}</p>
          <p className="mb-2 text-slate-400 dark:text-slate-500">{BUCKET_LABELS[bucket]}</p>
          <dl className="space-y-1">
            <TooltipRow label="Outstanding" value={formatINR(stat.amount)} />
            <TooltipRow label="Invoices" value={String(stat.count)} />
            <TooltipRow label="Oldest Invoice" value={formatDate(stat.oldestInvoiceDate)} />
            <TooltipRow label="Maximum Ageing" value={`${stat.maxAgeingDays} Days`} />
            <TooltipRow label="Average Ageing" value={`${avgAgeing} Days`} />
            <TooltipRow label="Largest Invoice" value={formatINR(stat.largestOutstanding)} />
            <TooltipRow label="Bucket Contribution" value={`${contribution}%`} />
          </dl>
        </div>
      )}
    </td>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}
