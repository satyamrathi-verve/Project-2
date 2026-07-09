"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, ReceiptMode } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { Avatar, Card, IconArrowLeft, StatusBadge, inr } from "@/components/ui";

/*
  Screen 8 — Create Receipt.
  Record money received from a customer and knock it off their open invoices.

  This build does REAL reads (customers + their open invoices, with outstanding
  computed from receipt_allocations) but does NOT save yet — persistence to
  Supabase is wired in the next step. All allocation maths happens on the client.

  NOTE: business logic, validations, allocation maths and Supabase queries below
  are unchanged from the original build — only the layout/presentation is new.
*/

const MODES: { value: ReceiptMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "upi", label: "UPI" },
  { value: "neft", label: "NEFT" },
];

// An open invoice with its live outstanding (total − already-allocated).
interface OpenInvoice extends Invoice {
  outstanding: number;
}

const EPS = 0.005; // money tolerance (amounts are 2-decimal)

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function CreateReceiptPage() {
  // ---- form state ----------------------------------------------------------
  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");

  // ---- data state ----------------------------------------------------------
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPreview, setSavedPreview] = useState<string | null>(null);

  // ---- load customers + suggest next receipt no ---------------------------
  useEffect(() => {
    if (!isConfigured || !supabase) return;
    (async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) {
        setError(error.message);
        return;
      }
      setCustomers((data as Customer[]) ?? []);

      const { data: last } = await supabase
        .from("receipts")
        .select("receipt_no")
        .order("receipt_no", { ascending: false })
        .limit(1);
      const prev = last?.[0]?.receipt_no as string | undefined;
      const n = prev ? parseInt(prev.match(/(\d+)\s*$/)?.[1] ?? "0", 10) + 1 : 1;
      setReceiptNo(`RCP-${String(n).padStart(4, "0")}`);
    })();
  }, []);

  // ---- load open invoices when a customer is picked -----------------------
  useEffect(() => {
    setSavedPreview(null);
    if (!customerId || !isConfigured || !supabase) {
      setInvoices([]);
      setAlloc({});
      return;
    }
    (async () => {
      setLoadingInvoices(true);
      setError(null);
      // Unpaid = anything not fully paid.
      const { data: invs, error: e1 } = await supabase!
        .from("invoices")
        .select("*")
        .eq("customer_id", customerId)
        .neq("status", "paid")
        .order("due_date", { ascending: true });
      if (e1) {
        setError(e1.message);
        setLoadingInvoices(false);
        return;
      }
      const rows = (invs as Invoice[]) ?? [];
      const ids = rows.map((r) => r.id);

      // Sum existing allocations per invoice to get real outstanding.
      const paid: Record<string, number> = {};
      if (ids.length) {
        const { data: allocs, error: e2 } = await supabase!
          .from("receipt_allocations")
          .select("invoice_id, amount")
          .in("invoice_id", ids);
        if (e2) {
          setError(e2.message);
          setLoadingInvoices(false);
          return;
        }
        for (const a of (allocs as { invoice_id: string; amount: number }[]) ?? []) {
          paid[a.invoice_id] = (paid[a.invoice_id] ?? 0) + Number(a.amount);
        }
      }

      const open: OpenInvoice[] = rows
        .map((r) => ({ ...r, outstanding: Number(r.total) - (paid[r.id] ?? 0) }))
        .filter((r) => r.outstanding > EPS);

      setInvoices(open);
      setAlloc({});
      setLoadingInvoices(false);
    })();
  }, [customerId]);

  // ---- derived totals ------------------------------------------------------
  const receiptAmount = num(amount);
  const totalAllocated = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + num(v), 0),
    [alloc]
  );
  const unallocated = receiptAmount - totalAllocated;

  const rowInvalid = (inv: OpenInvoice) => num(alloc[inv.id] ?? "") > inv.outstanding + EPS;
  const anyRowInvalid = invoices.some(rowInvalid);
  const overAllocated = totalAllocated > receiptAmount + EPS;

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const canSave =
    !!customerId &&
    receiptNo.trim() !== "" &&
    receiptAmount > EPS &&
    totalAllocated > EPS &&
    !anyRowInvalid &&
    !overAllocated;

  // ---- allocation helpers --------------------------------------------------
  const setRow = (id: string, val: string) => {
    setSavedPreview(null);
    setAlloc((a) => ({ ...a, [id]: val }));
  };

  const autoAllocate = () => {
    setSavedPreview(null);
    let left = receiptAmount;
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      if (left <= EPS) break;
      const give = Math.min(inv.outstanding, left);
      next[inv.id] = give.toFixed(2);
      left -= give;
    }
    setAlloc(next);
  };

  const clearAlloc = () => {
    setSavedPreview(null);
    setAlloc({});
  };

  const handleSave = () => {
    // Persistence is wired in the next step. For now, show exactly what WOULD
    // be written so the allocation logic can be verified end-to-end.
    const lines = invoices
      .filter((inv) => num(alloc[inv.id] ?? "") > EPS)
      .map((inv) => `  ${inv.invoice_no}: ${inr(num(alloc[inv.id]!))}`);
    setSavedPreview(
      [
        `receipts row  → ${receiptNo} · ${receiptDate} · ${selectedCustomer?.name} · ${inr(receiptAmount)} · ${mode}${reference ? " · " + reference : ""}`,
        `receipt_allocations (${lines.length}):`,
        ...lines,
        unallocated > EPS ? `on-account (unallocated): ${inr(unallocated)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  };

  // ---- allocation table columns -------------------------------------------
  const columns: Column<OpenInvoice>[] = [
    { key: "invoice_no", header: "Invoice", render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.invoice_no}</span> },
    { key: "invoice_date", header: "Invoice Date", render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.invoice_date}</span> },
    {
      key: "due_date",
      header: "Due / Status",
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">{r.due_date}</span>
          <StatusBadge status={r.status} />
        </span>
      ),
    },
    { key: "total", header: "Invoice Amount", className: "text-right tabular-nums", render: (r) => inr(Number(r.total)) },
    { key: "outstanding", header: "Outstanding", className: "text-right tabular-nums", render: (r) => <span className="font-semibold text-slate-900 dark:text-white">{inr(r.outstanding)}</span> },
    {
      key: "allocate",
      header: "Allocate",
      className: "text-right",
      render: (r) => {
        const bad = rowInvalid(r);
        return (
          <div className="flex flex-col items-end gap-0.5">
            <input
              type="number"
              min={0}
              step="0.01"
              value={alloc[r.id] ?? ""}
              onChange={(e) => setRow(r.id, e.target.value)}
              placeholder="0.00"
              className={`${inputClass} w-32 text-right tabular-nums transition-colors ${bad ? "border-red-400 focus:border-red-500 focus:ring-red-500" : ""}`}
            />
            {bad && <span className="text-[11px] font-medium text-red-600">max {inr(r.outstanding)}</span>}
          </div>
        );
      },
    },
  ];

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
        <PageHeader title="New Receipt" subtitle="Record money received and knock it off open invoices." action={backLink} />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New Receipt"
        subtitle="Record money received and allocate it against a customer's open invoices."
        action={backLink}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: form + invoices */}
        <div className="space-y-6 lg:col-span-2">
          <Card title="Receipt Details" subtitle="Who paid, how much, and how.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Receipt Number">
                <input className={inputClass} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="RCP-0001" />
              </FormField>
              <FormField label="Receipt Date">
                <input type="date" className={inputClass} value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </FormField>
              <FormField label="Customer">
                <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Amount">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  value={amount}
                  onChange={(e) => {
                    setSavedPreview(null);
                    setAmount(e.target.value);
                  }}
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="Payment Mode">
                <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reference Number">
                <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / UPI / txn ref" />
              </FormField>
            </div>
          </Card>

          <Card
            title="Open Invoices"
            subtitle={
              selectedCustomer
                ? `Unpaid invoices for ${selectedCustomer.name} — enter how much of this receipt settles each.`
                : "Pick a customer above to load their open invoices."
            }
            action={
              invoices.length > 0 ? (
                <div className="flex gap-2">
                  <button
                    onClick={autoAllocate}
                    disabled={receiptAmount <= EPS}
                    className="rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Auto-allocate
                  </button>
                  <button
                    onClick={clearAlloc}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Clear
                  </button>
                </div>
              ) : undefined
            }
            bodyClassName="p-0"
          >
            {loadingInvoices ? (
              <div className="px-6 py-14 text-center text-slate-400 dark:text-slate-500">Loading invoices…</div>
            ) : (
              <div className="p-4">
                <DataTable
                  columns={columns}
                  rows={invoices}
                  empty={selectedCustomer ? "No open invoices — this customer is all settled." : "No customer selected yet."}
                />
              </div>
            )}
          </Card>
        </div>

        {/* Right column: sticky allocation summary */}
        <aside className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-6">
            <Card title="Allocation Summary">
              {selectedCustomer && (
                <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <Avatar name={selectedCustomer.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedCustomer.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{selectedCustomer.code}</p>
                  </div>
                </div>
              )}

              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500 dark:text-slate-400">Total Receipt Amount</dt>
                  <dd className="text-base font-bold tabular-nums text-slate-900 dark:text-white">{inr(receiptAmount)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500 dark:text-slate-400">Total Allocated</dt>
                  <dd className={`text-base font-bold tabular-nums ${overAllocated ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>{inr(totalAllocated)}</dd>
                </div>
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
                <div className="flex items-center justify-between">
                  <dt className="text-sm font-medium text-slate-600 dark:text-slate-300">Unallocated Balance</dt>
                  <dd className={`text-lg font-bold tabular-nums ${unallocated < -EPS ? "text-red-600" : "text-brand"}`}>{inr(unallocated)}</dd>
                </div>
              </dl>

              {/* allocation progress */}
              {receiptAmount > EPS && (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${overAllocated ? "bg-red-500" : "bg-brand"}`}
                      style={{ width: `${Math.min(100, (totalAllocated / receiptAmount) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* validation */}
              {(overAllocated || anyRowInvalid) && (
                <div className="mt-4 space-y-1.5">
                  {overAllocated && (
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">
                      Allocated exceeds receipt by {inr(totalAllocated - receiptAmount)}.
                    </p>
                  )}
                  {anyRowInvalid && (
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">An allocation exceeds an invoice&apos;s outstanding.</p>
                  )}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={!canSave}
                className="mt-5 w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save receipt
              </button>
              <p className="mt-2 text-center text-[11px] text-amber-600 dark:text-amber-400">
                Preview only — saving to Supabase is wired in the next step.
              </p>

              {savedPreview && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <p className="mb-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">✓ Allocations valid — this is what will be written:</p>
                  <pre className="whitespace-pre-wrap break-words text-xs text-emerald-900 dark:text-emerald-200">{savedPreview}</pre>
                </div>
              )}
            </Card>
          </div>
        </aside>
      </div>
    </>
  );
}
