"use client";

/*
  Screen 14 — Cashflow Projection (/reports/cashflow).
  Read-only. Every number on this page comes straight from existing data:

    Outstanding Amount   = Invoice Total − amount already received
                           (sum of that invoice's receipt_allocations)
    Expected Collection  = sum of Outstanding Amount for invoices due in a
                           given calendar week (their Due Date).

  Nothing here predicts customer behaviour, estimates future payment
  patterns, or runs any forecasting algorithm — every figure is just what's
  actually owed today, bucketed by the week it's due.

  "As On Date" is the reference point for the whole page: it decides what
  counts as this week / this month / overdue, both for the KPI cards and for
  the weekly buckets. The Customer and Collection Status filters only narrow
  down which invoices feed the table and charts below — the KPI cards always
  reflect the full book, so they're a stable headline number regardless of
  how you're currently filtering the detail view.

  Four visuals, all hand-rolled SVG/CSS (no chart library), all derived from
  the same weekly/invoice-level numbers already computed for the table:
    - Weekly bar chart        — Expected Collection per week (bar height).
    - Cumulative line chart   — running total of Expected Collection.
    - Ageing donut            — outstanding split into Current/1-30/31-60/
                                61-90/90+ day buckets (day-precision, same
                                math as the Overdue KPI card).
    - Top 10 customers        — ranked horizontal bars by outstanding.
*/

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, KpiCard, KpiSkeleton, Donut, HBarList, TrendLineChart, inr, inrCompact, type DonutSlice } from "@/components/ui";

type InvoiceRow = {
  id: string;
  invoice_no: string;
  due_date: string;
  total: number;
  customer_id: string;
};

interface WeekRow {
  id: string;
  label: string;
  sub?: string;
  isOverdue: boolean;
  weekStart: string; // sort key; "" for the overdue bucket (always sorts first)
  invoiceCount: number;
  expectedCollection: number;
}

