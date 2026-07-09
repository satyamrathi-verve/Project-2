import type { Customer, Invoice, Receipt } from "@/lib/types";
import { ageingDaysFor, bucketFor, BUCKET_LABELS, BUCKET_ORDER, type BucketKey } from "@/app/reports/ageing/analytics";

/*
  Pure number-crunching for Customer Statement — screen view and the print
  document both read from the exact same functions here, so the two views
  can never quietly disagree with each other. Nothing in this file talks to
  Supabase; the page fetches invoices/receipts/allocations and passes them
  in. Ageing buckets are reused from the AR Ageing report (app/reports/ageing
  /analytics.ts) rather than redefined here, so a customer's "31–60 days"
  means the same thing on both reports.
*/

const EPS = 0.005;

export function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ---- ledger (running balance) -----------------------------------------------

export type EntryType = "Invoice" | "Receipt";

export interface LedgerEntry {
  date: string;
  type: EntryType;
  docNo: string;
  dueDate: string | null;
  debit: number;
  credit: number;
}

export interface LedgerRow {
  id: string;
  date: string;
  type: "Opening" | EntryType;
  docNo: string;
  description: string;
  dueDate: string | null;
  debit: number;
  credit: number;
  balance: number;
}

/** Invoices (debits) and receipts (credits) merged into one dated list. */
export function buildLedgerEntries(invoices: Invoice[], receipts: Receipt[]): LedgerEntry[] {
  const inv: (LedgerEntry & { order: number })[] = invoices.map((i) => ({
    date: i.invoice_date,
    type: "Invoice",
    docNo: i.invoice_no,
    dueDate: i.due_date,
    debit: Number(i.total),
    credit: 0,
    order: 0, // invoices sort before receipts when dated the same day
  }));
  const rec: (LedgerEntry & { order: number })[] = receipts.map((r) => ({
    date: r.receipt_date,
    type: "Receipt",
    docNo: r.receipt_no,
    dueDate: null,
    debit: 0,
    credit: Number(r.amount),
    order: 1,
  }));
  return [...inv, ...rec].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.docNo.localeCompare(b.docNo);
  });
}

export interface StatementResult {
  rows: LedgerRow[];
  openingForRange: number;
  totalDebit: number;
  totalCredit: number;
  closingForRange: number;
}

/**
 * Walks the running balance: opening_balance, then +debit/-credit in date
 * order. Anything dated before `fromDate` is folded into a single
 * brought-forward balance so a filtered range still reconciles correctly.
 */
export function buildStatement(
  entries: LedgerEntry[],
  openingBalance: number,
  fromDate: string,
  toDate: string,
  includeOpening: boolean
): StatementResult {
  let broughtForward = openingBalance;
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
      docNo: "",
      description: fromDate ? "Balance brought forward" : "Opening balance",
      dueDate: null,
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
      id: `${e.type}-${e.docNo}-${idx}`,
      date: e.date,
      type: e.type,
      docNo: e.docNo,
      description: e.type === "Invoice" ? "Sales Invoice" : "Payment Received",
      dueDate: e.dueDate,
      debit: e.debit,
      credit: e.credit,
      balance: running,
    });
  });

  return { rows, openingForRange: broughtForward, totalDebit, totalCredit, closingForRange: running };
}

// ---- aging summary (reuses AR Ageing's bucket boundaries) -------------------

export interface AgingBucketStat {
  bucket: BucketKey;
  label: string;
  amount: number;
  pct: number;
}

/**
 * Buckets this customer's outstanding (open/partial/overdue, unpaid) invoices
 * by age as of today — deliberately NOT affected by any ledger date-range
 * filter, since "how overdue is this customer right now" is a snapshot, not
 * a historical view.
 */
