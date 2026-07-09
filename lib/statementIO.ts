import * as XLSX from "xlsx";
import type { Customer } from "@/lib/types";
import { formatDate, todayStr, type LedgerRow } from "@/lib/statement";

/*
  Export + simulated-email helpers for Customer Statement. No Supabase calls
  live here (same separation as lib/customerIO.ts) — the page does the actual
  reminder_log insert; this file only builds the email text and the workbook.
*/

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportStatementXlsx(customer: Customer, rows: LedgerRow[], closingBalance: number, filename: string) {
  const header = ["Date", "Document Type", "Document No", "Description", "Debit", "Credit", "Balance"];
  const body = rows.map((r) => [
    r.date ? formatDate(r.date) : "",
    r.type,
    r.docNo,
    r.description,
    r.debit || "",
    r.credit || "",
    r.balance,
  ]);
  const title = [`Customer Statement — ${customer.name} (${customer.code})`];
  const footer = ["", "", "", "Closing Balance", "", "", closingBalance];

  const ws = XLSX.utils.aoa_to_sheet([title, [], header, ...body, footer]);
  ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Statement");
  XLSX.writeFile(wb, filename);
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

/**
 * Plain-text email body a Statement would actually be sent with — the page
 * inserts this into reminder_log (status "sent") the same way Auto Email
 * Shoot simulates sending, since this app has no real mailbox.
 */
export function buildStatementEmail(customer: Customer, closingBalance: number, overdueAmount: number, periodLabel: string) {
  const subject = `Statement of Account — ${customer.name} (${periodLabel})`;
  const body = [
    `Dear ${customer.contact_person || customer.name},`,
    "",
    `Please find below your account statement for ${periodLabel}.`,
    "",
    `Closing Balance: ${inr(closingBalance)}`,
    overdueAmount > 0 ? `Overdue Amount: ${inr(overdueAmount)}` : "No overdue amount on this account.",
    "",
    "A detailed transaction ledger is attached as a PDF.",
    "",
    "Please contact us if you have any questions regarding this statement.",
    "",
    "Regards,",
    "Accounts Receivable Team",
  ].join("\n");
  return { to: customer.email ?? "", subject, body, sentAtLabel: todayStr() };
}
