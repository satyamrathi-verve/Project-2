"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Avatar, Card, KpiCard, IconBanknote, IconCalendar, IconReceipt, IconWallet, inr } from "@/components/ui";

/*
  Screen 12 — Customer Statement (ledger).
  Read-only report: picks a customer, merges their invoices (debits) and
  receipts (credits) into one dated list, and walks a running balance
  starting from the customer's opening_balance. Nothing here writes to
  Supabase — it only reads invoices, receipts and receipt_allocations.
*/

type EntryType = "Invoice" | "Receipt";

interface LedgerEntry {
  date: string;
  type: EntryType;
  reference: string;
  debit: number;
  credit: number;
}

interface LedgerRow {
  id: string;
  date: string;
  type: "Opening" | EntryType;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

function formatDate(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function TypeBadge({ type }: { type: LedgerRow["type"] }) {
  const styles: Record<LedgerRow["type"], string> = {
    Opening: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
    Invoice: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    Receipt: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[type]}`}>
      {type === "Opening" ? "Opening" : type}
    </span>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocByInvoice, setAllocByInvoice] = useState<Record<string, number>>({});

  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeOpening, setIncludeOpening] = useState(true);

  // ---- load the customer list once --------------------------------------
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    (async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) setError(error.message);
      else setCustomers((data as Customer[]) ?? []);
    })();
  }, []);

  // ---- load this customer's invoices + receipts when picked -------------
  useEffect(() => {
    if (!customerId || !isConfigured || !supabase) {
      setInvoices([]);
      setReceipts([]);
      setAllocByInvoice({});
      return;
    }
    (async () => {
      setLoadingLedger(true);
      setError(null);

      const [invRes, recRes] = await Promise.all([
        supabase!.from("invoices").select("*").eq("customer_id", customerId).order("invoice_date"),
        supabase!.from("receipts").select("*").eq("customer_id", customerId).order("receipt_date"),
      ]);
      if (invRes.error) {
        setError(invRes.error.message);
        setLoadingLedger(false);
        return;
      }
      if (recRes.error) {
        setError(recRes.error.message);
        setLoadingLedger(false);
        return;
      }
      const invs = (invRes.data as Invoice[]) ?? [];
      setInvoices(invs);
      setReceipts((recRes.data as Receipt[]) ?? []);

      // Only needed to work out the overdue-amount tile (outstanding per invoice).
      const ids = invs.map((i) => i.id);
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
      setLoadingLedger(false);
    })();
  }, [customerId]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Merge invoices (debits) and receipts (credits) into one dated list.
  const entries = useMemo<LedgerEntry[]>(() => {
    const inv: (LedgerEntry & { order: number })[] = invoices.map((i) => ({
      date: i.invoice_date,
      type: "Invoice",
      reference: i.invoice_no,
      debit: Number(i.total),
      credit: 0,
      order: 0, // invoices sort before receipts when dated the same day
    }));
    const rec: (LedgerEntry & { order: number })[] = receipts.map((r) => ({
      date: r.receipt_date,
      type: "Receipt",
      reference: r.receipt_no,
      debit: 0,
      credit: Number(r.amount),
      order: 1,
    }));
    return [...inv, ...rec].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      return a.reference.localeCompare(b.reference);
    });
  }, [invoices, receipts]);

  // Walk the running balance: opening_balance, then +debit/-credit in date
  // order. Anything dated before "From Date" is folded into a single
  // brought-forward balance so a filtered range still reconciles correctly.
  const statement = useMemo(() => {
    if (!selectedCustomer) return null;
    const opening = Number(selectedCustomer.opening_balance) || 0;

    let broughtForward = opening;
    const inRange: LedgerEntry[] = [];
    for (const e of entries) {
      if (fromDate && e.date < fromDate) {
        broughtForward += e.debit - e.credit;
      } else if (!(toDate && e.date > toDate)) {
        inRange.push(e);
      }
    }

    const rows: LedgerRow[] = [];
    if (includeOpening) {
      rows.push({
        id: "opening",
        date: fromDate || "",
        type: "Opening",
        reference: fromDate ? "Balance brought forward" : "Opening balance",
        debit: 0,
        credit: 0,
        balance: broughtForward,
      });
    }

    let running = broughtForward;
    let totalDebit = 0;
    let totalCredit = 0;
    inRange.forEach((e, idx) => {
      running += e.debit - e.credit;
      totalDebit += e.debit;
      totalCredit += e.credit;
      rows.push({
        id: `${e.type}-${e.reference}-${idx}`,
        date: e.date,
        type: e.type,
        reference: e.reference,
        debit: e.debit,
        credit: e.credit,
        balance: running,
      });
    });

    return { rows, openingForRange: broughtForward, totalDebit, totalCredit, closingForRange: running };
  }, [selectedCustomer, entries, fromDate, toDate, includeOpening]);

  // Full-history outstanding, regardless of any date filter — this is the
  // number that should match the customer's total across open invoices.
  const totalOutstanding = useMemo(() => {
    if (!selectedCustomer) return 0;
    const opening = Number(selectedCustomer.opening_balance) || 0;
    return entries.reduce((s, e) => s + e.debit - e.credit, opening);
  }, [selectedCustomer, entries]);

  const overdueAmount = useMemo(() => {
    const today = todayStr();
    return invoices.reduce((sum, inv) => {
      if ((inv.status === "open" || inv.status === "partial") && inv.due_date < today) {
        const allocated = allocByInvoice[inv.id] ?? 0;
        return sum + Math.max(Number(inv.total) - allocated, 0);
      }
      return sum;
    }, 0);
  }, [invoices, allocByInvoice]);

  const isFiltered = Boolean(fromDate || toDate);

  function exportCsv() {
    if (!selectedCustomer || !statement) return;
    const header = ["Date", "Type", "Reference", "Debit", "Credit", "Running Balance"];
    const lines = statement.rows.map((r) => [
      r.date ? formatDate(r.date) : "",
      r.type,
      r.reference,
      r.debit ? r.debit.toFixed(2) : "",
      r.credit ? r.credit.toFixed(2) : "",
      r.balance.toFixed(2),
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${selectedCustomer.code}-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: `${c.code} — ${c.name}`,
    sublabel: c.phone ?? undefined,
  }));

  const columns: Column<LedgerRow>[] = [
    { key: "date", header: "Date", render: (r) => (r.date ? formatDate(r.date) : "—") },
    { key: "type", header: "Type", render: (r) => <TypeBadge type={r.type} /> },
    { key: "reference", header: "Reference" },
    {
      key: "debit",
      header: "Debit",
      className: "text-right tabular-nums",
      render: (r) => (r.debit ? inr(r.debit) : "—"),
    },
    {
      key: "credit",
      header: "Credit",
      className: "text-right tabular-nums",
      render: (r) => (r.credit ? inr(r.credit) : "—"),
    },
    {
      key: "balance",
      header: "Running Balance",
      className: "text-right tabular-nums font-semibold",
      render: (r) => (
        <span className={r.balance < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}>
          {inr(r.balance)}
        </span>
      ),
    },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div>
        <PageHeader
          title="Customer Statement"
          subtitle="A customer's invoices and receipts in one ledger, with a running balance."
        />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Customer Statement"
        subtitle="A customer's invoices and receipts in one ledger, with a running balance."
        action={
          selectedCustomer && (
            <div className="no-print flex gap-2">
              <button
                onClick={exportCsv}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Export CSV
              </button>
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
              >
                Print
              </button>
            </div>
          )
        }
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <Card className="no-print mb-6" title="Filters" subtitle="Pick a customer, then narrow the range if needed.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Customer">
            <SearchableSelect
              options={customerOptions}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search by code or name…"
            />
          </FormField>
          <FormField label="From Date">
            <input type="date" className={inputClass} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </FormField>
          <FormField label="To Date">
            <input type="date" className={inputClass} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </FormField>
          <FormField label="Options">
            <label className="flex h-[38px] items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeOpening}
                onChange={(e) => setIncludeOpening(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
              />
              Include opening balance row
            </label>
          </FormField>
        </div>
        {isFiltered && (
          <button
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="mt-3 text-xs font-medium text-brand hover:underline"
          >
            Clear date range
          </button>
        )}
      </Card>

      {!selectedCustomer ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
          Pick a customer above to view their statement.
        </div>
      ) : loadingLedger || !statement ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading statement…
        </div>
      ) : (
        <>
          <Card className="mb-6" title="Customer">
            <div className="flex items-start gap-4">
              <Avatar name={selectedCustomer.name} size="lg" />
              <div className="grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="Code" value={selectedCustomer.code} />
                <InfoItem label="Name" value={selectedCustomer.name} />
                <InfoItem label="GSTIN" value={selectedCustomer.gstin || "—"} />
                <InfoItem label="PAN" value={selectedCustomer.pan || "—"} />
                <InfoItem label="Contact Person" value={selectedCustomer.contact_person || "—"} />
                <InfoItem label="Email" value={selectedCustomer.email || "—"} />
                <InfoItem label="Phone" value={selectedCustomer.phone || "—"} />
                <InfoItem label="Credit Limit" value={inr(selectedCustomer.credit_limit)} />
                <InfoItem label="Credit Days" value={`${selectedCustomer.credit_days} days`} />
              </div>
            </div>
          </Card>

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label={isFiltered ? "Balance Brought Forward" : "Opening Balance"}
              value={inr(statement.openingForRange)}
              icon={<IconWallet className="h-4 w-4" />}
            />
            <KpiCard label="Total Debit" value={inr(statement.totalDebit)} sub="Invoices" icon={<IconReceipt className="h-4 w-4" />} />
            <KpiCard
              label="Total Credit"
              value={inr(statement.totalCredit)}
              sub="Receipts"
              icon={<IconBanknote className="h-4 w-4" />}
              accent="emerald"
            />
            <KpiCard
              label="Overdue Amount"
              value={inr(overdueAmount)}
              sub="Past due date, unpaid"
              icon={<IconCalendar className="h-4 w-4" />}
              accent="amber"
            />
            <KpiCard
              label="Total Outstanding"
              value={inr(totalOutstanding)}
              sub="Full history, all dates"
              icon={<IconWallet className="h-4 w-4" />}
              accent="violet"
            />
          </div>

          <DataTable
            columns={columns}
            rows={statement.rows}
            empty="No invoices or receipts for this customer in the selected range."
          />

          <div className="mt-6 flex items-center justify-between rounded-2xl border border-brand/30 bg-brand/5 px-6 py-5 dark:border-brand/40 dark:bg-brand/10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Closing Balance</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isFiltered
                  ? "As of the selected date range."
                  : "Matches this customer's total outstanding across open invoices."}
              </p>
            </div>
            <p className="text-3xl font-bold tabular-nums text-brand">{inr(statement.closingForRange)}</p>
          </div>
        </>
      )}
    </div>
  );
}
