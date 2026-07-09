"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Invoice } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, KpiCard, KpiSkeleton, TableSkeleton, StatusBadge, inr, inrCompact } from "@/components/ui";

/*
  Screen 15 — Dashboard (/dashboard).
  Read-only, at-a-glance overview: five KPI tiles plus the most recent
  invoices. Outstanding/overdue are computed the same way as everywhere
  else in the app (total minus receipt_allocations; overdue = past due_date
  and still owed) rather than trusted from the stored status column, so the
  numbers always agree with Cashflow Projection and AR Ageing.
*/

type DashInvoiceRow = Invoice & {
  customers: { name: string } | null;
  receipt_allocations: { amount: number }[];
};

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function thisMonthPrefix() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DashboardPage() {
  const [invoices, setInvoices] = useState<DashInvoiceRow[]>([]);
  const [receipts, setReceipts] = useState<{ amount: number; receipt_date: string }[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);

      const [invRes, recRes, custRes] = await Promise.all([
        supabase!
          .from("invoices")
          .select("*, customers(name), receipt_allocations(amount)")
          .order("invoice_date", { ascending: false }),
        supabase!.from("receipts").select("amount, receipt_date"),
        supabase!.from("customers").select("*", { count: "exact", head: true }),
      ]);
      const firstError = invRes.error ?? recRes.error ?? custRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      setInvoices((invRes.data as DashInvoiceRow[]) ?? []);
      setReceipts((recRes.data as { amount: number; receipt_date: string }[]) ?? []);
      setCustomerCount(custRes.count ?? 0);
      setLoading(false);
    })();
  }, []);

  const kpis = useMemo(() => {
    const today = todayStr();
    const monthPrefix = thisMonthPrefix();

    let totalOutstanding = 0;
    let overdueAmount = 0;
    let openInvoices = 0;
    for (const inv of invoices) {
      const allocated = (inv.receipt_allocations ?? []).reduce((s, a) => s + Number(a.amount), 0);
      const outstanding = Math.max(Number(inv.total) - allocated, 0);
      if (outstanding <= 0) continue;
      totalOutstanding += outstanding;
      openInvoices += 1;
      if (inv.due_date < today) overdueAmount += outstanding;
    }

    const collectedThisMonth = receipts
      .filter((r) => r.receipt_date.startsWith(monthPrefix))
      .reduce((s, r) => s + Number(r.amount), 0);

    return { totalOutstanding, overdueAmount, openInvoices, collectedThisMonth };
  }, [invoices, receipts]);

  const recentInvoices = invoices.slice(0, 8);

  const columns: Column<DashInvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice No.",
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="font-medium text-brand hover:underline">
          {r.invoice_no}
        </Link>
      ),
    },
    { key: "customer", header: "Customer", render: (r) => r.customers?.name ?? "—" },
    { key: "invoice_date", header: "Invoice Date", render: (r) => formatDate(r.invoice_date) },
    { key: "due_date", header: "Due Date", render: (r) => formatDate(r.due_date) },
    { key: "total", header: "Amount", className: "text-right tabular-nums", render: (r) => inr(Number(r.total)) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Your AR position at a glance." />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your AR position at a glance." />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

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
            <KpiCard
              label="Total Outstanding"
              value={inrCompact(kpis.totalOutstanding)}
              sub={inr(kpis.totalOutstanding)}
              accent="brand"
            />
            <KpiCard
              label="Overdue Amount"
              value={inrCompact(kpis.overdueAmount)}
              sub={inr(kpis.overdueAmount)}
              accent="red"
            />
            <KpiCard
              label="Collected This Month"
              value={inrCompact(kpis.collectedThisMonth)}
              sub={inr(kpis.collectedThisMonth)}
              accent="emerald"
            />
            <KpiCard label="Open Invoices" value={kpis.openInvoices} sub="not yet fully paid" accent="amber" />
            <KpiCard label="Total Customers" value={customerCount} sub="on the books" accent="violet" />
          </>
        )}
      </div>

      <Card
        title="Recent Invoices"
        subtitle="The 8 most recently raised invoices."
        action={
          <Link href="/invoices" className="text-sm font-medium text-brand hover:underline">
            View all invoices
          </Link>
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="p-6">
            <TableSkeleton rows={6} cols={6} />
          </div>
        ) : (
          <div className="p-4">
            <DataTable columns={columns} rows={recentInvoices} empty="No invoices yet." />
          </div>
        )}
      </Card>
    </div>
  );
}
