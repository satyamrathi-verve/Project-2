"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { inr } from "@/components/ui";
import type { Customer, InvoiceItem } from "@/lib/types";

/*
  Invoice Punch/Edit. One form, two entry points:
    - app/invoices/new/page.tsx            -> <InvoiceForm />
    - app/invoices/[id]/edit/page.tsx      -> <InvoiceForm invoiceId={id} />
  Saves the invoice header + its line items, then sends the user to the
  Invoice View screen for that invoice.
*/

type LineItem = {
  key: string;
  description: string;
  qty: string;
  rate: string;
};

let keyCounter = 0;
function makeKey() {
  keyCounter += 1;
  return `line-${Date.now()}-${keyCounter}`;
}

function emptyLine(): LineItem {
  return { key: makeKey(), description: "", qty: "1", rate: "0" };
}

function formatDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return formatDateOnly(new Date());
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDateOnly(d);
}

// Next invoice number, following the seed data's 'INV-0001' convention.
async function nextInvoiceNo(): Promise<string> {
  if (!supabase) return "INV-0001";
  const { data } = await supabase
    .from("invoices")
    .select("invoice_no")
    .order("invoice_no", { ascending: false })
    .limit(1);
  const last = data?.[0]?.invoice_no as string | undefined;
  const match = last?.match(/(\d+)$/);
  const n = match ? Number(match[1]) + 1 : 1;
  const width = match ? match[1].length : 4;
  return `INV-${String(n).padStart(width, "0")}`;
}