export function buildAgingSummary(invoices: Invoice[], allocByInvoice: Record<string, number>): AgingBucketStat[] {
  const today = todayStr();
  const totals: Record<BucketKey, number> = {
    not_due: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  };

  let grandTotal = 0;
  for (const inv of invoices) {
    const outstanding = Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0);
    if (outstanding <= EPS) continue;
    const bucket = bucketFor(ageingDaysFor(today, inv.due_date));
    totals[bucket] += outstanding;
    grandTotal += outstanding;
  }

  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: bucket === "not_due" ? "Current" : BUCKET_LABELS[bucket],
    amount: totals[bucket],
    pct: grandTotal > EPS ? (totals[bucket] / grandTotal) * 100 : 0,
  }));
}

// ---- collection status -------------------------------------------------------

export type CollectionStatus = "Current" | "Overdue" | "Critical" | "Blocked";

/**
 * One status per customer, derived only from outstanding/overdue/credit
 * limit — nothing new stored or fetched.
 *   Blocked  — total outstanding has crossed the customer's credit limit
 *              (only when a limit is actually set; 0 means "no limit").
 *   Critical — any balance is aged past 90 days.
 *   Overdue  — some balance is past due, but not (yet) critical or blocked.
 *   Current  — nothing is past due.
 */
export function computeCollectionStatus(
  totalOutstanding: number,
  overdueAmount: number,
  maxAgeingDays: number,
  creditLimit: number
): CollectionStatus {
  if (creditLimit > 0 && totalOutstanding > creditLimit) return "Blocked";
  if (maxAgeingDays > 90) return "Critical";
  if (overdueAmount > EPS) return "Overdue";
  return "Current";
}

// ---- overdue invoice breakdown (for the print document's collections section)

export interface OverdueInvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  invoiceAmount: number;
  outstanding: number;
}

export function buildOverdueInvoices(invoices: Invoice[], allocByInvoice: Record<string, number>): OverdueInvoiceRow[] {
  const today = todayStr();
  return invoices
    .map((inv) => {
      const outstanding = Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0);
      const daysOverdue = ageingDaysFor(today, inv.due_date);
      return { inv, outstanding, daysOverdue };
    })
    .filter((r) => r.outstanding > EPS && r.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .map(({ inv, outstanding, daysOverdue }) => ({
      id: inv.id,
      invoiceNo: inv.invoice_no,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      daysOverdue,
      invoiceAmount: Number(inv.total),
      outstanding,
    }));
}

// ---- summary figures used by both the KPI row and the print account-summary table

export interface CustomerFinancials {
  totalOutstanding: number;
  overdueAmount: number;
  currentBalance: number; // not-yet-due portion of the outstanding
  maxAgeingDays: number;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
  collectionStatus: CollectionStatus;
}

export function computeCustomerFinancials(
  customer: Customer,
  invoices: Invoice[],
  receipts: Receipt[],
  allocByInvoice: Record<string, number>
): CustomerFinancials {
  const today = todayStr();
  let totalOutstanding = 0;
  let overdueAmount = 0;
  let maxAgeingDays = 0;

  for (const inv of invoices) {
    const outstanding = Math.max(Number(inv.total) - (allocByInvoice[inv.id] ?? 0), 0);
    if (outstanding <= EPS) continue;
    totalOutstanding += outstanding;
    const ageing = ageingDaysFor(today, inv.due_date);
    if (ageing > 0) {
      overdueAmount += outstanding;
      if (ageing > maxAgeingDays) maxAgeingDays = ageing;
    }
  }

  const lastInvoiceDate = invoices.length ? invoices.reduce((a, b) => (a.invoice_date > b.invoice_date ? a : b)).invoice_date : null;
  const lastPaymentDate = receipts.length ? receipts.reduce((a, b) => (a.receipt_date > b.receipt_date ? a : b)).receipt_date : null;

  return {
    totalOutstanding,
    overdueAmount,
    currentBalance: Math.max(totalOutstanding - overdueAmount, 0),
    maxAgeingDays,
    lastInvoiceDate,
    lastPaymentDate,
    collectionStatus: computeCollectionStatus(totalOutstanding, overdueAmount, maxAgeingDays, Number(customer.credit_limit) || 0),
  };
}

export function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
