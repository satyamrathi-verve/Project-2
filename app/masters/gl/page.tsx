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
import { FormField, FormSection, inputClass } from "@/components/FormField";
import { TableSkeleton } from "@/components/ui";
import { Badge, type BadgeTone } from "@/components/Badge";
import type { GLAccount } from "@/lib/types";

const ACCOUNT_TYPES: GLAccount["type"][] = ["asset", "liability", "income", "expense"];

// One distinct, meaningful tone per type — assets/income lean toward the
// "positive" cool tones, liabilities/expenses toward the "caution" warm
// tones, reusing the same Badge component (and tone vocabulary) as every
// other status pill in the app instead of a one-off local badge.
const TYPE_TONE: Record<GLAccount["type"], BadgeTone> = {
  asset: "emerald",
  liability: "amber",
  income: "teal",
  expense: "rose",
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    { key: "code", header: "Code", className: "font-mono text-xs text-slate-900 dark:text-white" },
    { key: "name", header: "Name" },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge label={capitalize(row.type)} tone={TYPE_TONE[row.type]} />,
    },
    { key: "parent_group", header: "Parent Group", render: (row) => row.parent_group ?? "—" },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <button
          onClick={() => openEditForm(row)}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-brand/10 hover:text-brand focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500"
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
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Couldn&apos;t load GL accounts: {loadError}
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={7} cols={5} />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          stickyHeader
          empty={
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="text-sm text-slate-400 dark:text-slate-500">
                {search ? "No accounts match your search." : "No GL accounts yet."}
              </span>
              {!search && (
                <button
                  onClick={openAddForm}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                >
                  + Add Account
                </button>
              )}
            </div>
          }
        />
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 dark:bg-black/50">
          <form
            onSubmit={handleSave}
            className="themed w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {form.id ? "Edit GL Account" : "Add GL Account"}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5">
              <FormSection title="Account Details">
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
                  <div className="flex items-center gap-3">
                    <select
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value as GLAccount["type"] })}
                      className={`${inputClass} flex-1`}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {capitalize(t)}
                        </option>
                      ))}
                    </select>
                    {/* Live preview — shows exactly how this type renders in the table. */}
                    <Badge label={capitalize(form.type)} tone={TYPE_TONE[form.type]} />
                  </div>
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
              </FormSection>

              {formError && (
                <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="mt-0.5 h-4 w-4 flex-none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  </svg>
                  <span>{formError}</span>
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-60"
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