export function InvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [dueDate, setDueDate] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyLine()]);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.code })),
    [customers]
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      const { data: custData, error: custError } = await supabase!
        .from("customers")
        .select("*")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (custError) {
        setLoadError(custError.message);
        setLoading(false);
        return;
      }
      setCustomers((custData ?? []) as Customer[]);

      if (invoiceId) {
        const { data: invData, error: invError } = await supabase!
          .from("invoices")
          .select("*, invoice_items(*)")
          .eq("id", invoiceId)
          .maybeSingle();
        if (cancelled) return;
        if (invError) {
          setLoadError(invError.message);
          setLoading(false);
          return;
        }
        if (!invData) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setCustomerId(invData.customer_id);
        setInvoiceNo(invData.invoice_no);
        setInvoiceDate(invData.invoice_date);
        setDueDate(invData.due_date);
        setDueDateTouched(true);
        setNotes(invData.notes ?? "");
        const lines = ((invData.invoice_items ?? []) as InvoiceItem[]).map((it) => ({
          key: it.id,
          description: it.description,
          qty: String(it.qty),
          rate: String(it.rate),
        }));
        setItems(lines.length > 0 ? lines : [emptyLine()]);
      } else {
        setInvoiceNo(await nextInvoiceNo());
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // Auto-fill due date from invoice date + the customer's credit days, unless
  // the user has typed into Due Date themselves (or we just loaded one).
  useEffect(() => {
    if (dueDateTouched || !selectedCustomer || !invoiceDate) return;
    setDueDate(addDays(invoiceDate, selectedCustomer.credit_days));
  }, [invoiceDate, selectedCustomer, dueDateTouched]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const lineAmounts = items.map((it) => (Number(it.qty) || 0) * (Number(it.rate) || 0));
  const subtotal = lineAmounts.reduce((sum, a) => sum + a, 0);
  const taxAmount = Math.round(subtotal * 0.18 * 100) / 100;
  const total = subtotal + taxAmount;

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function addRow() {
    setItems((prev) => [...prev, emptyLine()]);
  }

  function removeRow(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!customerId) errs.customer = "Select a customer.";
    const validLines = items.filter((it) => it.description.trim() && Number(it.qty) > 0);
    if (validLines.length === 0) {
      errs.items = "Add at least one line item with a description and quantity.";
    }
    return errs;
  }

  async function handleSave() {
    if (!supabase) return;
    const errs = validate();
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);

    const validLines = items.filter((it) => it.description.trim() && Number(it.qty) > 0);
    const headerPayload = {
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      customer_id: customerId,
      due_date: dueDate,
      subtotal,
      tax_amount: taxAmount,
      total,
      notes: notes.trim() || null,
    };

    let id = invoiceId ?? null;

    if (id) {
      const { error: updError } = await supabase.from("invoices").update(headerPayload).eq("id", id);
      if (updError) {
        setSaving(false);
        setBanner({ type: "error", text: `Could not save: ${updError.message}` });
        return;
      }
      const { error: delError } = await supabase.from("invoice_items").delete().eq("invoice_id", id);
      if (delError) {
        setSaving(false);
        setBanner({ type: "error", text: `Could not save line items: ${delError.message}` });
        return;
      }
    } else {
      const { data: insData, error: insError } = await supabase
        .from("invoices")
        .insert({ ...headerPayload, status: "open" })
        .select("id")
        .single();
      if (insError || !insData) {
        setSaving(false);
        setBanner({ type: "error", text: `Could not save: ${insError?.message ?? "unknown error"}` });
        return;
      }
      id = insData.id as string;
    }

    const itemsPayload = validLines.map((it) => ({
      invoice_id: id,
      description: it.description.trim(),
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      amount: (Number(it.qty) || 0) * (Number(it.rate) || 0),
    }));

    const { error: itemsError } = await supabase.from("invoice_items").insert(itemsPayload);
    setSaving(false);
    if (itemsError) {
      setBanner({ type: "error", text: `Could not save line items: ${itemsError.message}` });
      return;
    }

    router.push(`/invoices/${id}`);
  }

  if (!isConfigured || !supabase) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={invoiceId ? "Edit Invoice" : "New Invoice"} />
        <NotConfigured />
      </div>
    );
  }

  if (notFound) {
    return (
      <PageHeader
        title="Invoice not found"
        subtitle={`No invoice matches id ${invoiceId}.`}
        action={
          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Back to Invoice List
          </Link>
        }
      />
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title={invoiceId ? "Edit Invoice" : "New Invoice"} />
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title={invoiceId ? "Edit Invoice" : "New Invoice"} />
        <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-semibold">Couldn&apos;t load this screen.</p>
          <p className="mt-1 text-sm">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={invoiceId ? `Edit Invoice ${invoiceNo}` : `New Invoice ${invoiceNo}`}
        subtitle={selectedCustomer ? selectedCustomer.name : "Select a customer to begin."}
        action={
          <Link
            href={invoiceId ? `/invoices/${invoiceId}` : "/invoices"}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </Link>
        }
      />

      {banner && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
            banner.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="themed mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Invoice Details
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Customer">
            <SearchableSelect
              options={customerOptions}
              value={customerId ?? ""}
              onChange={(v) => setCustomerId(v)}
              placeholder="Search by customer name or code…"
            />
            {formErrors.customer && <FieldError text={formErrors.customer} />}
          </FormField>
          <FormField label="Invoice No.">
            <input
              className={`${inputClass} bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}
              value={invoiceNo}
              readOnly
            />
          </FormField>
          <FormField label="Invoice Date">
            <input
              type="date"
              className={inputClass}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FormField>
          <FormField label="Due Date">
            <input
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(e) => {
                setDueDateTouched(true);
                setDueDate(e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {selectedCustomer
                ? `Auto-filled from ${selectedCustomer.credit_days} credit days — edit to override.`
                : "Auto-fills once a customer is selected."}
            </p>
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Notes (optional)">
              <textarea
                className={`${inputClass} min-h-[60px]`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </div>

      <div className="themed mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Line Items
          </h3>
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 dark:hover:bg-brand/20"
          >
            + Add Line
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_90px_110px_120px_36px] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <span>Description</span>
            <span>Qty</span>
            <span>Rate (₹)</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {items.map((it) => {
            const amount = (Number(it.qty) || 0) * (Number(it.rate) || 0);
            return (
              <div key={it.key} className="grid grid-cols-[1fr_90px_110px_120px_36px] items-center gap-2">
                <input
                  className={inputClass}
                  value={it.description}
                  onChange={(e) => updateItem(it.key, { description: e.target.value })}
                  placeholder="Line description"
                />
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={it.qty}
                  onChange={(e) => updateItem(it.key, { qty: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={it.rate}
                  onChange={(e) => updateItem(it.key, { rate: e.target.value })}
                />
                <span className="text-right text-sm font-medium text-slate-700 dark:text-slate-300">
                  {inr(amount)}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(it.key)}
                  disabled={items.length === 1}
                  aria-label="Remove line"
                  className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        {formErrors.items && <FieldError text={formErrors.items} />}

        <div className="mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{inr(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Tax (18%)</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{inr(taxAmount)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
              <dt className="text-base font-bold text-slate-900 dark:text-white">Total</dt>
              <dd className="text-base font-bold text-slate-900 dark:text-white">{inr(total)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Link
          href={invoiceId ? `/invoices/${invoiceId}` : "/invoices"}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </Link>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : invoiceId ? "Save Changes" : "Save Invoice"}
        </button>
      </div>
    </div>
  );
}

function FieldError({ text }: { text: string }) {
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{text}</p>;
}
