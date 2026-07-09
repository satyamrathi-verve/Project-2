"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { StatusBadge } from "@/components/ui";
import { amountInWords } from "@/lib/numberInWords";
import type { Company, Customer, Invoice, InvoiceItem } from "@/lib/types";

/*
  Read-only, print-friendly view of one sales invoice. Reached from the Sales
  Invoice View screen via "Print Preview" -> "/invoices/<id>/print". This page
  never writes to the database — it only reads the invoice, its line items,
  the company row, the customer, and receipt allocations (to work out what's
  still outstanding).
*/

function formatMoney(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const buttonBase = "rounded-lg px-4 py-2 text-sm font-medium transition-colors";
const primaryButton = `${buttonBase} bg-brand text-white hover:bg-brand-dark`;
const secondaryButton = `${buttonBase} border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`;

interface PrintData {
  invoice: Invoice;
  customer: Customer | null;
  company: Company | null;
  items: InvoiceItem[];
  amountReceived: number;
}

export default function InvoicePrintPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: invoice, error: invoiceError } = await supabase!
        .from("invoices")
        .select("*")
        .eq("id", params.id)
        .maybeSingle();

      if (cancelled) return;

      if (invoiceError || !invoice) {
        setError(invoiceError?.message ?? "This invoice could not be found.");
        setLoading(false);
        return;
      }

      const [{ data: customer }, { data: company }, { data: items }, { data: allocations }] =
        await Promise.all([
          supabase!.from("customers").select("*").eq("id", invoice.customer_id).maybeSingle(),
          supabase!.from("company").select("*").limit(1).maybeSingle(),
          supabase!.from("invoice_items").select("*").eq("invoice_id", invoice.id),
          supabase!.from("receipt_allocations").select("amount").eq("invoice_id", invoice.id),
        ]);

      if (cancelled) return;

      const amountReceived = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0);

      setData({
        invoice,
        customer: customer ?? null,
        company: company ?? null,
        items: items ?? [],
        amountReceived,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (!isConfigured) {
    return <NotConfigured />;
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading invoice…</p>;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <p className="font-semibold">Couldn&apos;t load this invoice.</p>
        <p className="mt-1 text-sm">{error ?? "It may not exist."}</p>
        <Link href="/invoices" className="mt-4 inline-block text-sm font-medium underline">
          Back to Invoice List
        </Link>
      </div>
    );
  }

  const { invoice, customer, company, items, amountReceived } = data;
  const outstanding = Math.round((Number(invoice.total) - amountReceived) * 100) / 100;

  return (
    <div>
      {/* Screen-only action bar — hidden entirely on the printed page. */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/invoices" className={secondaryButton}>
          Back to Invoice List
        </Link>
        <div className="flex gap-2">
          <Link href={`/invoices/${invoice.id}/edit`} className={secondaryButton}>
            Edit Invoice
          </Link>
          <button onClick={() => window.print()} className={primaryButton}>
            Print
          </button>
        </div>
      </div>

      {/* The document itself. */}
      <div className="mx-auto max-w-[210mm] rounded-xl border border-slate-200 bg-white p-10 text-slate-800 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* Header: company + document meta */}
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-brand/10 text-xl font-bold text-brand">
              {(company?.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">{company?.name ?? "Company name not set"}</p>
              {company?.address && <p className="mt-0.5 max-w-xs text-sm text-slate-500">{company.address}</p>}
              {company?.gstin && <p className="mt-0.5 text-sm text-slate-500">GSTIN: {company.gstin}</p>}
              <p className="text-sm text-slate-500">
                {[company?.email, company?.phone].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand">Tax Invoice</p>
            <p className="mt-2 text-sm text-slate-500">
              Invoice No. <span className="font-medium text-slate-800">{invoice.invoice_no}</span>
            </p>
            <p className="text-sm text-slate-500">
              Invoice Date <span className="font-medium text-slate-800">{formatDate(invoice.invoice_date)}</span>
            </p>
            <p className="text-sm text-slate-500">
              Due Date <span className="font-medium text-slate-800">{formatDate(invoice.due_date)}</span>
            </p>
            <div className="mt-2 flex justify-end">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>

        {/* Bill to */}
        <div className="border-b border-slate-200 py-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
          {customer ? (
            <>
              <p className="mt-1 font-semibold text-slate-900">
                {customer.name} <span className="font-normal text-slate-400">({customer.code})</span>
              </p>
              {customer.address && <p className="mt-0.5 text-sm text-slate-600">{customer.address}</p>}
              <p className="mt-0.5 text-sm text-slate-600">
                {[customer.gstin && `GSTIN: ${customer.gstin}`, customer.pan && `PAN: ${customer.pan}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-sm text-slate-600">
                {[customer.contact_person, customer.email, customer.phone].filter(Boolean).join(" · ")}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Customer details not available.</p>
          )}
        </div>

        {/* Line items */}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-12 py-2">Sr.</th>
              <th className="py-2">Description</th>
              <th className="w-20 py-2 text-right">Qty</th>
              <th className="w-28 py-2 text-right">Rate</th>
              <th className="w-32 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  No line items on this invoice.
                </td>
              </tr>
            ) : (
              items.map((item, i) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-500">{i + 1}</td>
                  <td className="py-2 text-slate-800">{item.description}</td>
                  <td className="py-2 text-right text-slate-700">{item.qty}</td>
                  <td className="py-2 text-right text-slate-700">{formatMoney(Number(item.rate))}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{formatMoney(Number(item.amount))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Tax summary + amount summary */}
        <div className="mt-6 flex flex-col gap-6 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between">
          <div className="text-sm text-slate-500 sm:max-w-xs">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tax Summary</p>
            <div className="mt-2 flex justify-between">
              <span>Taxable Value</span>
              <span>{formatMoney(Number(invoice.subtotal))}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Total Tax</span>
              <span>{formatMoney(Number(invoice.tax_amount))}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              CGST/SGST/IGST breakup isn&apos;t tracked separately — shown as one combined tax amount.
            </p>
          </div>

          <div className="w-full text-sm sm:max-w-xs">
            <div className="flex justify-between py-1 text-slate-600">
              <span>Subtotal</span>
              <span>{formatMoney(Number(invoice.subtotal))}</span>
            </div>
            <div className="flex justify-between py-1 text-slate-600">
              <span>Tax Amount</span>
              <span>{formatMoney(Number(invoice.tax_amount))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-2 text-base font-bold text-slate-900">
              <span>Grand Total</span>
              <span>{formatMoney(Number(invoice.total))}</span>
            </div>
            <div className="flex justify-between py-1 text-slate-600">
              <span>Amount Received</span>
              <span>{formatMoney(amountReceived)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-2 text-base font-bold text-brand">
              <span>Amount Outstanding</span>
              <span>{formatMoney(Math.max(outstanding, 0))}</span>
            </div>
          </div>
        </div>

        {/* Amount in words */}
        <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">Amount in Words: </span>
          {amountInWords(Number(invoice.total))}
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="mt-4 text-sm text-slate-600">
            <span className="font-semibold text-slate-800">Notes: </span>
            {invoice.notes}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 flex items-end justify-between border-t border-slate-200 pt-6">
          <p className="text-xs text-slate-400">This is a system-generated invoice.</p>
          <div className="text-center text-sm text-slate-600">
            <p className="mb-8">For {company?.name ?? "the company"}</p>
            <p className="border-t border-slate-300 pt-1">Authorized Signatory</p>
          </div>
        </div>
      </div>
    </div>
  );
}
