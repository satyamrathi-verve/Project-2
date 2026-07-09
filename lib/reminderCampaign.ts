/*
  Pure helper functions for the Auto Email Shoot screen (app/reminders). No
  Supabase calls live here — this file only turns rows already fetched from
  the DB (customers, invoices, receipt_allocations, reminder_log) into the
  candidate list, ageing bucket, and reminder-count label the screen shows.
  Mirrors the separation lib/collections.ts already uses for the Collections
  Workspace, so the two screens stay consistent.
*/

import type { Customer, Invoice, ReminderLog } from "./types";
import { ageingBucket, ageingDays, invoiceOutstanding, todayISO, type AgeingBucket } from "./collections";

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
      const remindersSent = reminderLog.filter((r) => r.invoice_id && custInvoiceIds.has(r.invoice_id)).length;

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
