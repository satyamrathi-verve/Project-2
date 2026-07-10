"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Avatar, Card, Skeleton, IconDownload, IconMail, IconPrinter, IconSliders, IconChevronDown, inr, inrCompact } from "@/components/ui";
import { BUCKET_COLORS } from "@/app/reports/ageing/analytics";
import {
  buildLedgerEntries,
  buildStatement,
  buildAgingSummary,
  buildOverdueInvoices,
  computeCustomerFinancials,
  formatDate,
  formatDateTime,
  todayStr,
  type CollectionStatus,
  type LedgerRow,
} from "@/lib/statement";
import { exportStatementXlsx, buildStatementEmail } from "@/lib/statementIO";
import { StatementPrintView } from "./StatementPrintView";

/*
  Screen 12 — Customer Statement.
  Two independent renderings of the exact same data: a SaaS-style dashboard
  for the AR team on screen, and a completely separate letterhead document
  (StatementPrintView) for anything printed/exported/emailed to the customer.
  Both read from lib/statement.ts so they can never disagree with each other.
  Read-only against invoices/receipts/receipt_allocations/customers/company;
  the only write in this file is a simulated Send Email (a reminder_log row,
  same convention Auto Email Shoot already uses — no real mailbox exists).
*/

type DocTypeFilter = "all" | "Invoice" | "Receipt";

const STATUS_STYLES: Record<CollectionStatus, string> = {
  Current: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  Overdue: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  Critical: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
  Blocked: "bg-red-600 text-white ring-red-700 dark:bg-red-700 dark:text-white dark:ring-red-800",
};

