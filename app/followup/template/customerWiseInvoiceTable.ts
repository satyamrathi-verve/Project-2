/*
  Customer Wise reminders replace the single-invoice {invoice_no}/{amount}
  tokens with one auto-built table of everything that customer owes, plus
  totals underneath. The table rows come straight from the AR Ageing
  module's own InvoiceRow shape (app/reports/ageing/analytics.ts) — this file
  does not recompute outstanding/ageing itself, it only picks the rows for one
  customer, attaches each invoice's service description, and renders the
  {invoice_table} block as HTML for the live preview.
*/
import type { InvoiceRow } from "@/app/reports/ageing/analytics";
import { formatDate, formatINR } from "@/app/reports/ageing/analytics";

export interface CustomerWiseInvoiceRow {
  invoiceDate: string;
  invoiceNo: string;
  customerName: string;
  description: string;
  invoiceAmount: number;
  pendingAmount: number;
  daysOverdue: number;
}

// Only invoices still owed by the customer belong in the reminder table —
// paid-off invoices have nothing to chase. Oldest/most-overdue first, since
// that's what the customer should act on first.
export function buildCustomerWiseRows(
  invoiceRows: InvoiceRow[],
  descriptionByInvoiceId: Record<string, string>
): CustomerWiseInvoiceRow[] {
  return invoiceRows
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => b.ageingDays - a.ageingDays)
    .map((r) => ({
      invoiceDate: r.invoiceDate,
      invoiceNo: r.invoiceNo,
      customerName: r.customerName,
      description: descriptionByInvoiceId[r.id] ?? "—",
      invoiceAmount: r.invoiceAmount,
      pendingAmount: r.outstanding,
      daysOverdue: Math.max(0, r.ageingDays),
    }));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Renders the table + the two totals lines below it, as one HTML block —
// this whole block is what {invoice_table} expands to in the preview.
export function renderInvoiceTableHtml(rows: CustomerWiseInvoiceRow[]): string {
  if (rows.length === 0) {
    return `<p style="margin:8px 0;color:#64748b;font-size:13px;">No outstanding invoices found for this customer.</p>`;
  }

  const totalOutstanding = rows.reduce((sum, r) => sum + r.pendingAmount, 0);
  const totalInvoices = rows.length;

  const headerCells = [
    "Invoice Date",
    "Invoice No.",
    "Customer Name",
    "Description of Service",
    "Invoice Amount",
    "Pending Amount",
    "Days Overdue",
  ]
    .map(
      (h) =>
        `<th style="border:1px solid #e2e8f0;padding:6px 10px;background:#f8fafc;text-align:left;font-size:12px;color:#475569;">${h}</th>`
    )
    .join("");

  const bodyRows = rows
    .map((r) => {
      const cells = [
        formatDate(r.invoiceDate),
        escapeHtml(r.invoiceNo),
        escapeHtml(r.customerName),
        escapeHtml(r.description),
        formatINR(r.invoiceAmount),
        formatINR(r.pendingAmount),
        String(r.daysOverdue),
      ];
      return `<tr>${cells
        .map((c) => `<td style="border:1px solid #e2e8f0;padding:6px 10px;font-size:12px;color:#334155;">${c}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return `
<table style="border-collapse:collapse;width:100%;margin:8px 0;">
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
<p style="margin:10px 0 0;font-size:13px;color:#334155;"><strong>Total Outstanding Amount:</strong> ${formatINR(
    totalOutstanding
  )}</p>
<p style="margin:2px 0 0;font-size:13px;color:#334155;"><strong>Total Outstanding Invoices:</strong> ${totalInvoices}</p>`;
}
