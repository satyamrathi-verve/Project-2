import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";

/*
  Customer Health Card — calculation only, kept apart from the card's JSX.

  Everything here is derived from invoices, receipt_allocations and receipts
  already fetched for one customer. Nothing is written back to Supabase, and
  the score/status are never saved anywhere — they're recalculated fresh
  every time the card is opened.
*/

export type HealthStatus = "Healthy" | "Attention Required" | "High Risk" | "Critical";

export interface CustomerHealth {
  totalOutstanding: number;
  overdueAmount: number;
  openInvoiceCount: number;
  oldestDueDate: string | null;
  maxAgeingDays: number;
  creditLimit: number;
  /** null = Not Available (no credit limit set on this customer) */
  creditLimitUsedPct: number | null;
  /** null = Not Available (no receipts recorded yet) */
  lastReceiptDate: string | null;
  /** null = Not Available (nothing has been fully paid yet, so no days-to-collect data exists) */
  averageCollectionDays: number | null;
  score: number;
  status: HealthStatus;
}

export const HEALTH_STATUS_COLORS: Record<HealthStatus, { badge: string; ring: string }> = {
  Healthy: {
    badge:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    ring: "stroke-emerald-500",
  },
  "Attention Required": {
    badge:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    ring: "stroke-amber-500",
  },
  "High Risk": {
    badge:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30",
    ring: "stroke-orange-500",
  },
  Critical: {
    badge: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
    ring: "stroke-red-600",
  },
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

function statusForScore(score: number): HealthStatus {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Attention Required";
  if (score >= 40) return "High Risk";
  return "Critical";
}

/**
 * Score starts at 100 and loses points for each risk factor found:
 *  - any overdue balance at all                       -10
 *  - worst invoice ageing past 30 days                 -10 (on top of the above)
 *  - worst invoice ageing past 60 days                 -15 more
 *  - worst invoice ageing past 90 days                 -20 more
 *  - outstanding has crossed the credit limit           -20 (only if a limit is set)
 *  - no receipt in the last 60 days                     -10 (only checked when at
 *    least one receipt exists — silence with zero receipts ever isn't the same
 *    signal as going quiet after a payment history)
 * Clamped to 0–100, then mapped to a status band.
 */
export function computeCustomerHealth(
  customer: Customer,
  invoices: Invoice[],
  allocations: ReceiptAllocation[],
  receipts: Receipt[],
  asOnDate: string = new Date().toISOString().slice(0, 10)
): CustomerHealth {
  const allocatedByInvoice = new Map<string, number>();
  for (const a of allocations) {
    allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
  }
  const receiptDateById = new Map(receipts.map((r) => [r.id, r.receipt_date]));

  let totalOutstanding = 0;
  let overdueAmount = 0;
  let openInvoiceCount = 0;
  let oldestDueDate: string | null = null;
  let maxAgeingDays = 0;
  const collectionDaysList: number[] = [];

  for (const inv of invoices) {
    const received = allocatedByInvoice.get(inv.id) ?? 0;
    const outstanding = Math.round((Number(inv.total) - received) * 100) / 100;

    if (outstanding > 0) {
      const ageingDays = daysBetween(inv.due_date, asOnDate);
      totalOutstanding += outstanding;
      openInvoiceCount += 1;
      if (!oldestDueDate || inv.due_date < oldestDueDate) oldestDueDate = inv.due_date;
      if (ageingDays > maxAgeingDays) maxAgeingDays = ageingDays;
      if (ageingDays > 0) overdueAmount += outstanding;
    } else {
      // Fully paid — the latest allocation date against this invoice is when
      // it was cleared, so that minus the invoice date is its collection time.
      const paidDates = allocations
        .filter((a) => a.invoice_id === inv.id)
        .map((a) => receiptDateById.get(a.receipt_id))
        .filter((d): d is string => Boolean(d));
      if (paidDates.length > 0) {
        const paidOn = paidDates.reduce((latest, d) => (d > latest ? d : latest));
        collectionDaysList.push(daysBetween(inv.invoice_date, paidOn));
      }
    }
  }

  const creditLimit = customer.credit_limit ?? 0;
  const creditLimitUsedPct = creditLimit > 0 ? Math.round((totalOutstanding / creditLimit) * 100) : null;

  const lastReceiptDate =
    receipts.length > 0
      ? receipts.reduce((latest, r) => (r.receipt_date > latest ? r.receipt_date : latest), receipts[0].receipt_date)
      : null;

  const averageCollectionDays =
    collectionDaysList.length > 0
      ? Math.round(collectionDaysList.reduce((s, d) => s + d, 0) / collectionDaysList.length)
      : null;

  let score = 100;
  if (overdueAmount > 0) score -= 10;
  if (maxAgeingDays > 30) score -= 10;
  if (maxAgeingDays > 60) score -= 15;
  if (maxAgeingDays > 90) score -= 20;
  if (creditLimit > 0 && totalOutstanding > creditLimit) score -= 20;
  if (lastReceiptDate && daysBetween(lastReceiptDate, asOnDate) > 60) score -= 10;
  score = Math.max(0, Math.min(100, score));

  return {
    totalOutstanding,
    overdueAmount,
    openInvoiceCount,
    oldestDueDate,
    maxAgeingDays,
    creditLimit,
    creditLimitUsedPct,
    lastReceiptDate,
    averageCollectionDays,
    score,
    status: statusForScore(score),
  };
}
