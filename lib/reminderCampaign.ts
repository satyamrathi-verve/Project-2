/*
  Pure helper functions for the Auto Email Shoot screen (app/reminders). No
  Supabase calls live here — this file only turns rows already fetched from
  the DB (customers, invoices, receipt_allocations, reminder_log) into the
  candidate list, ageing bucket, and reminder-count label the screen shows.
  Mirrors the separation lib/collections.ts already uses for the Collections
  Workspace, so the two screens stay consistent.
*/

import type { Customer, Invoice, Receipt, ReminderLog } from "./types";
import { ageingBucket, ageingDays, formatDate, invoiceOutstanding, todayISO, type AgeingBucket } from "./collections";

const EPS = 0.005;

export interface CandidateInvoice extends Invoice {
  outstanding: number;
  ageing: number;
  bucket: AgeingBucket;
}

/** One row in the Auto Email Shoot customer table: a customer with money still owed. */
export interface Candidate {
  customer: Customer;
  invoices: CandidateInvoice[]; // open/partial invoices with outstanding > 0, most-overdue first
  outstanding: number;
  overdueAmount: number;
  maxAgeing: number;
  maxBucket: AgeingBucket;
  oldestDueDate: string | null;
  /** Most-overdue invoice — used to fill the template's single-value placeholders. */
  primaryInvoice: CandidateInvoice | null;
  remindersSent: number;
  hasEmail: boolean;
  lastPaymentDate: string | null;
  lastReminderDate: string | null;
}

export type EmailStatus = "Ready" | "Missing Email" | "Sending" | "Sent" | "Failed" | "Skipped";

export interface CampaignSummary {
  totalProcessed: number;
  sent: number;
  failed: number;
  skipped: number;
  outstandingCovered: number;
  at: string;
}

export function buildCandidates(
  customers: Customer[],
  invoices: Invoice[],
  allocatedByInvoice: Map<string, number>,
  reminderLog: ReminderLog[],
  receipts: Receipt[] = [],
  today = todayISO()
): Candidate[] {
  return customers
    .map((customer) => {
      const lines: CandidateInvoice[] = invoices
        .filter((i) => i.customer_id === customer.id && i.status !== "paid")
        .map((inv) => {
          const outstanding = invoiceOutstanding(inv, allocatedByInvoice);
          const ageing = ageingDays(inv.due_date, today);
          return { ...inv, outstanding, ageing, bucket: ageingBucket(ageing) };
        })
        .filter((l) => l.outstanding > EPS)
        .sort((a, b) => b.ageing - a.ageing || (a.due_date < b.due_date ? -1 : 1));

      const outstanding = lines.reduce((s, l) => s + l.outstanding, 0);
      const overdueAmount = lines.filter((l) => l.ageing > 0).reduce((s, l) => s + l.outstanding, 0);
      const maxAgeing = lines.length ? Math.max(0, ...lines.map((l) => l.ageing)) : 0;
      const oldestDueDate = lines.length
        ? lines.reduce((a, b) => (a.due_date < b.due_date ? a : b)).due_date
        : null;
      const custInvoiceIds = new Set(lines.map((l) => l.id));
      const custReminders = reminderLog.filter((r) => r.invoice_id && custInvoiceIds.has(r.invoice_id));
      const remindersSent = custReminders.length;
      // sent_at is a full timestamptz; keep only the date part so it matches
      // the plain "date" columns (due_date, receipt_date) everywhere else.
      const lastReminderDate = custReminders.length
        ? custReminders.reduce((a, b) => (a.sent_at > b.sent_at ? a : b)).sent_at.slice(0, 10)
        : null;
      const custReceipts = receipts.filter((r) => r.customer_id === customer.id);
      const lastPaymentDate = custReceipts.length
        ? custReceipts.reduce((a, b) => (a.receipt_date > b.receipt_date ? a : b)).receipt_date
        : null;

      return {
        customer,
        invoices: lines,
        outstanding,
        overdueAmount,
        maxAgeing,
        maxBucket: ageingBucket(maxAgeing),
        oldestDueDate,
        primaryInvoice: lines[0] ?? null,
        remindersSent,
        hasEmail: Boolean(customer.email),
        lastPaymentDate,
        lastReminderDate,
      };
    })
    .filter((c) => c.outstanding > EPS);
}

