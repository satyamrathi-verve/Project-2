import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable } from "@/components/DataTable";
import type { Customer, Invoice, InvoiceItem, Receipt, ReceiptAllocation } from "@/lib/types";

// Always hit Supabase fresh — outstanding balances change as receipts come in.
export const dynamic = "force-dynamic";

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
const secondaryButton = `${buttonBase} border border-slate-300 text-slate-700 hover:bg-slate-100`;

function Badge({ label, tone }: { label: string; tone: "green" | "amber" | "slate" | "red" }) {
  const tones: Record<typeof tone, string> = {
    green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {label}
    </span>
  );
}

export default async function InvoiceViewPage({ params }: { params: { id: string } }) {
  if (!isConfigured || !supabase) {
    return (
      <>
        <PageHeader title="Invoice" />
        <NotConfigured />
      </>
    );
  }

  // One query: the invoice plus its customer, line items, and receipt allocations
  // (with each allocation's parent receipt), using Supabase's relationship embedding.
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "*, customer:customers(*), invoice_items(*), receipt_allocations(*, receipt:receipts(*))"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    return (
      <>
        <PageHeader title="Invoice" />
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Couldn&apos;t load this invoice.</p>
          <p className="mt-1 text-sm">{error.message}</p>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader
          title="Invoice not found"
          subtitle={`No invoice matches id ${params.id}.`}
          action={
            <Link href="/invoices" className={secondaryButton}>
              Back to Invoice List
            </Link>
          }
        />
      </>
    );
  }

  const invoice = data as InvoiceDetail;
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
      <div className="mb-6 flex flex-wrap items-center gap-6 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoice Date</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(invoice.invoice_date)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Due Date</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(invoice.due_date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={paymentLabel} tone={paymentTone} />
          {isOverdue && <Badge label="Overdue" tone="red" />}
          {isPaid && <Badge label="Fully Paid" tone="green" />}
        </div>
      </div>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {/* Customer details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Customer</h3>
          {customer ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Code</dt>
                <dd className="font-medium text-slate-800">{customer.code}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium text-slate-800">{customer.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">GSTIN</dt>
                <dd className="font-medium text-slate-800">{customer.gstin ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PAN</dt>
                <dd className="font-medium text-slate-800">{customer.pan ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Contact Person</dt>
                <dd className="font-medium text-slate-800">{customer.contact_person ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Email</dt>
                <dd className="font-medium text-slate-800">{customer.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Phone</dt>
                <dd className="font-medium text-slate-800">{customer.phone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Address</dt>
                <dd className="text-right font-medium text-slate-800">{customer.address ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Customer record not found.</p>
          )}
        </div>

        {/* Invoice details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Invoice Details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Invoice No.</dt>
              <dd className="font-medium text-slate-800">{invoice.invoice_no}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Invoice Date</dt>
              <dd className="font-medium text-slate-800">{formatDate(invoice.invoice_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Due Date</dt>
              <dd className="font-medium text-slate-800">{formatDate(invoice.due_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Days Overdue</dt>
              <dd className="font-medium text-slate-800">{ageingText}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Narration</dt>
              <dd className="text-right font-medium text-slate-800">{invoice.notes ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Line items */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Line Items</h3>
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
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Amount Summary</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="font-medium text-slate-800">{formatMoney(Number(invoice.subtotal))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Tax Amount</dt>
              <dd className="font-medium text-slate-800">{formatMoney(Number(invoice.tax_amount))}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-2">
              <dt className="font-semibold text-slate-700">Invoice Total</dt>
              <dd className="font-semibold text-slate-900">{formatMoney(Number(invoice.total))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Amount Received</dt>
              <dd className="font-medium text-slate-800">{formatMoney(amountReceived)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-100 pt-2">
              <dt className="text-base font-bold text-slate-900">Amount Outstanding</dt>
              <dd className={`text-base font-bold ${isPaid ? "text-green-600" : "text-brand-dark"}`}>
                {formatMoney(Math.max(outstanding, 0))}
              </dd>
            </div>
            {isPaid && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-700">
                ✓ Fully Paid
              </p>
            )}
          </dl>
        </div>

        {/* Due / ageing info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Due / Ageing Information</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Due Date</dt>
              <dd className="font-medium text-slate-800">{formatDate(invoice.due_date)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Days Due / Overdue</dt>
              <dd className="font-medium text-slate-800">{ageingText}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge label={paymentLabel} tone={paymentTone} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Receipt / payment allocation */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
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
