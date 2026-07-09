"use client";

import { Card, Skeleton } from "@/components/ui";
import type { Customer } from "@/lib/types";
import { HEALTH_STATUS_COLORS, type CustomerHealth } from "./customerHealth";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatDate(iso: string | null): string {
  if (!iso) return "Not Available";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/*
  Customer Health Card — a 360° snapshot of one customer's receivable
  position, shown above the table when "View Health" is clicked on a row.
  Purely a read-out of the numbers computed in customerHealth.ts; this file
  has no calculation logic of its own.
*/
export function CustomerHealthCard({
  customer,
  health,
  loading,
  error,
  onClose,
}: {
  customer: Customer;
  health: CustomerHealth | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Card className="mb-6" bodyClassName="p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Customer Health
          </p>
          <h3 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{customer.name}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Code: {customer.code}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close health card"
          className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Couldn&apos;t load this customer&apos;s health: {error}
        </div>
      ) : loading || !health ? (
        <div className="flex flex-wrap gap-6">
          <Skeleton className="h-24 w-24 flex-none rounded-full" />
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex flex-none items-center gap-4">
            <ScoreRing score={health.score} status={health.status} />
            <div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${HEALTH_STATUS_COLORS[health.status].badge}`}
              >
                {health.status}
              </span>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Health Score</p>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Tile label="Total Outstanding" value={currency.format(health.totalOutstanding)} />
            <Tile
              label="Overdue Amount"
              value={currency.format(health.overdueAmount)}
              emphasis={health.overdueAmount > 0}
            />
            <Tile label="Open Invoices" value={String(health.openInvoiceCount)} />
            <Tile
              label="Max Ageing Days"
              value={health.maxAgeingDays > 0 ? `${health.maxAgeingDays} Days` : "Not Due"}
              emphasis={health.maxAgeingDays > 90}
            />
            <Tile label="Oldest Due Date" value={formatDate(health.oldestDueDate)} />
            <Tile label="Credit Limit" value={health.creditLimit > 0 ? currency.format(health.creditLimit) : "Not Available"} />
            <Tile
              label="Credit Limit Used"
              value={health.creditLimitUsedPct !== null ? `${health.creditLimitUsedPct}%` : "Not Available"}
              emphasis={health.creditLimitUsedPct !== null && health.creditLimitUsedPct > 100}
            />
            <Tile label="Last Receipt Date" value={formatDate(health.lastReceiptDate)} />
            <Tile
              label="Avg. Collection Days"
              value={health.averageCollectionDays !== null ? `${health.averageCollectionDays} Days` : "Not Available"}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-bold ${emphasis ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function ScoreRing({ score, status }: { score: number; status: CustomerHealth["status"] }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return (
    <div className="relative h-24 w-24 flex-none">
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={radius} fill="none" strokeWidth="8" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-500 ${HEALTH_STATUS_COLORS[status].ring}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-900 dark:text-white">{score}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">/ 100</span>
      </div>
    </div>
  );
}
