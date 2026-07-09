"use client";

/*
  Sales Invoice List
  ------------------
  Read-only overview of every sales invoice: what was billed, what's been
  received against it (from receipt_allocations), and what's still owed.

  How the numbers are worked out (all computed here, nothing extra stored
  in the database):
    Paid / Receipt Amount  = sum of receipt_allocations.amount for that invoice
    Outstanding Balance    = invoice total - Paid Amount
    Status                 = Paid        -> outstanding is ~zero
                             Overdue     -> due date has passed and balance remains
                             Partly Paid -> some money received, balance remains
                             Unpaid      -> nothing received yet, not yet due
    Ageing Days            = days past the due date (only shown once overdue)

  This only reads the existing `invoices`, `customers` and `receipt_allocations`
  tables through the shared client in lib/supabase.ts — no schema changes.
*/

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { inputClass } from "@/components/FormField";
import { KpiCard, KpiSkeleton, TableSkeleton, inr, inrCompact } from "@/components/ui";
import type { Invoice } from "@/lib/types";

// A tiny tolerance for comparing money amounts, so 0.00000001 doesn't count as "still owed".
const EPS = 0.005;

type InvoiceRow = Invoice & {
  customers: { name: string } | null;
  receipt_allocations: { amount: number }[];
};

// The four payment situations a finance user cares about — computed fresh
// every time from amounts and dates, not read from a stored status field.
type PaymentStatus = "Paid" | "Overdue" | "Partly Paid" | "Unpaid";

const STATUS_TABS: { key: "all" | PaymentStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Unpaid", label: "Unpaid" },
  { key: "Partly Paid", label: "Partly Paid" },
  { key: "Paid", label: "Paid" },
  { key: "Overdue", label: "Overdue" },
];

const STATUS_STYLES: Record<PaymentStatus, string> = {
  Paid: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  "Partly Paid": "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  Unpaid: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/50",
  Overdue: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
};

function StatusPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Whole calendar days between two dates, ignoring time of day.
function daysBetween(from: Date, to: Date) {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Works out everything derived from one invoice row: how much has been
// received, what's left owed, how many days overdue, and the status label.
function computeInvoiceFacts(inv: InvoiceRow) {
  const paidAmount = (inv.receipt_allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0);
  const outstanding = Math.round((Number(inv.total) - paidAmount) * 100) / 100;
  const isPaid = outstanding <= EPS;
  const today = new Date();
  const dueDate = new Date(inv.due_date);
  const ageingDays = daysBetween(dueDate, today); // positive once overdue
  const isOverdue = !isPaid && ageingDays > 0;

  let status: PaymentStatus;
  if (isPaid) status = "Paid";
  else if (isOverdue) status = "Overdue";
  else if (paidAmount > EPS) status = "Partly Paid";
  else status = "Unpaid";

  return { paidAmount, outstanding: Math.max(outstanding, 0), ageingDays: isOverdue ? ageingDays : 0, status };
}

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedOk, setLoadedOk] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("invoices")
      .select("*, customers(name), receipt_allocations(amount)")
      .order("invoice_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setInvoices((data ?? []) as InvoiceRow[]);
          setLoadedOk(true);
        }
        setLoading(false);
      });
  }, []);

  // Success message fades out on its own, same as the confirmation banner on Customer Master.
  useEffect(() => {
    if (!loadedOk) return;
    const t = setTimeout(() => setLoadedOk(false), 3000);
    return () => clearTimeout(t);
  }, [loadedOk]);

  // Facts (paid/outstanding/status/ageing) computed once per invoice, reused by the cards and the table.
  const withFacts = useMemo(
    () => invoices.map((inv) => ({ inv, facts: computeInvoiceFacts(inv) })),
    [invoices]
  );

  // ---- summary cards (always over the full list, not the filtered view) ----
  const summary = useMemo(() => {
    const today = new Date();
    const weekAhead = new Date();
    weekAhead.setDate(today.getDate() + 7);

    let totalAmount = 0;
    let totalOutstanding = 0;
    let overdueAmount = 0;
    let dueThisWeekAmount = 0;
    let dueThisWeekCount = 0;

    for (const { inv, facts } of withFacts) {
      totalAmount += Number(inv.total);
      if (facts.status === "Paid") continue;
      totalOutstanding += facts.outstanding;
      if (facts.status === "Overdue") {
        overdueAmount += facts.outstanding;
      } else {
        const due = new Date(inv.due_date);
        if (due >= today && due <= weekAhead) {
          dueThisWeekAmount += facts.outstanding;
          dueThisWeekCount += 1;
        }
      }
    }

    return { totalAmount, totalOutstanding, overdueAmount, dueThisWeekAmount, dueThisWeekCount };
  }, [withFacts]);

  // ---- search + status filter ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withFacts.filter(({ inv, facts }) => {
      const matchesSearch =
        !q ||
        inv.invoice_no.toLowerCase().includes(q) ||
        (inv.customers?.name ?? "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || facts.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [withFacts, search, statusFilter]);

  const columns: Column<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice No.",
      render: (row) => <span className="font-medium text-brand">{row.invoice_no}</span>,
    },
    { key: "invoice_date", header: "Invoice Date", render: (row) => formatDate(row.invoice_date) },
    {
      key: "customer",
      header: "Customer Name",
      render: (row) => <span className="dark:text-slate-300">{row.customers?.name ?? "—"}</span>,
    },
    { key: "due_date", header: "Due Date", render: (row) => formatDate(row.due_date) },
    { key: "total", header: "Invoice Amount", className: "text-right", render: (row) => inr(Number(row.total)) },
    {
      key: "paid",
      header: "Receipt / Paid",
      className: "text-right",
      render: (row) => inr(computeInvoiceFacts(row).paidAmount),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right",
      render: (row) => {
        const { outstanding, status } = computeInvoiceFacts(row);
        return (
          <span className={status === "Paid" ? "text-emerald-600 dark:text-emerald-400" : "font-semibold text-slate-900 dark:text-white"}>
            {inr(outstanding)}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusPill status={computeInvoiceFacts(row).status} />,
    },
    {
      key: "ageing",
      header: "Ageing Days",
      className: "text-right",
      render: (row) => {
        const { ageingDays } = computeInvoiceFacts(row);
        return ageingDays > 0 ? (
          <span className="text-red-600 dark:text-red-400">{ageingDays}</span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        );
      },
    },
    {
      key: "actions",
      header: "Action",
      render: (row) => (
        <div className="flex items-center gap-3 text-xs font-medium">
          <Link href={`/invoices/${row.id}`} className="text-brand hover:underline">
            View
          </Link>
          <Link href={`/invoices/${row.id}/edit`} className="text-slate-600 hover:underline dark:text-slate-300">
            Edit
          </Link>
          <Link href={`/invoices/${row.id}/print`} className="text-slate-600 hover:underline dark:text-slate-300">
            Print
          </Link>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Invoice List"
        subtitle="Track customer invoices, due dates, payments, and outstanding balances"
        action={
          <Link
            href="/invoices/new"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Add Invoice
          </Link>
        }
      />

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      {isConfigured && (
        <>
          {/* Success message: confirms the data loaded, fades out on its own */}
          {loadedOk && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              Invoices loaded successfully.
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              Couldn&apos;t load invoices: {error}
            </div>
          )}

          {/* Summary cards */}
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
                <KpiCard label="Total Invoices" value={invoices.length} sub="all time" accent="brand" />
                <KpiCard
                  label="Total Invoice Amount"
                  value={inrCompact(summary.totalAmount)}
                  sub={inr(summary.totalAmount)}
                  accent="violet"
                />
                <KpiCard
                  label="Total Outstanding"
                  value={inrCompact(summary.totalOutstanding)}
                  sub={inr(summary.totalOutstanding)}
                  accent="amber"
                />
                <KpiCard
                  label="Overdue Amount"
                  value={inrCompact(summary.overdueAmount)}
                  sub={inr(summary.overdueAmount)}
                  accent="red"
                />
                <KpiCard
                  label="Due This Week"
                  value={inrCompact(summary.dueThisWeekAmount)}
                  sub={`${summary.dueThisWeekCount} invoice${summary.dueThisWeekCount === 1 ? "" : "s"}`}
                  accent="emerald"
                />
              </>
            )}
          </div>

          {/* Search + status filter (the Overdue tab doubles as the "overdue only" filter) */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setStatusFilter(t.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === t.key
                      ? "bg-brand text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search by invoice no. or customer name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} w-72`}
            />
          </div>

          {loading ? (
            <TableSkeleton rows={8} cols={9} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={filtered.map(({ inv }) => inv)}
                empty="No invoices match your search/filter."
              />
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                Showing {filtered.length} of {invoices.length} invoices
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
