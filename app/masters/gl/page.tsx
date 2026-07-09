"use client";

/*
  GL Master — the reference list of ledger accounts (Sales, Debtors, Bank,
  Discount, etc). Mirrors the Customer Master pattern: DataTable for the list,
  FormField for the add/edit form, PageHeader for the title block.

  Schema this page reads/writes (see supabase/seed.sql — do not change it):
    gl_accounts: id, code, name, type ('asset'|'liability'|'income'|'expense'), parent_group

  A few fields that sometimes come up for a "Chart of Accounts" screen (Short
  Name, Description, Account Category, GL Subtype, Normal Balance, Active
  flag) are NOT in the current table, so they are intentionally left out
  rather than guessed at. If the team wants them later, they'd need to be
  added to gl_accounts in Supabase first — this page does not create or
  alter tables.
*/

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import type { GLAccount } from "@/lib/types";

const ACCOUNT_TYPES: GLAccount["type"][] = ["asset", "liability", "income", "expense"];

// Colour badge per type so the four groups are visually distinct at a glance.
const TYPE_STYLES: Record<GLAccount["type"], string> = {
  asset: "bg-blue-100 text-blue-700",
  liability: "bg-amber-100 text-amber-700",
  income: "bg-emerald-100 text-emerald-700",
  expense: "bg-rose-100 text-rose-700",
};

function TypeBadge({ type }: { type: GLAccount["type"] }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${TYPE_STYLES[type]}`}>
      {type}
    </span>
  );
}

// Empty shape for the add/edit form. `id` stays null while adding.
const EMPTY_FORM = { id: null as string | null, code: "", name: "", type: "asset" as GLAccount["type"], parent_group: "" };

export default function GLMasterPage() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from("gl_accounts").select("*").order("code");
    if (error) {
      setLoadError(error.message);
    } else {
      setAccounts(data ?? []);
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  function openAddForm() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(account: GLAccount) {
    setForm({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      parent_group: account.parent_group ?? "",
    });
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    const code = form.code.trim();
    const name = form.name.trim();

    // Simple, friendly validation before we touch the database.
    if (!code) return setFormError("GL Code is required.");
    if (!name) return setFormError("GL Name is required.");
    if (!ACCOUNT_TYPES.includes(form.type)) return setFormError("Please choose an account type.");

    // Client-side duplicate check (the database also enforces this via a
    // unique constraint on code, so this just gives a nicer message first).
    const duplicate = accounts.some(
      (a) => a.code.toLowerCase() === code.toLowerCase() && a.id !== form.id
    );
    if (duplicate) return setFormError(`GL Code "${code}" is already in use.`);

    setSaving(true);
    setFormError(null);

    const payload = {
      code,
      name,
      type: form.type,
      parent_group: form.parent_group.trim() || null,
    };

    const { error } = form.id
      ? await supabase.from("gl_accounts").update(payload).eq("id", form.id)
      : await supabase.from("gl_accounts").insert(payload);

    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    closeForm();
    loadAccounts();
  }

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "Code", className: "font-mono text-xs" },
    { key: "name", header: "Name" },
    { key: "type", header: "Type", render: (row) => <TypeBadge type={row.type} /> },
    { key: "parent_group", header: "Parent Group", render: (row) => row.parent_group ?? "—" },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <button
          onClick={() => openEditForm(row)}
          className="text-xs font-medium text-brand hover:underline"
        >
          Edit
        </button>
      ),
    },
  ];

  if (!isConfigured) {
    return <NotConfigured />;
  }

  return (
    <div>
      <PageHeader
        title="GL Master"
        subtitle="Manage the ledger accounts used across invoices, receipts, and reports"
        action={
          <button
            onClick={openAddForm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Add Account
          </button>
        }
      />

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className={`${inputClass} w-full max-w-sm`}
        />
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn&apos;t load GL accounts: {loadError}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Loading GL accounts…
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          empty={search ? "No accounts match your search." : "No GL accounts yet. Add the first one above."}
        />
      )}

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
          >
            <h3 className="mb-4 text-lg font-bold text-slate-900">
              {form.id ? "Edit GL Account" : "Add GL Account"}
            </h3>

            <div className="flex flex-col gap-4">
              <FormField label="GL Code">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 4000"
                />
              </FormField>

              <FormField label="GL Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Sales / Professional Fees"
                />
              </FormField>

              <FormField label="Account Type">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as GLAccount["type"] })}
                  className={inputClass}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">
                      {t}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Parent Group (optional)">
                <input
                  value={form.parent_group}
                  onChange={(e) => setForm({ ...form, parent_group: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. Current Assets"
                />
              </FormField>

              {/*
                Future placeholders — not in gl_accounts today, so not wired
                up. Add the columns in Supabase first if these become real:
                Short Name, Description, Account Category, GL Subtype,
                Normal Balance, Active/Inactive.
              */}
            </div>

            {formError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : form.id ? "Save Changes" : "Add Account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
