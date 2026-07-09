import type { Company, Customer } from "@/lib/types";
import {
  formatDate,
  formatDateTime,
  type CustomerFinancials,
  type LedgerRow,
  type OverdueInvoiceRow,
} from "@/lib/statement";
import { VerveLogo } from "./VerveLogo";

/*
  The customer-facing document. Structurally and visually independent from
  the screen view on purpose — this is what actually gets emailed/printed,
  so it reads like a bank/SAP/Tally statement, not a screenshot of the app.
  Rendered off-screen (hidden except under @media print) by the page, so it
  never has to fight the app shell's sidebar/theme for space.

  Multi-page correctness relies entirely on plain HTML table semantics +
  print CSS (see .statement-print rules in app/globals.css): a real <thead>
  repeats on every printed page, a real <tfoot> pins the closing balance to
  the last page, and every <tr> gets page-break-inside: avoid so a
  transaction never splits across a page boundary. No pagination JS needed.
*/

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

export function StatementPrintView({
  company,
  customer,
  periodLabel,
  generatedAt,
  rows,
  totalDebit,
  totalCredit,
  closingBalance,
  financials,
  overdueInvoices,
}: {
  company: Company | null;
  customer: Customer;
  periodLabel: string;
  generatedAt: Date;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  financials: CustomerFinancials;
  overdueInvoices: OverdueInvoiceRow[];
}) {
  return (
    <div className="statement-print bg-white text-slate-900">
      {/* ---- page header: letterhead + statement meta ---- */}
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div className="flex gap-4">
          <VerveLogo />
          <div className="border-l border-slate-300 pl-4 text-[10px] leading-relaxed text-slate-600">
            <p className="text-sm font-bold text-slate-900">{company?.name ?? "Company name not set"}</p>
            {company?.address && <p className="max-w-[60mm]">{company.address}</p>}
            {company?.gstin && <p>GSTIN: {company.gstin}</p>}
            <p>{[company?.email, company?.phone].filter(Boolean).join("  ·  ")}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase tracking-wide text-slate-900">Customer Statement</p>
          <p className="mt-1 text-[10px] text-slate-500">
            Statement Period: <span className="font-medium text-slate-800">{periodLabel}</span>
          </p>
          <p className="text-[10px] text-slate-500">
            Generated: <span className="font-medium text-slate-800">{formatDateTime(generatedAt)}</span>
          </p>
        </div>
      </div>

      {/* ---- customer information block ---- */}
      <div className="mt-5 grid grid-cols-2 gap-8 text-[11px]">
        <div>
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">Statement To</p>
          <p className="text-[13px] font-bold text-slate-900">{customer.name}</p>
          <p className="text-slate-600">Customer Code: {customer.code}</p>
          {customer.address && <p className="mt-1 max-w-[85mm] text-slate-600">{customer.address}</p>}
          {customer.gstin && <p className="text-slate-600">GSTIN: {customer.gstin}</p>}
          {customer.pan && <p className="text-slate-600">PAN: {customer.pan}</p>}
        </div>
        <div>
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">Account Details</p>
          {customer.contact_person && <p className="text-slate-600">Contact: {customer.contact_person}</p>}
          {customer.email && <p className="text-slate-600">Email: {customer.email}</p>}
          {customer.phone && <p className="text-slate-600">Phone: {customer.phone}</p>}
          <p className="text-slate-600">Credit Terms: {customer.credit_days} days</p>
          <p className="text-slate-600">Credit Limit: {inr(customer.credit_limit)}</p>
        </div>
      </div>

      {/* ---- account summary (grey, no colour) ---- */}
      <table className="mt-5 w-full border-collapse text-[11px]">
        <tbody>
          <tr className="bg-slate-100">
            <td className="border border-slate-300 px-3 py-1.5 font-bold" colSpan={2}>
              Account Summary
            </td>
          </tr>
          {[
            ["Opening Balance", rows.find((r) => r.type === "Opening")?.balance ?? 0],
            ["Total Invoices", totalDebit],
            ["Total Receipts", totalCredit],
            ["Closing Balance", closingBalance],
            ["Overdue Amount", financials.overdueAmount],
          ].map(([label, amount]) => (
            <tr key={label as string}>
              <td className="border border-slate-300 bg-slate-50 px-3 py-1.5 text-slate-700">{label}</td>
              <td className="border border-slate-300 px-3 py-1.5 text-right tabular-nums text-slate-900">
                {inr(amount as number)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- the ledger itself ---- */}
      <table className="mt-6 w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Date</th>
            <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Doc No</th>
            <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Type</th>
            <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Description</th>
            <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Debit</th>
            <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Credit</th>
            <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.type === "Opening" ? "bg-slate-50 font-semibold" : undefined}>
              <td className="border border-slate-300 px-2 py-1.5">{r.date ? formatDate(r.date) : ""}</td>
              <td className="border border-slate-300 px-2 py-1.5">{r.docNo || "—"}</td>
              <td className="border border-slate-300 px-2 py-1.5">{r.type}</td>
              <td className="border border-slate-300 px-2 py-1.5">{r.description}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{r.debit ? inr(r.debit) : ""}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{r.credit ? inr(r.credit) : ""}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{inr(r.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold">
            <td className="border border-slate-300 px-2 py-2" colSpan={4}>
              Closing Balance
            </td>
            <td className="border border-slate-300 px-2 py-2 text-right tabular-nums">{inr(totalDebit)}</td>
            <td className="border border-slate-300 px-2 py-2 text-right tabular-nums">{inr(totalCredit)}</td>
            <td className="border border-slate-300 px-2 py-2 text-right tabular-nums">{inr(closingBalance)}</td>
          </tr>
        </tfoot>
      </table>

      {/* ---- overdue invoices — helps the collections team action this statement ---- */}
      {overdueInvoices.length > 0 && (
        <div className="statement-avoid-break mt-8">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-800">Overdue Invoices</p>
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Invoice No</th>
                <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Invoice Date</th>
                <th className="border border-slate-800 px-2 py-1.5 text-left font-semibold">Due Date</th>
                <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Days Overdue</th>
                <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Invoice Amount</th>
                <th className="border border-slate-800 px-2 py-1.5 text-right font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {overdueInvoices.map((r) => (
                <tr key={r.id}>
                  <td className="border border-slate-300 px-2 py-1.5">{r.invoiceNo}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{formatDate(r.invoiceDate)}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{formatDate(r.dueDate)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums font-semibold text-red-700">
                    {r.daysOverdue}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{inr(r.invoiceAmount)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums font-semibold">
                    {inr(r.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- footer ---- */}
      <div className="statement-avoid-break mt-10 border-t border-slate-300 pt-3 text-[9px] text-slate-500">
        <p>This statement was generated electronically and does not require a signature.</p>
        <div className="mt-1 flex justify-between">
          <span>Generated on: {formatDateTime(generatedAt)}</span>
          <span>
            {[company?.email, company?.phone].filter(Boolean).join("  ·  ") || (company?.name ?? "")}
          </span>
        </div>
      </div>
    </div>
  );
}