/** "Not sent yet" / "1st reminder sent" / "2nd reminder sent" … from a real reminder_log count. */
export function reminderStageLabel(count: number): string {
  if (count === 0) return "Not sent yet";
  const v = count % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][count % 10] ?? "th");
  return `${count}${suffix} reminder sent`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function endOfMonthISO(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
  Builds the invoice table as real, inline-styled HTML (email clients ignore
  <style> blocks and CSS classes, so every rule has to be inline) — one row
  per outstanding invoice, added automatically as the customer's invoice
  count changes. Used to fill the {invoice_table} placeholder.
*/
export function buildInvoiceTableHtml(invoices: CandidateInvoice[]): string {
  const cell = "border:1px solid #cbd5e1;padding:6px 10px;font-size:13px;";
  const headCell = `${cell}background:#f1f5f9;text-align:left;font-weight:600;`;
  const rows = invoices
    .map(
      (inv) => `<tr>
        <td style="${cell}">${escapeHtml(inv.invoice_no)}</td>
        <td style="${cell}">${formatDate(inv.invoice_date)}</td>
        <td style="${cell}">${formatDate(inv.due_date)}</td>
        <td style="${cell}text-align:right;">₹${inv.outstanding.toLocaleString("en-IN")}</td>
        <td style="${cell}text-align:right;">${inv.ageing > 0 ? inv.ageing : 0}</td>
      </tr>`
    )
    .join("");
  return `<table style="width:100%;min-width:560px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;margin:12px 0;">
    <thead><tr>
      <th style="${headCell}">Invoice No.</th>
      <th style="${headCell}">Invoice Date</th>
      <th style="${headCell}">Due Date</th>
      <th style="${headCell}text-align:right;">Outstanding Amount</th>
      <th style="${headCell}text-align:right;">Overdue (Days)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/*
  Turns a plain-text template (the same kind edited on the Reminder Template
  screen — placeholders, blank-line-separated paragraphs) into a full HTML
  email for ONE customer covering ALL of their outstanding invoices. The
  {invoice_table} paragraph is swapped for a real <table>; every other
  paragraph is escaped and wrapped in <p>.

  Each paragraph's literal text is escaped first — placeholder tokens like
  "{customer}" contain no HTML-sensitive characters, so escaping first is a
  no-op on them — then the already-escaped dynamic value is substituted in.
  That order avoids double-escaping a customer name containing "&" or "'".
*/
export function fillConsolidatedReminderHtml(
  rawBody: string,
  params: { customerName: string; invoices: CandidateInvoice[] }
): string {
  const { customerName, invoices } = params;
  const tableHtml = buildInvoiceTableHtml(invoices);
  const paragraphs = rawBody.split(/\n\s*\n/).map((block) => {
    if (block.trim() === "{invoice_table}") return tableHtml;
    const withValues = escapeHtml(block).replaceAll("{customer}", escapeHtml(customerName));
    return `<p style="margin:0 0 12px 0;">${withValues.split("\n").join("<br/>")}</p>`;
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5;">${paragraphs.join("")}</div>`;
}

/** One row in the Total Reminders Sent drill-down — a reminder_log row joined to its invoice/customer. */
export interface ReminderHistoryRow {
  id: string;
  customerName: string;
  invoiceNo: string;
  toEmail: string | null;
  status: string;
  sentAt: string;
}

export function buildReminderHistory(
  reminderLog: ReminderLog[],
  invoices: Invoice[],
  customers: Customer[]
): ReminderHistoryRow[] {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  return reminderLog
    .map((log) => {
      const invoice = log.invoice_id ? invoiceById.get(log.invoice_id) : undefined;
      const customer = invoice ? customerById.get(invoice.customer_id) : undefined;
      return {
        id: log.id,
        customerName: customer?.name ?? "—",
        invoiceNo: invoice?.invoice_no ?? "—",
        toEmail: log.to_email,
        status: log.status,
        sentAt: log.sent_at,
      };
    })
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}
