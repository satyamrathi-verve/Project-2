"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { DataTable, type Column } from "@/components/DataTable";
import type { Customer, Invoice, ReceiptAllocation } from "@/lib/types";

/*
  Report – AR Ageing (read-only).

  Everything here is calculated on screen from data we already have — this
  page never writes anything back to Supabase.

  Ageing, in plain terms:
  - "Outstanding" on an invoice = its total minus whatever's been received
    against it so far (the sum of its rows in receipt_allocations).
  - "Ageing days" = how many days past its due date the invoice is, as of the
    "As On Date" you pick above. 0 or fewer days means it isn't due yet.
  - Every invoice's outstanding amount falls into one bucket based on that
    ageing: Not Due, 1–30, 31–60, 61–90, or Above 90 days.
  - The customer-wise table is just those invoice buckets added up per customer.
*/

type BucketKey = "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

const BUCKET_LABELS: Record<BucketKey, string> = {
  not_due: "Not Due",
  d1_30: "1–30 Days",
  d31_60: "31–60 Days",
  d61_90: "61–90 Days",
  d90_plus: "Above 90 Days",
};

const EMPTY_BUCKETS: Record<BucketKey, number> = {
  not_due: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// How many whole days "as on date" is past the invoice's due date.
// 0 (or negative) means the invoice isn't due yet.
function ageingDaysFor(asOnDate: string, dueDate: string): number {
  const ms = Date.parse(asOnDate) - Date.parse(dueDate);
  return Math.round(ms / 86400000);
}

function bucketFor(ageingDays: number): BucketKey {
  if (ageingDays <= 0) return "not_due";
  if (ageingDays <= 30) return "d1_30";
  if (ageingDays <= 60) return "d31_60";
  if (ageingDays <= 90) return "d61_90";
  return "d90_plus";
}

function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

interface InvoiceRow {
  id: string;
  customerId: string;
  customerName: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  amountReceived: number;
  outstanding: number;
  ageingDays: number;
  bucket: BucketKey;
  status: "Paid" | "Current" | "Overdue";
}

interface CustomerAgeingRow {
  id: string;
  code: string;
  name: string;
  creditDays: number;
  creditLimit: number;
  buckets: Record<BucketKey, number>;
  totalOutstanding: number;
  oldestDueDate: string | null;
  maxAgeingDays: number;
  priority: "High" | "Medium" | "Low";
  isTotals?: boolean;
}

/** A single bucket amount cell — blank when zero, red/bold when it's a big-ageing bucket with money in it. */
function BucketCell({ amount, severe }: { amount: number; severe?: boolean }) {
  if (amount === 0) return <span className="text-slate-300">—</span>;
  return <span className={severe ? "font-semibold text-red-600" : ""}>{formatINR(amount)}</span>;
}

function PriorityBadge({ priority }: { priority: CustomerAgeingRow["priority"] }) {
  const styles: Record<string, string> = {
    High: "bg-red-100 text-red-700",
    Medium: "bg-amber-100 text-amber-700",
    Low: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[priority]}`}>{priority}</span>
  );
}

function StatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const styles: Record<string, string> = {
    Paid: "bg-emerald-100 text-emerald-700",
    Current: "bg-slate-100 text-slate-600",
    Overdue: "bg-red-100 text-red-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}

export default function ARAgeingPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [asOnDate, setAsOnDate] = useState(todayIso());
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "current" | "overdue">("all");
  const [bucketFilter, setBucketFilter] = useState<"all" | BucketKey>("all");
  const [minOutstanding, setMinOutstanding] = useState("0");
  const [includeZeroBalance, setIncludeZeroBalance] = useState(false);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      // Read-only: fetch customers, invoices, and receipt allocations, then do
      // all the ageing math in the browser. Nothing is written back.
      const [customersRes, invoicesRes, allocationsRes] = await Promise.all([
        supabase!.from("customers").select("*").order("name"),
        supabase!.from("invoices").select("*"),
        supabase!.from("receipt_allocations").select("*"),
      ]);
      if (cancelled) return;
      const firstError = customersRes.error ?? invoicesRes.error ?? allocationsRes.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      setCustomers(customersRes.data ?? []);
      setInvoices(invoicesRes.data ?? []);
      setAllocations(allocationsRes.data ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // One row per invoice, with outstanding/ageing/bucket worked out for the chosen "as on" date.
  const invoiceRows = useMemo<InvoiceRow[]>(() => {
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const receivedByInvoice = new Map<string, number>();
    for (const a of allocations) {
      receivedByInvoice.set(a.invoice_id, (receivedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
    }

    return invoices.map((inv) => {
      const received = receivedByInvoice.get(inv.id) ?? 0;
      const outstanding = Math.round((Number(inv.total) - received) * 100) / 100;
      const ageingDays = ageingDaysFor(asOnDate, inv.due_date);
      const status: InvoiceRow["status"] = outstanding <= 0 ? "Paid" : ageingDays <= 0 ? "Current" : "Overdue";
      return {
        id: inv.id,
        customerId: inv.customer_id,
        customerName: customerById.get(inv.customer_id)?.name ?? "Unknown customer",
        invoiceNo: inv.invoice_no,
        invoiceDate: inv.invoice_date,
        dueDate: inv.due_date,
        invoiceAmount: Number(inv.total),
        amountReceived: received,
        outstanding,
        ageingDays,
        bucket: bucketFor(ageingDays),
        status,
      };
    });
  }, [invoices, allocations, customers, asOnDate]);

  // Apply every filter here, once — both tables and the KPI cards read from
  // this same filtered list, so the numbers always agree with each other.
  const filteredInvoiceRows = useMemo(() => {
    const min = Number(minOutstanding) || 0;
    return invoiceRows.filter((row) => {
      if (!includeZeroBalance && row.status === "Paid") return false;
      if (customerFilter !== "all" && row.customerId !== customerFilter) return false;
      if (statusFilter === "current" && row.status !== "Current") return false;
      if (statusFilter === "overdue" && row.status !== "Overdue") return false;
      if (bucketFilter !== "all" && row.bucket !== bucketFilter) return false;
      if (row.outstanding < min) return false;
      return true;
    });
  }, [invoiceRows, customerFilter, statusFilter, bucketFilter, minOutstanding, includeZeroBalance]);

  // Roll the filtered invoices up into one row per customer.
  const customerRows = useMemo<CustomerAgeingRow[]>(() => {
    const byCustomer = new Map<string, CustomerAgeingRow>();

    for (const row of filteredInvoiceRows) {
      let entry = byCustomer.get(row.customerId);
      if (!entry) {
        const customer = customers.find((c) => c.id === row.customerId);
        entry = {
          id: row.customerId,
          code: customer?.code ?? "—",
          name: row.customerName,
          creditDays: customer?.credit_days ?? 0,
          creditLimit: customer?.credit_limit ?? 0,
          buckets: { ...EMPTY_BUCKETS },
          totalOutstanding: 0,
          oldestDueDate: null,
          maxAgeingDays: 0,
          priority: "Low",
        };
        byCustomer.set(row.customerId, entry);
      }
      // Zero-balance (paid) invoices don't add to any bucket total — they can
      // still show up as their own row in the invoice-wise table below.
      if (row.outstanding > 0) {
        entry.buckets[row.bucket] += row.outstanding;
        entry.totalOutstanding += row.outstanding;
        if (!entry.oldestDueDate || row.dueDate < entry.oldestDueDate) entry.oldestDueDate = row.dueDate;
        if (row.ageingDays > entry.maxAgeingDays) entry.maxAgeingDays = row.ageingDays;
      }
    }

    const rows = Array.from(byCustomer.values()).map((entry) => ({
      ...entry,
      // Collection priority, based purely on which buckets have money in them:
      // High = anything above 90 days, Medium = 31–90 days, Low = current or 1–30.
      priority: (entry.buckets.d90_plus > 0
        ? "High"
        : entry.buckets.d31_60 > 0 || entry.buckets.d61_90 > 0
          ? "Medium"
          : "Low") as CustomerAgeingRow["priority"],
    }));

    rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return rows;
  }, [filteredInvoiceRows, customers]);

  // A totals row summing every column across all customers, pinned to the bottom.
  const totalsRow: CustomerAgeingRow | null = useMemo(() => {
    if (customerRows.length === 0) return null;
    const totals: CustomerAgeingRow = {
      id: "totals",
      code: "",
      name: "Total",
      creditDays: 0,
      creditLimit: 0,
      buckets: { ...EMPTY_BUCKETS },
      totalOutstanding: 0,
      oldestDueDate: null,
      maxAgeingDays: 0,
      priority: "Low",
      isTotals: true,
    };
    for (const row of customerRows) {
      (Object.keys(totals.buckets) as BucketKey[]).forEach((k) => {
        totals.buckets[k] += row.buckets[k];
      });
      totals.totalOutstanding += row.totalOutstanding;
    }
    return totals;
  }, [customerRows]);

  const kpis = useMemo(() => {
    const buckets = { ...EMPTY_BUCKETS };
    for (const row of customerRows) {
      (Object.keys(buckets) as BucketKey[]).forEach((k) => {
        buckets[k] += row.buckets[k];
      });
    }
    const totalOutstanding = customerRows.reduce((sum, r) => sum + r.totalOutstanding, 0);
    const totalOverdue = buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus;
    const overdueCustomers = customerRows.filter(
      (r) => r.buckets.d1_30 + r.buckets.d31_60 + r.buckets.d61_90 + r.buckets.d90_plus > 0
    ).length;
    return { buckets, totalOutstanding, totalOverdue, overdueCustomers };
  }, [customerRows]);

  // Builds a CSV of the customer-wise summary (plus its totals row) and
  // downloads it — no extra libraries needed for this.
  function handleExportCsv() {
    const header = [
      "Customer Code",
      "Customer Name",
      "Credit Days",
      "Credit Limit",
      "Not Due",
      "1-30 Days",
      "31-60 Days",
      "61-90 Days",
      "Above 90 Days",
      "Total Outstanding",
      "Oldest Due Date",
      "Max Ageing Days",
      "Collection Priority",
    ];
    const csvRow = (r: CustomerAgeingRow) =>
      [
        r.code,
        `"${r.name.replace(/"/g, '""')}"`,
        r.isTotals ? "" : r.creditDays,
        r.isTotals ? "" : r.creditLimit.toFixed(2),
        r.buckets.not_due.toFixed(2),
        r.buckets.d1_30.toFixed(2),
        r.buckets.d31_60.toFixed(2),
        r.buckets.d61_90.toFixed(2),
        r.buckets.d90_plus.toFixed(2),
        r.totalOutstanding.toFixed(2),
        r.isTotals ? "" : (r.oldestDueDate ?? ""),
        r.isTotals ? "" : r.maxAgeingDays,
        r.isTotals ? "" : r.priority,
      ].join(",");

    const lines = [header.join(","), ...customerRows.map(csvRow)];
    if (totalsRow) lines.push(csvRow(totalsRow));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ar-ageing-${asOnDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const customerColumns: Column<CustomerAgeingRow>[] = [
    { key: "code", header: "Customer Code", render: (r) => (r.isTotals ? "" : r.code) },
    {
      key: "name",
      header: "Customer Name",
      render: (r) => {
        const worst = r.buckets.d61_90 > 0 || r.buckets.d90_plus > 0;
        return (
          <span className={r.isTotals ? "font-bold text-slate-900" : worst ? "font-semibold text-red-700" : ""}>
            {r.name}
          </span>
        );
      },
    },
    { key: "creditDays", header: "Credit Days", render: (r) => (r.isTotals ? "" : r.creditDays) },
    { key: "creditLimit", header: "Credit Limit", render: (r) => (r.isTotals ? "" : formatINR(r.creditLimit)) },
    { key: "notDue", header: "Not Due", render: (r) => <BucketCell amount={r.buckets.not_due} /> },
    { key: "d1_30", header: "1–30 Days", render: (r) => <BucketCell amount={r.buckets.d1_30} /> },
    { key: "d31_60", header: "31–60 Days", render: (r) => <BucketCell amount={r.buckets.d31_60} /> },
    { key: "d61_90", header: "61–90 Days", render: (r) => <BucketCell amount={r.buckets.d61_90} severe /> },
    { key: "d90_plus", header: "Above 90 Days", render: (r) => <BucketCell amount={r.buckets.d90_plus} severe /> },
    {
      key: "totalOutstanding",
      header: "Total Outstanding",
      render: (r) => <span className="font-semibold">{formatINR(r.totalOutstanding)}</span>,
    },
    { key: "oldestDueDate", header: "Oldest Due Date", render: (r) => (r.isTotals ? "" : formatDate(r.oldestDueDate)) },
    {
      key: "maxAgeingDays",
      header: "Max Ageing Days",
      render: (r) => (r.isTotals ? "" : r.maxAgeingDays > 0 ? r.maxAgeingDays : "—"),
    },
    {
      key: "priority",
      header: "Collection Priority",
      render: (r) => (r.isTotals ? "" : <PriorityBadge priority={r.priority} />),
    },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    { key: "customerName", header: "Customer Name" },
    { key: "invoiceNo", header: "Invoice No." },
    { key: "invoiceDate", header: "Invoice Date", render: (r) => formatDate(r.invoiceDate) },
    { key: "dueDate", header: "Due Date", render: (r) => formatDate(r.dueDate) },
    { key: "invoiceAmount", header: "Invoice Amount", render: (r) => formatINR(r.invoiceAmount) },
    { key: "amountReceived", header: "Amount Received", render: (r) => formatINR(r.amountReceived) },
    {
      key: "outstanding",
      header: "Outstanding Amount",
      render: (r) => <span className="font-semibold">{formatINR(r.outstanding)}</span>,
    },
    { key: "ageingDays", header: "Ageing Days", render: (r) => (r.ageingDays > 0 ? r.ageingDays : "—") },
    { key: "bucket", header: "Ageing Bucket", render: (r) => BUCKET_LABELS[r.bucket] },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const tableRows = totalsRow ? [...customerRows, totalsRow] : customerRows;

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Report – AR Ageing" subtitle="Customer-wise and invoice-wise outstanding, by age." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Report – AR Ageing"
        subtitle="Who owes what, and how overdue it is, as of the date you pick below."
        action={
          <div className="flex gap-2 print:hidden">
            <button
              onClick={handleExportCsv}
              disabled={customerRows.length === 0}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn&apos;t load the ageing report: {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-3 lg:grid-cols-6">
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
        <FormField label="Status">
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
        <FormField label="Ageing Bucket">
          <select
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value as typeof bucketFilter)}
            className={inputClass}
          >
            <option value="all">All buckets</option>
            {(Object.keys(BUCKET_LABELS) as BucketKey[]).map((k) => (
              <option key={k} value={k}>
                {BUCKET_LABELS[k]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Minimum Outstanding">
          <input
            type="number"
            min="0"
            value={minOutstanding}
            onChange={(e) => setMinOutstanding(e.target.value)}
            className={inputClass}
          />
        </FormField>
        <FormField label="Include Zero Balance Invoices">
          <select
            value={includeZeroBalance ? "yes" : "no"}
            onChange={(e) => setIncludeZeroBalance(e.target.value === "yes")}
            className={inputClass}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </FormField>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          Loading ageing report…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <KpiCard label="Total Outstanding" value={formatINR(kpis.totalOutstanding)} />
            <KpiCard label="Current / Not Due" value={formatINR(kpis.buckets.not_due)} />
            <KpiCard label="Total Overdue" value={formatINR(kpis.totalOverdue)} emphasis />
            <KpiCard label="1–30 Days" value={formatINR(kpis.buckets.d1_30)} />
            <KpiCard label="31–60 Days" value={formatINR(kpis.buckets.d31_60)} />
            <KpiCard label="61–90 Days" value={formatINR(kpis.buckets.d61_90)} />
            <KpiCard label="Above 90 Days" value={formatINR(kpis.buckets.d90_plus)} emphasis />
            <KpiCard label="Overdue Customers" value={String(kpis.overdueCustomers)} />
          </div>

          {/* Customer-wise summary */}
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Customer-wise Ageing Summary
          </h3>
          <DataTable
            columns={customerColumns}
            rows={tableRows}
            empty="No outstanding invoices match these filters."
            rowClassName={(r) =>
              r.isTotals
                ? "bg-slate-50 font-semibold"
                : r.buckets.d61_90 > 0 || r.buckets.d90_plus > 0
                  ? "bg-red-50/60"
                  : ""
            }
          />

          {/* Invoice-wise detail */}
          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Invoice-wise Ageing Detail
          </h3>
          <DataTable
            columns={invoiceColumns}
            rows={filteredInvoiceRows}
            empty="No invoices match these filters."
          />
        </>
      )}
    </>
  );
}

function KpiCard({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${emphasis ? "text-red-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
