"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import type { Customer } from "@/lib/types";

/*
  Customer Master
  ----------------
  This is the base screen every later AR Manager screen leans on — invoices,
  receipts, statements and ageing all point back to a customer row created
  here. This page only ever reads/writes the existing `customers` table
  through the shared client in lib/supabase.ts. It never touches the
  database schema.

  Note on "active/inactive": the customers table in supabase/seed.sql has no
  such column, so there's nothing to filter on yet. If the team wants that,
  it needs a new column added on the backend first — ask before adding one
  here, per the "never alter tables" rule.
*/

type FormState = {
  id: string | null;
  code: string;
  name: string;
  gstin: string;
  pan: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  credit_limit: string;
  credit_days: string;
  opening_balance: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  code: "",
  name: "",
  gstin: "",
  pan: "",
  contact_person: "",
  email: "",
  phone: "",
  address: "",
  credit_limit: "0",
  credit_days: "30",
  opening_balance: "0",
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("code", { ascending: true });
    if (error) {
      setLoadError(error.message);
    } else {
      setCustomers((data ?? []) as Customer[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.code, c.name, c.contact_person, c.email, c.phone]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [customers, search]);

  function openAddForm() {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setPanelOpen(true);
  }

  function openEditForm(c: Customer) {
    setForm({
      id: c.id,
      code: c.code,
      name: c.name,
      gstin: c.gstin ?? "",
      pan: c.pan ?? "",
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      credit_limit: String(c.credit_limit ?? 0),
      credit_days: String(c.credit_days ?? 0),
      opening_balance: String(c.opening_balance ?? 0),
    });
    setFormErrors({});
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function validate(f: FormState): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!f.code.trim()) errs.code = "Customer code is required.";
    if (!f.name.trim()) errs.name = "Customer name is required.";
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) {
      errs.email = "Enter a valid email address.";
    }
    if (Number(f.credit_limit) < 0) errs.credit_limit = "Credit limit cannot be negative.";
    if (Number(f.credit_days) < 0) errs.credit_days = "Credit days cannot be negative.";
    if (Number(f.opening_balance) < 0) errs.opening_balance = "Opening balance cannot be negative.";
    return errs;
  }

  async function handleSave() {
    if (!supabase) return;
    const errs = validate(form);
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      gstin: form.gstin.trim() || null,
      pan: form.pan.trim() || null,
      contact_person: form.contact_person.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      credit_limit: Number(form.credit_limit) || 0,
      credit_days: Number(form.credit_days) || 0,
      opening_balance: Number(form.opening_balance) || 0,
    };

    const { error } = form.id
      ? await supabase.from("customers").update(payload).eq("id", form.id)
      : await supabase.from("customers").insert(payload);

    setSaving(false);

    if (error) {
      setBanner({ type: "error", text: `Could not save: ${error.message}` });
      return;
    }

    setBanner({ type: "success", text: form.id ? "Customer updated." : "Customer added." });
    setPanelOpen(false);
    loadCustomers();
  }

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code" },
    {
      key: "name",
      header: "Customer Name",
      className: "max-w-[220px]",
      render: (r) => <span className="line-clamp-2">{r.name}</span>,
    },
    { key: "contact_person", header: "Contact Person", render: (r) => r.contact_person || "—" },
    { key: "email", header: "Email", render: (r) => r.email || "—" },
    {
      key: "phone",
      header: "Phone",
      className: "whitespace-nowrap",
      render: (r) => r.phone || "—",
    },
    {
      key: "credit_limit",
      header: "Credit Limit",
      className: "text-right",
      render: (r) => currency.format(r.credit_limit ?? 0),
    },
    {
      key: "credit_days",
      header: "Credit Days",
      className: "text-right",
      render: (r) => `${r.credit_days} days`,
    },
    {
      key: "opening_balance",
      header: "Opening Balance",
      className: "text-right",
      render: (r) => currency.format(r.opening_balance ?? 0),
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (r) => (
        <button
          onClick={() => openEditForm(r)}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
        >
          Edit
        </button>
      ),
    },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Customer Master"
          subtitle="Manage customer details, credit terms, and opening balances."
        />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Customer Master"
        subtitle="Manage customer details, credit terms, and opening balances."
        action={
          <button
            onClick={openAddForm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
          >
            + Add Customer
          </button>
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

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, name, contact person, email or phone…"
          className={`${inputClass} w-full max-w-md`}
        />
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Couldn&apos;t load customers: {loadError}
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Loading customers…
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          empty={
            search
              ? "No customers match your search."
              : 'No customers yet. Click "Add Customer" to create the first one.'
          }
        />
      )}

      {panelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 dark:bg-black/50">
          <div className="themed flex h-full w-full max-w-lg flex-col bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {form.id ? "Edit Customer" : "Add Customer"}
              </h3>
              <button
                onClick={closePanel}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <FormSection title="Basic Details">
                <FormField label="Customer Code">
                  <input
                    className={inputClass}
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. CUST013"
                  />
                  {formErrors.code && <FieldError text={formErrors.code} />}
                </FormField>
                <FormField label="Customer Name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Business name"
                  />
                  {formErrors.name && <FieldError text={formErrors.name} />}
                </FormField>
              </FormSection>

              <FormSection title="Tax Details">
                <FormField label="GSTIN">
                  <input
                    className={inputClass}
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                    placeholder="27AAACV1234F1Z5"
                  />
                </FormField>
                <FormField label="PAN">
                  <input
                    className={inputClass}
                    value={form.pan}
                    onChange={(e) => setForm({ ...form, pan: e.target.value })}
                    placeholder="AAACV1234F"
                  />
                </FormField>
              </FormSection>

              <FormSection title="Contact Details">
                <FormField label="Contact Person">
                  <input
                    className={inputClass}
                    value={form.contact_person}
                    onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                  />
                </FormField>
                <FormField label="Email">
                  <input
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@company.com"
                  />
                  {formErrors.email && <FieldError text={formErrors.email} />}
                </FormField>
                <FormField label="Phone">
                  <input
                    className={inputClass}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98xxx xxxxx"
                  />
                </FormField>
                <FormField label="Address">
                  <textarea
                    className={`${inputClass} min-h-[70px]`}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </FormField>
              </FormSection>

              <FormSection title="Credit Terms">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Credit Limit (₹)">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={form.credit_limit}
                      onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                    />
                    {formErrors.credit_limit && <FieldError text={formErrors.credit_limit} />}
                  </FormField>
                  <FormField label="Credit Days">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={form.credit_days}
                      onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
                    />
                    {formErrors.credit_days && <FieldError text={formErrors.credit_days} />}
                  </FormField>
                </div>
              </FormSection>

              <FormSection title="Opening Balance">
                <FormField label="Opening Balance (₹)">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                  />
                  {formErrors.opening_balance && <FieldError text={formErrors.opening_balance} />}
                </FormField>
              </FormSection>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button
                onClick={closePanel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-60"
              >
                {saving ? "Saving…" : form.id ? "Save Changes" : "Add Customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function FieldError({ text }: { text: string }) {
  return <p className="mt-1 text-xs text-red-600">{text}</p>;
}
