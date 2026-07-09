/*
  Pure helper functions for the Customer Collections Workspace. No Supabase calls
  live here — this file only turns rows already fetched from the DB (customers,
  invoices, receipts, receipt_allocations, reminder_log) into the numbers and
  labels the workspace displays. Keeping this separate from the page makes the
  ageing/priority/status rules easy to find and reuse from other report screens
  (AR Ageing, Dashboard) later.
*/

import type { Customer, Invoice, Receipt, ReceiptAllocation, ReminderLog } from "./types";

export type AgeingBucket = "not-due" | "0-30" | "31-60" | "61-90" | "90+";
export type Priority = "High" | "Medium" | "Low";
export type CollectionStatus =
  | "Fully Paid"
  | "No Follow-up"
  | "Reminder Sent"
  | "Promise to Pay"
  | "Broken Promise"
  | "Escalation Required";

/*
  Follow-up notes and Promise-to-Pay commitments have nowhere to live in the
  existing schema (no follow_ups / promises table) and this app is not allowed
  to create one. These records are session-only: kept in React state on the
  workspace page and lost on refresh. They are NOT written to Supabase.
*/
export interface FollowUpEntry {
  id: string;
  customerId: string;
  date: string;
  method: "Phone" | "Email" | "WhatsApp" | "Meeting" | "Other";
  contactedPerson: string;
  summary: string;
  outcome: string;
  nextFollowUpDate: string | null;
  createdAt: string;
}

export interface PromiseToPay {
  id: string;
  customerId: string;
  amount: number;
  promiseDate: string;
  personCommitting: string;
  remarks: string;
  createdAt: string;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Positive = days overdue. Zero or negative = not yet due. */
export function ageingDays(dueDateISO: string, today = todayISO()): number {
  return daysBetween(dueDateISO, today);
}

export function ageingBucket(ageing: number): AgeingBucket {
  if (ageing <= 0) return "not-due";
  if (ageing <= 30) return "0-30";
  if (ageing <= 60) return "31-60";
  if (ageing <= 90) return "61-90";
  return "90+";
}

export function priorityFromAgeing(maxAgeing: number): Priority {
  if (maxAgeing > 60) return "High";
  if (maxAgeing >= 30) return "Medium";
  return "Low";
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Outstanding on one invoice = total minus everything allocated against it. */
export function invoiceOutstanding(invoice: Invoice, allocatedByInvoice: Map<string, number>): number {
  const allocated = allocatedByInvoice.get(invoice.id) ?? 0;
  return Math.max(0, invoice.total - allocated);
}

export function buildAllocatedMap(allocations: ReceiptAllocation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of allocations) {
    map.set(a.invoice_id, (map.get(a.invoice_id) ?? 0) + a.amount);
  }
  return map;
}

/** Per-customer aggregate built from the customer's own open/partial/overdue invoices. */
export interface CustomerAggregate {
  customer: Customer;
  openInvoices: Invoice[];
  outstanding: number;
  currentDue: number;
  overdue: number;
  oldestInvoiceDate: string | null;
  maxAgeing: number;
  avgCollectionDays: number | null;
  priority: Priority;
}

export function aggregateCustomer(
  customer: Customer,
  allInvoices: Invoice[],
  allocatedByInvoice: Map<string, number>,
  receipts: Receipt[],
  today = todayISO()
): CustomerAggregate {
  const custInvoices = allInvoices.filter((i) => i.customer_id === customer.id);
  const openInvoices = custInvoices.filter((i) => i.status !== "paid");

  let currentDue = 0;
  let overdue = 0;
  let maxAgeing = -Infinity;
  let oldestInvoiceDate: string | null = null;

  for (const inv of openInvoices) {
    const outstanding = invoiceOutstanding(inv, allocatedByInvoice);
    const ageing = ageingDays(inv.due_date, today);
    if (ageing > 0) overdue += outstanding;
    else currentDue += outstanding;
    if (ageing > maxAgeing) maxAgeing = ageing;
    if (!oldestInvoiceDate || inv.invoice_date < oldestInvoiceDate) {
      oldestInvoiceDate = inv.invoice_date;
    }
  }
  if (openInvoices.length === 0) maxAgeing = 0;

  // Average collection days: invoice_date -> latest allocation date, paid invoices only.
  const paidInvoices = custInvoices.filter((i) => i.status === "paid");
  const collectionDays: number[] = [];
  for (const inv of paidInvoices) {
    const invReceiptDates = receipts
      .filter((r) => r.customer_id === customer.id)
      .map((r) => r.receipt_date);
    if (invReceiptDates.length === 0) continue;
    const latest = invReceiptDates.reduce((a, b) => (a > b ? a : b));
    collectionDays.push(daysBetween(inv.invoice_date, latest));
  }
  const avgCollectionDays =
    collectionDays.length > 0
      ? Math.round(collectionDays.reduce((a, b) => a + b, 0) / collectionDays.length)
      : null;

  return {
    customer,
    openInvoices,
    outstanding: currentDue + overdue,
    currentDue,
    overdue,
    oldestInvoiceDate,
    maxAgeing: Math.max(0, maxAgeing),
    avgCollectionDays,
    priority: priorityFromAgeing(Math.max(0, maxAgeing)),
  };
}

export function deriveCollectionStatus(
  agg: CustomerAggregate,
  latestPromise: PromiseToPay | undefined,
  hasReminderSent: boolean,
  hasFollowUp: boolean,
  today = todayISO()
): CollectionStatus {
  if (agg.outstanding <= 0) return "Fully Paid";
  if (latestPromise) {
    return latestPromise.promiseDate < today ? "Broken Promise" : "Promise to Pay";
  }
  if (agg.maxAgeing > 60) return "Escalation Required";
  if (hasReminderSent || hasFollowUp) return "Reminder Sent";
  return "No Follow-up";
}

/** Fills a reminder template's placeholders with real values for one invoice. */
export function fillReminderTemplate(
  text: string,
  values: { customer: string; amount: number; daysOverdue: number; invoiceNo: string }
): string {
  return text
    .replaceAll("{customer}", values.customer)
    .replaceAll("{amount}", values.amount.toLocaleString("en-IN"))
    .replaceAll("{days_overdue}", String(Math.max(0, values.daysOverdue)))
    .replaceAll("{invoice_no}", values.invoiceNo);
}

export function reminderLogForCustomer(
  log: ReminderLog[],
  customerInvoiceIds: Set<string>
): ReminderLog[] {
  return log.filter((r) => r.invoice_id && customerInvoiceIds.has(r.invoice_id));
}
