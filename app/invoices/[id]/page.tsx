"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable } from "@/components/DataTable";
import type { Customer, Invoice, InvoiceItem, Receipt, ReceiptAllocation } from "@/lib/types";

type AllocationWithReceipt = ReceiptAllocation & { receipt: Receipt | null };
type InvoiceDetail = Invoice & {
  customer: Customer | null;
  invoice_items: InvoiceItem[];
  receipt_allocations: AllocationWithReceipt[];
};

function formatMoney(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const buttonBase = "rounded-lg px-4 py-2 text-sm font-medium transition-colors";
const primaryButton = `${buttonBase} bg-brand text-white hover:bg-brand-dark`;
const secondaryButton = `${buttonBase} border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`;

function Badge({ label, tone }: { label: string; tone: "green" | "amber" | "slate" | "red" }) {
  const tones: Record<typeof tone, string> = {
    green: "bg-green-100 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300",
    red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {label}
    </span>
  );
}

export default function InvoiceViewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase || !id) {
      setLoading(false);
      return;
    }
    (async () => {
      // One query: the invoice plus its customer, line items, and receipt allocations
      // (with each allocation's parent receipt), using Supabase relationship embedding.
      const { data, error } = await supabase!
        .from("invoices")
        .select("*, customer:customers(*), invoice_items(*), receipt_allocations(*, receipt:receipts(*))")
        .eq("id", id)
        .maybeSingle();
      if (error) setError(error.message);
      else setData((data as InvoiceDetail | null) ?? null);
      setLoading(false);
    })();
  }, [id]);

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Invoice" />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Loading invoice…
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-semibold">Couldn&apos;t load this invoice.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="Invoice not found"
          subtitle={`No invoice matches id ${id}.`}
          action={
            <Link href="/invoices" className={secondaryButton}>
              Back to Invoice List
            </Link>
          }
        />
      </>
    );
  }

  const invoice = data;
  const customer = invoice.customer;
  const items = invoice.invoice_items ?? [];
  const allocations = invoice.receipt_allocations ?? [];

  const amountReceived = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
  const outstanding = Math.round((Number(invoice.total) - amountReceived) * 100) / 100;
  const isPaid = outstanding <= 0.005;
  const isPartlyPaid = !isPaid && amountReceived > 0.005;
  const paymentLabel = isPaid ? "Paid" : isPartlyPaid ? "Partly Paid" : "Unpaid";
  const paymentTone = isPaid ? "green" : isPartlyPaid ? "amber" : "slate";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(invoice.due_date);
  dueDate.setHours(0, 0, 0, 0);
  const daysDiff = Math.round((today.getTime() - dueDate.getTime()) / 86400000);
  const isOverdue = !isPaid && daysDiff > 0;

  let ageingText: string;
  if (isPaid) {
    ageingText = "Not applicable — invoice is fully paid";
  } else if (daysDiff > 0) {
    ageingText = `${daysDiff} day${daysDiff === 1 ? "" : "s"} overdue`;
  } else if (daysDiff === 0) {
    ageingText = "Due today";
  } else {
    ageingText = `Due in ${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? "" : "s"}`;
  }

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.invoice_no}`}
        subtitle={customer ? customer.name : "Customer not found"}
        action={
          <div className="flex gap-2">
            <Link href="/invoices" className={secondaryButton}>
              Back to Invoice List
            </Link>
            <Link href={`/invoices/${invoice.id}/edit`} className={secondaryButton}>
              Edit Invoice
            </Link>
            <Link href={`/invoices/${invoice.id}/print`} className={primaryButton}>
              Print Preview
            </Link>
          </div>
        }
      />

      {/* Top strip: the key facts at a glance, plus payment/overdue badges. */}
      <div className="mb-6 flex flex-wrap items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Date</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatDate(invoice.invoice_date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Due Date</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatDate(invoice.due_date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={paymentLabel} tone={paymentTone} />
          {isOverdue && <Badge label="Overdue" tone="red" />}
          {isPaid && <Badge label="Fully Paid" tone="green" />}
        </div>
      </div>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {/* Customer details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</h3>
          {customer ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Code</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.code}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">GSTIN</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.gstin ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">PAN</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.pan ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Contact Person</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.contact_person ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Email</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-200">{customer.phone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Address</dt>
                <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{customer.address ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">Customer record not found.</p>
          )}
        </div>

        {/* Invoice details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Invoice No.</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{invoice.invoice_no}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Invoice Date</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Due Date</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatDate(invoice.due_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Days Overdue</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{ageingText}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Narration</dt>
              <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{invoice.notes ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Line items */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Line Items</h3>
        <DataTable<InvoiceItem>
          columns={[
            { key: "description", header: "Description" },
            { key: "qty", header: "Qty", className: "text-right" },
            {
              key: "rate",
              header: "Rate",
              className: "text-right",
              render: (row) => formatMoney(Number(row.rate)),
            },
            {
              key: "amount",
              header: "Amount",
              className: "text-right",
              render: (row) => formatMoney(Number(row.amount)),
            },
          ]}
          rows={items}
          empty="No line items on this invoice."
        />
      </div>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {/* Amount summary */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount Summary</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatMoney(Number(invoice.subtotal))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Tax Amount</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatMoney(Number(invoice.tax_amount))}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
              <dt className="font-semibold text-slate-700 dark:text-slate-300">Invoice Total</dt>
              <dd className="font-semibold text-slate-900 dark:text-white">{formatMoney(Number(invoice.total))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Amount Received</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatMoney(amountReceived)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
              <dt className="text-base font-bold text-slate-900 dark:text-white">Amount Outstanding</dt>
              <dd className={`text-base font-bold ${isPaid ? "text-green-600 dark:text-emerald-400" : "text-brand-dark dark:text-blue-300"}`}>
                {formatMoney(Math.max(outstanding, 0))}
              </dd>
            </div>
            {isPaid && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                ✓ Fully Paid
              </p>
            )}
          </dl>
        </div>

        {/* Due / ageing info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due / Ageing Information</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Due Date</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{formatDate(invoice.due_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Days Due / Overdue</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{ageingText}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Status</dt>
              <dd>
                <Badge label={paymentLabel} tone={paymentTone} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Receipt / payment allocation */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Receipt / Payment Allocation
        </h3>
        <DataTable<AllocationWithReceipt>
          columns={[
            {
              key: "receipt_date",
              header: "Receipt Date",
              render: (row) => (row.receipt ? formatDate(row.receipt.receipt_date) : "—"),
            },
            {
              key: "receipt_no",
              header: "Receipt No.",
              render: (row) => row.receipt?.receipt_no ?? "—",
            },
            {
              key: "receipt_amount",
              header: "Receipt Amount",
              className: "text-right",
              render: (row) => (row.receipt ? formatMoney(Number(row.receipt.amount)) : "—"),
            },
            {
              key: "amount",
              header: "Allocated Amount",
              className: "text-right",
              render: (row) => formatMoney(Number(row.amount)),
            },
            {
              key: "mode",
              header: "Payment Mode",
              render: (row) => (row.receipt ? row.receipt.mode.toUpperCase() : "—"),
            },
          ]}
          rows={allocations}
          empty="No receipts have been allocated to this invoice yet."
        />
      </div>
    </>
  );
}
