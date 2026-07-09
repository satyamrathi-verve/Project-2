"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Invoice } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, inr, inrCompact } from "@/components/ui";

/*
  Screen 14 — Cashflow Projection (/reports/cashflow).
  Read-only pull of every open/partial/overdue invoice's outstanding amount
  (total minus its receipt_allocations), bucketed by the week its due_date
  falls in — everything already due before this week is folded into one
  "Overdue" row so the table doesn't fill up with stale weeks. The expected
  amount per row is editable so the team can flex the projection live; edits
  live only in this component's state and are never written back to Supabase.
*/

type InvoiceRow = Pick<Invoice, "id" | "due_date" | "total">;

interface PeriodRow {
  id: string;
  label: string;
  sub?: string;
  isOverdue: boolean;
  weekStart: string; // sort key; "" for the overdue bucket (always sorts first)
  invoiceCount: number;
  computedAmount: number;
}

// All date math here runs in UTC (getUTC*/setUTC*/toISOString) end to end so
// a browser/server sitting in a positive-UTC-offset timezone (e.g. IST)
// can't shift a date string back a day when it round-trips through Date.
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
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function CashflowProjectionPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allocByInvoice, setAllocByInvoice] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});

  // ---- load every unpaid invoice + what's already been allocated against it
  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);

      const { data: invs, error: invErr } = await supabase!
        .from("invoices")
        .select("id, due_date, total")
        .in("status", ["open", "partial", "overdue"])
        .order("due_date");
      if (invErr) {
        setError(invErr.message);
        setLoading(false);
        return;
      }
      const rows = (invs as InvoiceRow[]) ?? [];
      setInvoices(rows);

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

  // ---- bucket outstanding invoices by the week their due_date falls in
  const rows = useMemo<PeriodRow[]>(() => {
    const currentWeekStart = mondayOf(todayStr());

    const buckets = new Map<string, { weekStart: string; isOverdue: boolean; count: number; amount: number }>();

    for (const inv of invoices) {
      const outstanding = Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0);
      if (outstanding <= 0) continue;

      const dueWeekStart = mondayOf(inv.due_date);
      const isOverdue = dueWeekStart < currentWeekStart;
      const key = isOverdue ? "overdue" : dueWeekStart;

      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        existing.amount += outstanding;
      } else {
        buckets.set(key, { weekStart: isOverdue ? "" : dueWeekStart, isOverdue, count: 1, amount: outstanding });
      }
    }

    const result: PeriodRow[] = Array.from(buckets.entries()).map(([key, b]) => ({
      id: key,
      label: b.isOverdue ? "Overdue" : `${formatShort(b.weekStart)} – ${formatShort(addDays(b.weekStart, 6))}`,
      sub: b.isOverdue ? "Already past due date" : b.weekStart === currentWeekStart ? "This week" : undefined,
      isOverdue: b.isOverdue,
      weekStart: b.weekStart,
      invoiceCount: b.count,
      computedAmount: b.amount,
    }));

    result.sort((a, b) => {
      if (a.isOverdue) return -1;
      if (b.isOverdue) return 1;
      return a.weekStart < b.weekStart ? -1 : 1;
    });

    return result;
  }, [invoices, allocByInvoice]);

  function expectedFor(row: PeriodRow) {
    return adjustments[row.id] ?? row.computedAmount;
  }

  function setAmount(id: string, value: number) {
    setAdjustments((prev) => ({ ...prev, [id]: Math.max(0, value) }));
  }

  function resetAmount(id: string) {
    setAdjustments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const totalProjected = rows.reduce((s, r) => s + expectedFor(r), 0);
  const totalInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);
  const maxAmount = Math.max(1, ...rows.map((r) => expectedFor(r)));

  const columns: Column<PeriodRow>[] = [
    {
      key: "label",
      header: "Period",
      render: (r) => (
        <div>
          <span
            className={
              r.isOverdue
                ? "font-semibold text-red-600 dark:text-red-400"
                : "font-medium text-slate-800 dark:text-slate-100"
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
      header: "Invoices",
      className: "text-right tabular-nums",
      render: (r) => r.invoiceCount,
    },
    {
      key: "amount",
      header: "Expected Inflow",
      className: "text-right",
      render: (r) => {
        const adjusted = adjustments[r.id] !== undefined;
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800">
              <span className="text-xs text-slate-400 dark:text-slate-500">₹</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={expectedFor(r)}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  setAmount(r.id, Number.isFinite(parsed) ? parsed : 0);
                }}
                className="w-28 border-0 bg-transparent p-0 text-right text-sm tabular-nums text-slate-800 outline-none dark:text-slate-100 dark:[color-scheme:dark]"
              />
            </div>
            {adjusted && (
              <button onClick={() => resetAmount(r.id)} className="text-[11px] font-medium text-brand hover:underline">
                adjusted · reset
              </button>
            )}
          </div>
        );
      },
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
        subtitle="Expected collections from open invoices, grouped by the week they're due. Adjust any row to flex the projection — changes stay on this screen only."
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading open invoices…
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} empty="No open, partial or overdue invoices to project." />

          {rows.length > 0 && (
            <>
              <div className="mt-6 flex items-center justify-between rounded-2xl border border-brand/30 bg-brand/5 px-6 py-5 dark:border-brand/40 dark:bg-brand/10">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">Total Projected Inflow</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Across {totalInvoices} invoice{totalInvoices === 1 ? "" : "s"} and {rows.length} period
                    {rows.length === 1 ? "" : "s"}.
                  </p>
                </div>
                <p className="text-3xl font-bold tabular-nums text-brand">{inr(totalProjected)}</p>
              </div>

              <Card
                className="mt-6"
                title="Projected Inflow by Period"
                subtitle="Bar height reflects the (adjusted) expected amount for each period."
              >
                <div className="overflow-x-auto overflow-y-visible">
                  <div className="flex min-w-full items-end gap-4 px-2 pb-1" style={{ height: 260 }}>
                    {rows.map((r) => {
                      const amount = expectedFor(r);
                      const heightPx = Math.max(6, (amount / maxAmount) * 170);
                      return (
                        <div key={r.id} className="flex min-w-[72px] flex-1 flex-col items-center justify-end gap-2">
                          <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
                            {inrCompact(amount)}
                          </span>
                          <div
                            title={`${r.label}: ${inr(amount)}`}
                            className={`w-full rounded-t-md transition-all ${
                              r.isOverdue ? "bg-red-400 dark:bg-red-500/70" : "bg-brand"
                            }`}
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
            </>
          )}
        </>
      )}
    </div>
  );
}
