"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import {
  Avatar,
  Card,
  ModeBadge,
  StatusBadge,
  Skeleton,
  IconArrowLeft,
  IconBanknote,
  IconReceipt,
  IconCalendar,
  inr,
} from "@/components/ui";

/*
  Screen 8 — Receipt Detail (/receipts/[id]).
  Read-only view of one receipt: information, allocation summary, activity
  timeline, and the invoices this receipt was allocated against.
*/

const EPS = 0.005;

interface AllocRow extends ReceiptAllocation {
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  invoice_total: number;
  invoice_status: Invoice["status"];
}

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!isConfigured || !supabase || !id) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data: r, error: e1 } = await supabase!.from("receipts").select("*").eq("id", id).maybeSingle();
      if (e1) {
        setError(e1.message);
        setLoading(false);
        return;
      }
      if (!r) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const rec = r as Receipt;
      setReceipt(rec);

      const [{ data: cust }, { data: aRows, error: e2 }] = await Promise.all([
        supabase!.from("customers").select("*").eq("id", rec.customer_id).maybeSingle(),
        supabase!.from("receipt_allocations").select("*").eq("receipt_id", id),
      ]);
      if (e2) {
        setError(e2.message);
        setLoading(false);
        return;
      }
      setCustomer((cust as Customer) ?? null);

      const allocations = (aRows as ReceiptAllocation[]) ?? [];
      const invIds = allocations.map((a) => a.invoice_id);
      const invMap = new Map<string, Invoice>();
      if (invIds.length) {
        const { data: invs } = await supabase!.from("invoices").select("*").in("id", invIds);
        for (const inv of (invs as Invoice[]) ?? []) invMap.set(inv.id, inv);
      }
      setAllocs(
        allocations.map((a) => {
          const inv = invMap.get(a.invoice_id);
          return {
            ...a,
            invoice_no: inv?.invoice_no ?? "—",
            invoice_date: inv?.invoice_date ?? "—",
            due_date: inv?.due_date ?? "—",
            invoice_total: inv ? Number(inv.total) : 0,
            invoice_status: inv?.status ?? "open",
          };
        })
      );
      setLoading(false);
    })();
  }, [id]);

  const backLink = (
    <Link
      href="/receipts"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      <IconArrowLeft className="h-4 w-4" />
      Back to receipts
    </Link>
  );

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Receipt" action={backLink} />
        <NotConfigured />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Receipt" action={backLink} />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card title="Receipt Information"><Skeleton className="h-40 w-full" /></Card>
            <Card title="Allocated Invoices"><Skeleton className="h-32 w-full" /></Card>
          </div>
          <Card title="Allocation Summary"><Skeleton className="h-48 w-full" /></Card>
        </div>
      </>
    );
  }

  if (notFound || !receipt) {
    return (
      <>
        <PageHeader title="Receipt not found" action={backLink} />
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          That receipt doesn&apos;t exist. It may have been removed.
        </div>
      </>
    );
  }

  const amount = Number(receipt.amount);
  const allocated = allocs.reduce((s, a) => s + Number(a.amount), 0);
  const unallocated = amount - allocated;
  const pct = amount > EPS ? Math.min(100, (allocated / amount) * 100) : 0;

  const columns: Column<AllocRow>[] = [
    { key: "invoice_no", header: "Invoice", render: (a) => <span className="font-semibold text-slate-900 dark:text-white">{a.invoice_no}</span> },
    { key: "invoice_date", header: "Invoice Date", render: (a) => <span className="text-slate-500 dark:text-slate-400">{a.invoice_date}</span> },
    { key: "due_date", header: "Due Date", render: (a) => <span className="text-slate-500 dark:text-slate-400">{a.due_date}</span> },
    { key: "invoice_status", header: "Status", render: (a) => <StatusBadge status={a.invoice_status} /> },
    { key: "invoice_total", header: "Invoice Amount", className: "text-right tabular-nums", render: (a) => inr(a.invoice_total) },
    { key: "amount", header: "Allocated", className: "text-right tabular-nums", render: (a) => <span className="font-semibold text-brand">{inr(Number(a.amount))}</span> },
  ];

  const info: { label: string; value: React.ReactNode }[] = [
    { label: "Receipt Date", value: receipt.receipt_date },
    { label: "Payment Mode", value: <ModeBadge mode={receipt.mode} /> },
    { label: "Reference", value: receipt.reference || <span className="text-slate-400">—</span> },
    { label: "Recorded", value: new Date(receipt.created_at).toLocaleString("en-IN") },
  ];

  return (
    <>
      <PageHeader
        title={receipt.receipt_no}
        subtitle="Receipt details and invoice allocations."
        action={backLink}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: info + allocations */}
        <div className="space-y-6 lg:col-span-2">
          <Card title="Receipt Information">
            <div className="mb-5 flex items-center gap-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <Avatar name={customer?.name ?? "?"} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900 dark:text-white">{customer?.name ?? "Unknown customer"}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {customer?.code}
                  {customer?.email ? ` · ${customer.email}` : ""}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {info.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{f.label}</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Allocated Invoices" subtitle={`${allocs.length} invoice${allocs.length === 1 ? "" : "s"} settled by this receipt`} bodyClassName="p-4">
            <DataTable columns={columns} rows={allocs} empty="This receipt hasn't been allocated to any invoice." />
          </Card>
        </div>

        {/* Right: summary + timeline */}
        <div className="space-y-6">
          <Card title="Allocation Summary">
            <div className="rounded-xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white">
              <p className="text-xs font-medium uppercase tracking-wide text-white/70">Receipt Amount</p>
              <p className="mt-1 text-3xl font-bold tracking-tight">{inr(amount)}</p>
            </div>
            <dl className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-slate-500 dark:text-slate-400">Allocated</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{inr(allocated)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-slate-500 dark:text-slate-400">Unallocated (on account)</dt>
                <dd className={`text-sm font-semibold tabular-nums ${unallocated > EPS ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"}`}>{inr(Math.max(0, unallocated))}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>Allocated</span>
                <span>{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </Card>

          <Card title="Activity">
            <ol className="relative space-y-5 border-l border-slate-200 pl-6 dark:border-slate-800">
              <li className="relative">
                <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-brand ring-4 ring-white dark:bg-brand/20 dark:text-blue-300 dark:ring-slate-900">
                  <IconReceipt className="h-3 w-3" />
                </span>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Receipt recorded</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(receipt.created_at).toLocaleString("en-IN")}</p>
              </li>
              <li className="relative">
                <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-4 ring-white dark:bg-emerald-500/20 dark:text-emerald-400 dark:ring-slate-900">
                  <IconBanknote className="h-3 w-3" />
                </span>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {inr(amount)} received via {receipt.mode.toUpperCase()}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{receipt.receipt_date}</p>
              </li>
              <li className="relative">
                <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-600 ring-4 ring-white dark:bg-violet-500/20 dark:text-violet-400 dark:ring-slate-900">
                  <IconCalendar className="h-3 w-3" />
                </span>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Allocated across {allocs.length} invoice{allocs.length === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {allocs.map((a) => a.invoice_no).join(", ") || "no allocations"}
                </p>
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
