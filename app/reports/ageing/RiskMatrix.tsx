"use client";

import { Card } from "@/components/ui";
import { FormField, inputClass } from "@/components/FormField";
import {
  formatINR,
  RECOMMENDED_ACTION,
  RISK_COLORS,
  RISK_ORDER,
  type CustomerMatrixRow,
  type RiskLevel,
} from "./analytics";

export interface RiskRow extends CustomerMatrixRow {
  risk: RiskLevel;
}

/*
  Section 2 — Customer Risk Matrix.

  Every row here is the same customer data as the Age Matrix, just relabelled
  with a risk level (see computeRiskLevel in analytics.ts) and a recommended
  next action. The four summary cards double as filter buttons — click one to
  narrow the table below to just that risk tier, click it again to clear.
*/
export function RiskMatrix({
  rows,
  filter,
  onFilterChange,
  threshold,
  onThresholdChange,
}: {
  rows: RiskRow[];
  filter: "all" | RiskLevel;
  onFilterChange: (f: "all" | RiskLevel) => void;
  threshold: string;
  onThresholdChange: (v: string) => void;
}) {
  const summaries = RISK_ORDER.map((level) => {
    const matching = rows.filter((r) => r.risk === level);
    return {
      level,
      count: matching.length,
      outstanding: matching.reduce((s, r) => s + r.totalOutstanding, 0),
    };
  });

  const visibleRows = filter === "all" ? rows : rows.filter((r) => r.risk === filter);

  return (
    <Card
      title="Customer Risk Matrix"
      subtitle="Who needs collection attention first — click a card below to filter the table."
      className="mb-6"
      action={
        <div className="print:hidden">
          <FormField label="Critical Threshold (₹, optional)">
            <input
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => onThresholdChange(e.target.value)}
              placeholder="e.g. 500000"
              className={`${inputClass} w-40`}
            />
          </FormField>
        </div>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4 print:hidden">
        {summaries.map((s) => {
          const colors = RISK_COLORS[s.level];
          const active = filter === s.level;
          return (
            <button
              key={s.level}
              type="button"
              onClick={() => onFilterChange(active ? "all" : s.level)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                active
                  ? "border-brand ring-2 ring-brand/40"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
              } bg-white dark:bg-slate-900`}
            >
              <p className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colors.badge}`}>
                {colors.emoji} {s.level} Risk
              </p>
              <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{s.count}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {s.count === 1 ? "customer" : "customers"} · {formatINR(s.outstanding)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/60">
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outstanding</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Max Ageing</th>
              <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Count</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Risk Level</th>
              <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recommended Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                  No customers in this risk tier.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const colors = RISK_COLORS[row.risk];
                return (
                  <tr key={row.customerId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{row.name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-white">
                      {formatINR(row.totalOutstanding)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">
                      {row.maxAgeingDays > 0 ? `${row.maxAgeingDays} Days` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{row.totalInvoiceCount}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colors.badge}`}>
                        {colors.emoji} {row.risk}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{RECOMMENDED_ACTION[row.risk]}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