function CollectionStatusBadge({ status }: { status: CollectionStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-0.5 break-words text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

function CompactKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="themed rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: LedgerRow["type"] }) {
  const styles: Record<LedgerRow["type"], string> = {
    Opening: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
    Invoice: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    Receipt: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[type]}`}>{type}</span>
  );
}

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 sm:text-sm";

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [company, setCompany] = useState<Company | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocByInvoice, setAllocByInvoice] = useState<Record<string, number>>({});

  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeOpening, setIncludeOpening] = useState(true);
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilter>("all");
  const [invoiceNoSearch, setInvoiceNoSearch] = useState("");
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ---- customers + company, loaded once --------------------------------
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    (async () => {
      const [custRes, companyRes] = await Promise.all([
        supabase!.from("customers").select("*").order("name"),
        supabase!.from("company").select("*").limit(1).maybeSingle(),
      ]);
      if (custRes.error) setError(custRes.error.message);
      else setCustomers((custRes.data as Customer[]) ?? []);
      setCompany((companyRes.data as Company) ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  // ---- this customer's invoices + receipts when picked -------------------
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

  const entries = useMemo(() => buildLedgerEntries(invoices, receipts), [invoices, receipts]);

  const statement = useMemo(() => {
    if (!selectedCustomer) return null;
    const opening = Number(selectedCustomer.opening_balance) || 0;
    return buildStatement(entries, opening, fromDate, toDate, includeOpening);
  }, [selectedCustomer, entries, fromDate, toDate, includeOpening]);

  // Snapshot metrics — deliberately NOT affected by the date-range filter
  // above, since "how overdue is this customer right now" is a live status,
  // not a historical view.
  const financials = useMemo(() => {
    if (!selectedCustomer) return null;
    return computeCustomerFinancials(selectedCustomer, invoices, receipts, allocByInvoice);
  }, [selectedCustomer, invoices, receipts, allocByInvoice]);

  const agingSummary = useMemo(() => buildAgingSummary(invoices, allocByInvoice), [invoices, allocByInvoice]);
  const overdueInvoices = useMemo(() => buildOverdueInvoices(invoices, allocByInvoice), [invoices, allocByInvoice]);

  // Per-invoice outstanding/overdue lookup (by invoice_no) so the row-level
  // "Show Only Outstanding/Overdue" filters can apply to Invoice ledger rows.
  const invoiceMetaByNo = useMemo(() => {
    const today = todayStr();
    const map = new Map<string, { outstanding: number; overdue: boolean }>();
    for (const inv of invoices) {
      const outstanding = Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0);
      map.set(inv.invoice_no, { outstanding, overdue: outstanding > 0.005 && inv.due_date < today });
    }
    return map;
  }, [invoices, allocByInvoice]);

  // Display-layer filters (document type / invoice no / outstanding / overdue) —
  // applied on top of the already-date-ranged statement rows. The Balance
  // column keeps showing the true running total even when rows are hidden,
  // same as any filtered ledger view.
  const displayRows = useMemo(() => {
    if (!statement) return [];
    const q = invoiceNoSearch.trim().toLowerCase();
    return statement.rows.filter((r) => {
      if (r.type === "Opening") return true;
      if (docTypeFilter !== "all" && r.type !== docTypeFilter) return false;
      if (q && !r.docNo.toLowerCase().includes(q)) return false;
      if ((onlyOutstanding || onlyOverdue) && r.type === "Invoice") {
        const meta = invoiceMetaByNo.get(r.docNo);
        if (onlyOutstanding && !(meta && meta.outstanding > 0.005)) return false;
        if (onlyOverdue && !(meta && meta.overdue)) return false;
      }
      return true;
    });
  }, [statement, docTypeFilter, invoiceNoSearch, onlyOutstanding, onlyOverdue, invoiceMetaByNo]);

  const isFiltered = Boolean(fromDate || toDate);
  const periodLabel = isFiltered ? `${fromDate ? formatDate(fromDate) : "Inception"} to ${toDate ? formatDate(toDate) : "Date"}` : "All Time";

  function exportExcel() {
    if (!selectedCustomer || !statement) return;
    exportStatementXlsx(selectedCustomer, displayRows, statement.closingForRange, `Statement_${selectedCustomer.code}_${todayStr()}.xlsx`);
  }

  async function handleSendEmail() {
    if (!selectedCustomer || !statement || !supabase || !financials) return;
    setSendingEmail(true);
    const email = buildStatementEmail(selectedCustomer, statement.closingForRange, financials.overdueAmount, periodLabel);
    const { error: sendError } = await supabase.from("reminder_log").insert({
      invoice_id: null,
      to_email: email.to || null,
      subject: email.subject,
      body: email.body,
      status: "sent",
    });
    setSendingEmail(false);
    if (sendError) {
      setBanner({ type: "error", text: `Could not send: ${sendError.message}` });
      return;
    }
    setEmailModalOpen(false);
    setBanner({ type: "success", text: email.to ? `Statement emailed to ${email.to} (simulated).` : "Statement logged as sent (customer has no email on file)." });
  }

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: `${c.code} — ${c.name}`,
    sublabel: c.phone ?? undefined,
  }));

  const columns: Column<LedgerRow>[] = [
    { key: "date", header: "Date", render: (r) => (r.date ? formatDate(r.date) : "—") },
    { key: "type", header: "Document Type", render: (r) => <TypeBadge type={r.type} /> },
    { key: "docNo", header: "Document No", render: (r) => r.docNo || "—" },
    { key: "description", header: "Description", render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.description}</span> },
    { key: "dueDate", header: "Due Date", render: (r) => (r.dueDate ? formatDate(r.dueDate) : "—") },
    { key: "debit", header: "Debit", className: "text-right tabular-nums", render: (r) => (r.debit ? inr(r.debit) : "—") },
    { key: "credit", header: "Credit", className: "text-right tabular-nums", render: (r) => (r.credit ? inr(r.credit) : "—") },
    {
      key: "balance",
      header: "Running Balance",
      className: "text-right tabular-nums font-semibold",
      render: (r) => (
        <span className={r.balance < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}>{inr(r.balance)}</span>
      ),
    },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div>
        <PageHeader title="Customer Statement" subtitle="A customer's invoices and receipts in one ledger, with a running balance." />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      {/* ============================= SCREEN VIEW ============================= */}
      <div className="print:hidden">
        <PageHeader
          title="Customer Statement"
          subtitle={
            selectedCustomer
              ? `${selectedCustomer.name} · Statement Period: ${periodLabel} · Generated ${formatDateTime(new Date())}`
              : "A customer's invoices and receipts in one ledger, with a running balance."
          }
          action={
            selectedCustomer && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => window.print()} className={actionButton}>
                  <IconPrinter className="h-4 w-4" /> Print
                </button>
                <button onClick={() => window.print()} className={actionButton}>
                  <IconDownload className="h-4 w-4" /> Export PDF
                </button>
                <button onClick={exportExcel} className={actionButton}>
                  <IconDownload className="h-4 w-4" /> Export Excel
                </button>
                <button onClick={() => setEmailModalOpen(true)} className={`${actionButton} border-brand/30 bg-brand/5 text-brand hover:bg-brand/10 dark:bg-brand/10`}>
                  <IconMail className="h-4 w-4" /> Send Email
                </button>
              </div>
            )
          }
        />

        {banner && (
          <div
            className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
              banner.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            }`}
          >
            {banner.text}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        {/* ---- collapsible filter panel ---- */}
        <Card className="mb-6" bodyClassName="p-0">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <IconSliders className="h-4 w-4 text-slate-400" /> Search &amp; Filter
            </span>
            <IconChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </button>
          {filtersOpen && (
            <div className="border-t border-slate-100 px-6 py-5 dark:border-slate-800">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Customer">
                  <SearchableSelect options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="Search by code or name…" />
                </FormField>
                <FormField label="From Date">
                  <input type="date" className={inputClass} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </FormField>
                <FormField label="To Date">
                  <input type="date" className={inputClass} value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </FormField>
                <FormField label="Document Type">
                  <select className={inputClass} value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value as DocTypeFilter)}>
                    <option value="all">All</option>
                    <option value="Invoice">Invoice</option>
                    <option value="Receipt">Receipt</option>
                  </select>
                </FormField>
                <FormField label="Invoice / Document No">
                  <input className={inputClass} value={invoiceNoSearch} onChange={(e) => setInvoiceNoSearch(e.target.value)} placeholder="e.g. INV-0012" />
                </FormField>
                <FormField label="Options">
                  <div className="flex h-[38px] items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={includeOpening} onChange={(e) => setIncludeOpening(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600" />
                      Opening row
                    </label>
                  </div>
                </FormField>
                <FormField label="Outstanding">
                  <label className="flex h-[38px] items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600" />
                    Show only outstanding
                  </label>
                </FormField>
                <FormField label="Overdue">
                  <label className="flex h-[38px] items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600" />
                    Show only overdue
                  </label>
                </FormField>
              </div>
              {(isFiltered || docTypeFilter !== "all" || invoiceNoSearch || onlyOutstanding || onlyOverdue) && (
                <button
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setDocTypeFilter("all");
                    setInvoiceNoSearch("");
                    setOnlyOutstanding(false);
                    setOnlyOverdue(false);
                  }}
                  className="mt-3 text-xs font-medium text-brand hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </Card>

        {!selectedCustomer ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
            Pick a customer above to view their statement.
          </div>
        ) : loadingLedger || !statement || !financials ? (
          <div className="space-y-6">
            <Card>
              <Skeleton className="h-24 w-full" />
            </Card>
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* ---- customer summary card ---- */}
            <Card className="mb-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex gap-4">
                  <Avatar name={selectedCustomer.name} size="lg" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{selectedCustomer.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Code: {selectedCustomer.code}</p>
                    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                      <InfoItem label="GSTIN" value={selectedCustomer.gstin || "—"} />
                      <InfoItem label="PAN" value={selectedCustomer.pan || "—"} />
                      <InfoItem label="Contact Person" value={selectedCustomer.contact_person || "—"} />
                      <InfoItem label="Email" value={selectedCustomer.email || "—"} />
                      <InfoItem label="Phone" value={selectedCustomer.phone || "—"} />
                      <InfoItem label="Address" value={selectedCustomer.address || "—"} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col justify-center gap-4 border-t border-slate-100 pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Outstanding Amount</p>
                      <p className="mt-1 text-3xl font-bold tabular-nums text-brand">{inr(financials.totalOutstanding)}</p>
                    </div>
                    <CollectionStatusBadge status={financials.collectionStatus} />
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <InfoItem label="Overdue Amount" value={inr(financials.overdueAmount)} />
                    <InfoItem label="Current Balance" value={inr(financials.currentBalance)} />
                    <InfoItem label="Last Payment Date" value={formatDate(financials.lastPaymentDate)} />
                    <InfoItem label="Last Invoice Date" value={formatDate(financials.lastInvoiceDate)} />
                  </div>
                </div>
              </div>
            </Card>

            {/* ---- aging summary ---- */}
            <Card className="mb-6" title="Aging Summary" subtitle="Where this customer's current outstanding sits, by age (as of today).">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {agingSummary.map((b) => (
                  <div key={b.bucket} className={`rounded-xl p-3 ${BUCKET_COLORS[b.bucket]}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{b.label}</p>
                    <p className="mt-1 text-base font-bold tabular-nums">{inrCompact(b.amount)}</p>
                    <p className="text-[11px] opacity-70">{b.pct.toFixed(0)}%</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/60 dark:bg-black/20">
                      <div className="h-full rounded-full bg-current opacity-60" style={{ width: `${Math.max(b.pct, 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* ---- compact KPI row ---- */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CompactKpi label={isFiltered ? "Balance Brought Forward" : "Opening Balance"} value={inr(statement.openingForRange)} />
              <CompactKpi label="Invoices Raised" value={inr(statement.totalDebit)} />
              <CompactKpi label="Payments Received" value={inr(statement.totalCredit)} />
              <CompactKpi label="Closing Balance" value={inr(statement.closingForRange)} />
            </div>

            {/* ---- transaction ledger ---- */}
            <DataTable
              columns={columns}
              rows={displayRows}
              stickyHeader
              rowClassName={(r, i) => (r.type === "Opening" ? "bg-slate-50 dark:bg-slate-800/40" : i % 2 === 1 ? "bg-slate-50/60 dark:bg-slate-800/20" : "")}
              empty="No transactions match the current filters."
            />
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              Showing {displayRows.length} of {statement.rows.length} entries
            </p>
          </>
        )}
      </div>

      {/* ============================= PRINT / PDF VIEW ============================= */}
      {selectedCustomer && statement && financials && (
        <div className="hidden print:block">
          <StatementPrintView
            company={company}
            customer={selectedCustomer}
            periodLabel={periodLabel}
            generatedAt={new Date()}
            rows={displayRows}
            totalDebit={statement.totalDebit}
            totalCredit={statement.totalCredit}
            closingBalance={statement.closingForRange}
            financials={financials}
            overdueInvoices={overdueInvoices}
          />
        </div>
      )}

      {/* ============================= SEND EMAIL MODAL ============================= */}
      {emailModalOpen && selectedCustomer && statement && financials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setEmailModalOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Send Statement Email" className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Send Statement Email</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Simulated — this app has no real mailbox, so sending logs the email to reminder_log instead of delivering it.
              </p>
            </div>
            {(() => {
              const email = buildStatementEmail(selectedCustomer, statement.closingForRange, financials.overdueAmount, periodLabel);
              return (
                <div className="space-y-3 px-6 py-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">To</p>
                    <p className={email.to ? "text-slate-800 dark:text-slate-200" : "text-red-600 dark:text-red-400"}>
                      {email.to || "No email on file for this customer"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Subject</p>
                    <p className="text-slate-800 dark:text-slate-200">{email.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Body</p>
                    <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{email.body}</pre>
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button onClick={() => setEmailModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-60"
              >
                {sendingEmail ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
