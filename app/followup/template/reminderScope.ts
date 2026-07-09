/*
  "Reminder Scope" — Invoice Wise vs Customer Wise preview data for the
  Reminder Template screen. This deliberately does NOT recompute outstanding
  amounts or ageing itself: it imports buildInvoiceRows straight from the AR
  Ageing report (app/reports/ageing/analytics.ts), the single existing source
  of truth for "outstanding" and "days overdue" in this app, and only adds the
  bits specific to previewing a reminder — which fill values to use, and how
  to render an invoice table for the {invoice_table} placeholder.
*/

import type { InvoiceItem } from "@/lib/types";
import { formatDate, formatINR, type InvoiceRow } from "@/app/reports/ageing/analytics";
import { escapeHtml } from "./reminderTemplateConfig";

export type ReminderScope = "invoice_wise" | "customer_wise";

/** One combined description per invoice, joining multiple line items if there are more than one. */
export function descriptionByInvoiceId(items: InvoiceItem[]): Map<string, string> {
  const byInvoice = new Map<string, string[]>();
  for (const item of items) {
    const list = byInvoice.get(item.invoice_id) ?? [];
    list.push(item.description);
    byInvoice.set(item.invoice_id, list);
  }
  const out = new Map<string, string>();
  for (const [id, list] of byInvoice) out.set(id, list.join("; "));
  return out;
}

/** Matches fillReminderTemplate's value shape exactly, so it can be passed straight through. */
export interface ScopeFillValues {
  customer: string;
  amount: number;
  daysOverdue: number;
  invoiceNo: string;
}

const MAX_LISTED_INVOICE_NOS = 2;

function joinInvoiceNos(nos: string[]): string {
  if (nos.length === 0) return "";
  if (nos.length <= MAX_LISTED_INVOICE_NOS) return nos.join(", ");
  return `${nos.slice(0, MAX_LISTED_INVOICE_NOS).join(", ")} +${nos.length - MAX_LISTED_INVOICE_NOS} more`;
}

/** Invoice Wise: fill values come straight from the one selected invoice. */
export function computeInvoiceWiseFillValues(row: InvoiceRow | undefined): ScopeFillValues | null {
  if (!row) return null;
  return { customer: row.customerName, amount: row.outstanding, daysOverdue: row.ageingDays, invoiceNo: row.invoiceNo };
}

/** Customer Wise: fill values are aggregated across every outstanding invoice for that customer. */
export function computeCustomerWiseFillValues(customerName: string, customerRows: InvoiceRow[]): ScopeFillValues {
  const outstandingRows = customerRows.filter((r) => r.outstanding > 0);
  const amount = outstandingRows.reduce((s, r) => s + r.outstanding, 0);
  const daysOverdue = outstandingRows.length ? Math.max(0, ...outstandingRows.map((r) => r.ageingDays)) : 0;
  const invoiceNo = joinInvoiceNos(outstandingRows.map((r) => r.invoiceNo));
  return { customer: customerName, amount, daysOverdue, invoiceNo };
}

export interface InvoiceTableRow {
  invoiceDate: string;
  invoiceNo: string;
  customerName: string;
  description: string;
  invoiceAmount: number;
  outstanding: number;
  ageingDays: number;
}

export function toInvoiceTableRows(rows: InvoiceRow[], descriptions: Map<string, string>): InvoiceTableRow[] {
  return rows.map((r) => ({
    invoiceDate: r.invoiceDate,
    invoiceNo: r.invoiceNo,
    customerName: r.customerName,
    description: descriptions.get(r.id) ?? "—",
    invoiceAmount: r.invoiceAmount,
    outstanding: r.outstanding,
    ageingDays: r.ageingDays,
  }));
}

const TABLE_HEADERS = [
  "Invoice Date",
  "Invoice No.",
  "Customer Name",
  "Description of Service",
  "Invoice Amount",
  "Pending Amount",
  "Days Overdue",
];

/** Renders the {invoice_table} placeholder's HTML — an invoice table plus the total outstanding below it. */
export function buildInvoiceTableHtml(rows: InvoiceTableRow[]): string {
  if (rows.length === 0) {
    return `<p style="color:#94a3b8;">No outstanding invoices for this customer.</p>`;
  }

  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  const theadCells = TABLE_HEADERS.map(
    (h) =>
      `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid rgba(148,163,184,.45);font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#94a3b8;">${escapeHtml(
        h
      )}</th>`
  ).join("");

  const bodyRows = rows
    .map((r) => {
      const cells = [
        formatDate(r.invoiceDate),
        r.invoiceNo,
        r.customerName,
        r.description,
        formatINR(r.invoiceAmount),
        formatINR(r.outstanding),
        r.ageingDays > 0 ? `${r.ageingDays} days` : "Not due",
      ];
      return `<tr>${cells
        .map((c) => `<td style="padding:6px 10px;border-bottom:1px solid rgba(148,163,184,.25);font-size:12px;">${escapeHtml(String(c))}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return (
    `<table style="width:100%;border-collapse:collapse;margin:8px 0;">` +
    `<thead><tr>${theadCells}</tr></thead><tbody>${bodyRows}</tbody></table>` +
    `<p style="margin-top:6px;font-weight:600;">Total Outstanding Amount: ${escapeHtml(formatINR(totalOutstanding))}</p>`
  );
}