// All date math runs in UTC (getUTC*/setUTC*/toISOString) end to end so a
// browser sitting in a positive-UTC-offset timezone (e.g. IST) can't shift a
// date string back a day when it round-trips through Date.
function todayStr() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}
function addDays(d: string, n: number) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// Monday of the week containing d, as an ISO date string.
function mondayOf(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  const day = dt.getUTCDay(); // 0 = Sun … 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}
function formatShort(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
// Whole days from `dueDate` to `asOnDate` — positive once an invoice is overdue.
function ageingDays(dueDate: string, asOnDate: string) {
  return Math.round((Date.parse(`${asOnDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
}

// Ageing buckets for the donut chart — Current (not yet due), then 30-day
// bands of how many days past the due date the invoice is.
type BucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
const BUCKET_ORDER: BucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
const BUCKET_LABELS: Record<BucketKey, string> = {
  current: "Current",
  d1_30: "1–30 Days",
  d31_60: "31–60 Days",
  d61_90: "61–90 Days",
  d90_plus: "90+ Days",
};
// Literal Tailwind classes (not built from a variable) so the JIT scanner picks them up.
const BUCKET_CLASSNAMES: Record<BucketKey, string> = {
  current: "text-slate-400",
  d1_30: "text-amber-400",
  d31_60: "text-orange-500",
  d61_90: "text-red-500",
  d90_plus: "text-red-700",
};
function bucketFor(days: number): BucketKey {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export default function CashflowProjectionPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allocByInvoice, setAllocByInvoice] = useState<Record<string, number>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters (all client-side; the underlying invoice data is fetched once)
  const [asOnDate, setAsOnDate] = useState(todayStr());
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "current" | "overdue">("all");

  // ---- load every unpaid invoice + what's already been received against it
  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);

      const [{ data: invs, error: invErr }, { data: custs, error: custErr }] = await Promise.all([
        supabase!
          .from("invoices")
          .select("id, invoice_no, due_date, total, customer_id")
          .in("status", ["open", "partial", "overdue"])
          .order("due_date"),
        supabase!.from("customers").select("*").order("name"),
      ]);
      if (invErr || custErr) {
        setError((invErr ?? custErr)!.message);
        setLoading(false);
        return;
      }
      const rows = (invs as InvoiceRow[]) ?? [];
      setInvoices(rows);
      setCustomers((custs as Customer[]) ?? []);

      const ids = rows.map((i) => i.id);
      if (ids.length > 0) {
        const { data: allocs, error: allocErr } = await supabase!
          .from("receipt_allocations")
          .select("invoice_id, amount")
          .in("invoice_id", ids);
        if (allocErr) {
          setError(allocErr.message);
        } else {
          const map: Record<string, number> = {};
          for (const a of (allocs as { invoice_id: string; amount: number }[]) ?? []) {
            map[a.invoice_id] = (map[a.invoice_id] ?? 0) + Number(a.amount);
          }
          setAllocByInvoice(map);
        }
      } else {
        setAllocByInvoice({});
      }
      setLoading(false);
    })();
  }, []);

  // ---- every unpaid invoice with its outstanding balance worked out once,
  // shared by the KPI cards and the weekly table below.
  const withOutstanding = useMemo(
    () =>
      invoices
        .map((inv) => ({
          inv,
          outstanding: Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0),
        }))
        .filter((r) => r.outstanding > 0), // only invoices with money still owed
    [invoices, allocByInvoice]
  );

  // ---- KPI cards: always the full book, independent of the filters below,
  // so they read as a stable headline regardless of what you're drilling into.
  const kpis = useMemo(() => {
    const weekStart = mondayOf(asOnDate);
    const weekEnd = addDays(weekStart, 6);
    const monthPrefix = asOnDate.slice(0, 7); // "YYYY-MM"

    let totalOutstanding = 0;
    let thisWeek = 0;
    let thisMonth = 0;
    let overdue = 0;

    for (const { inv, outstanding } of withOutstanding) {
      totalOutstanding += outstanding;
      if (inv.due_date < asOnDate) overdue += outstanding;
      if (inv.due_date >= weekStart && inv.due_date <= weekEnd) thisWeek += outstanding;
      if (inv.due_date.slice(0, 7) === monthPrefix) thisMonth += outstanding;
    }

    return { totalOutstanding, thisWeek, thisMonth, overdue, openCount: withOutstanding.length };
  }, [withOutstanding, asOnDate]);

  // ---- apply Customer + Collection Status filters (client-side) before
  // building the weekly table and chart
  const filtered = useMemo(() => {
    return withOutstanding.filter(({ inv }) => {
      if (customerFilter !== "all" && inv.customer_id !== customerFilter) return false;
      if (statusFilter === "current" && inv.due_date < asOnDate) return false;
      if (statusFilter === "overdue" && inv.due_date >= asOnDate) return false;
      return true;
    });
  }, [withOutstanding, customerFilter, statusFilter, asOnDate]);

  // ---- bucket the filtered invoices by the calendar week their due date
  // falls in; everything already overdue (relative to "As On Date") is
  // folded into one "Overdue" row so the table doesn't fill up with stale
  // weeks. This mirrors the "Total Overdue Amount" KPI exactly (both use
  // day-precision on due_date < asOnDate), so the Overdue row here always
  // reconciles with that card.
  const weekRows = useMemo<WeekRow[]>(() => {
    const currentWeekStart = mondayOf(asOnDate);
    const buckets = new Map<string, { weekStart: string; isOverdue: boolean; count: number; amount: number }>();

    for (const { inv, outstanding } of filtered) {
      const dueWeekStart = mondayOf(inv.due_date);
      const isOverdue = inv.due_date < asOnDate;
      const key = isOverdue ? "overdue" : dueWeekStart;

      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        existing.amount += outstanding;
      } else {
        buckets.set(key, { weekStart: isOverdue ? "" : dueWeekStart, isOverdue, count: 1, amount: outstanding });
      }
    }

    const result: WeekRow[] = Array.from(buckets.entries()).map(([key, b]) => ({
      id: key,
      label: b.isOverdue ? "Overdue" : `${formatShort(b.weekStart)} – ${formatShort(addDays(b.weekStart, 6))}`,
      sub: b.isOverdue ? "Already past due date" : b.weekStart === currentWeekStart ? "This week" : undefined,
      isOverdue: b.isOverdue,
      weekStart: b.weekStart,
      invoiceCount: b.count,
      expectedCollection: b.amount,
    }));

    // Sort chronologically — the collapsed Overdue bucket always sorts first
    // since every week inside it is, by definition, earlier than the rest.
    result.sort((a, b) => {
      if (a.isOverdue) return -1;
      if (b.isOverdue) return 1;
      return a.weekStart < b.weekStart ? -1 : 1;
    });
    return result;
  }, [filtered, asOnDate]);

  // ---- customer names for the Top 10 chart, looked up from the customer
  // list already fetched above — no extra query needed.
  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  // ---- running total of Expected Collection across the weekly rows above,
  // in the same chronological order (Overdue first, then week by week).
  const cumulativePoints = useMemo(() => {
    let running = 0;
    return weekRows.map((r) => {
      running += r.expectedCollection;
      return { label: r.label, value: running };
    });
  }, [weekRows]);

  // ---- outstanding receivables grouped into ageing buckets for the donut —
  // same day-precision ageing math as the KPI cards, just bucketed further.
  const ageingSlices = useMemo<DonutSlice[]>(() => {
    const totals: Record<BucketKey, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const { inv, outstanding } of filtered) {
      const bucket = bucketFor(ageingDays(inv.due_date, asOnDate));
      totals[bucket] += outstanding;
    }
    return BUCKET_ORDER.map((key) => ({
      key,
      label: BUCKET_LABELS[key],
      value: totals[key],
      className: BUCKET_CLASSNAMES[key],
    }));
  }, [filtered, asOnDate]);

  // ---- top 10 customers by outstanding balance, from the filtered invoice set.
  const topCustomers = useMemo(() => {
    const totals = new Map<string, number>();
    for (const { inv, outstanding } of filtered) {
      totals.set(inv.customer_id, (totals.get(inv.customer_id) ?? 0) + outstanding);
    }
    return Array.from(totals.entries())
      .map(([customerId, value]) => ({ key: customerId, label: customerNameById.get(customerId) ?? "Unknown customer", value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filtered, customerNameById]);

  const maxExpected = Math.max(1, ...weekRows.map((r) => r.expectedCollection));

  function handleExportCsv() {
    const header = ["Week", "Number of Invoices", "Expected Collection"];
    const rows = weekRows.map((r) => [r.label, r.invoiceCount, r.expectedCollection.toFixed(2)].join(","));
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cashflow-projection-${asOnDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<WeekRow>[] = [
    {
      key: "label",
      header: "Week",
      render: (r) => (
        <div>
          <span
            className={
              r.isOverdue ? "font-semibold text-red-600 dark:text-red-400" : "font-medium text-slate-800 dark:text-slate-100"
            }
          >
            {r.label}
          </span>
          {r.sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{r.sub}</p>}
        </div>
      ),
    },
    {
      key: "invoiceCount",
      header: "Number of Invoices",
      className: "text-right tabular-nums",
      render: (r) => r.invoiceCount,
    },
    {
      key: "expectedCollection",
      header: "Expected Collection",
      className: "text-right font-semibold tabular-nums text-slate-900 dark:text-white",
      render: (r) => inr(r.expectedCollection),
    },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div>
        <PageHeader
          title="Cashflow Projection"
          subtitle="Expected collections from open invoices, grouped by the week they're due."
        />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Cashflow Projection"
        subtitle="Expected collections from open invoices, grouped by the week they're due."
        action={
          <div className="flex gap-2 print:hidden">
            <button
              onClick={handleExportCsv}
              disabled={weekRows.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Print
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {/* KPI cards — always the full book, not affected by the filters below */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard label="Total Outstanding Receivables" value={inrCompact(kpis.totalOutstanding)} sub={inr(kpis.totalOutstanding)} accent="brand" />
            <KpiCard label="Expected Collection This Week" value={inrCompact(kpis.thisWeek)} sub={inr(kpis.thisWeek)} accent="emerald" />
            <KpiCard label="Expected Collection This Month" value={inrCompact(kpis.thisMonth)} sub={inr(kpis.thisMonth)} accent="violet" />
            <KpiCard label="Total Overdue Amount" value={inrCompact(kpis.overdue)} sub={inr(kpis.overdue)} accent="red" />
            <KpiCard label="Number of Open Invoices" value={kpis.openCount} sub="not fully paid" accent="amber" />
          </>
        )}
      </div>

      {/* Filters — narrow down the table and chart only */}
      <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 print:hidden dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
        <FormField label="As On Date">
          <input type="date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="Customer">
          <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className={inputClass}>
            <option value="all">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Collection Status">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className={inputClass}
          >
            <option value="all">All</option>
            <option value="current">Current</option>
            <option value="overdue">Overdue</option>
          </select>
        </FormField>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading open invoices…
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={weekRows} empty="No open, partial or overdue invoices match your filters." />

          {weekRows.length > 0 && (
            <>
              <Card className="mt-6" title="Weekly Expected Collections" subtitle="Expected Collection by week.">
                <div className="overflow-x-auto overflow-y-visible">
                  <div className="flex min-w-full items-end gap-4 px-2 pb-1" style={{ height: 260 }}>
                    {weekRows.map((r) => {
                      const heightPx = Math.max(6, (r.expectedCollection / maxExpected) * 170);
                      return (
                        <div key={r.id} className="flex min-w-[72px] flex-1 flex-col items-center justify-end gap-2">
                          <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
                            {inrCompact(r.expectedCollection)}
                          </span>
                          <div
                            title={`${r.label}: ${inr(r.expectedCollection)}`}
                            className={`w-full rounded-t-md transition-all ${r.isOverdue ? "bg-red-400 dark:bg-red-500/70" : "bg-brand"}`}
                            style={{ height: heightPx }}
                          />
                          <span className="max-w-[80px] text-center text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                            {r.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              <Card
                className="mt-6"
                title="Cumulative Expected Collections"
                subtitle="Running total of Expected Collection, week over week."
              >
                <TrendLineChart points={cumulativePoints} />
              </Card>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card
                  title="Outstanding Receivables by Ageing Bucket"
                  subtitle="Share of total outstanding in each ageing bucket, as on the selected date."
                >
                  <Donut
                    slices={ageingSlices}
                    centerValue={inrCompact(ageingSlices.reduce((s, x) => s + x.value, 0))}
                    centerLabel="Outstanding"
                  />
                </Card>

                <Card title="Top 10 Customers by Outstanding" subtitle="Highest outstanding balances, for the invoices currently in view.">
                  {topCustomers.length > 0 ? (
                    <HBarList rows={topCustomers} />
                  ) : (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No customers to show.</p>
                  )}
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
