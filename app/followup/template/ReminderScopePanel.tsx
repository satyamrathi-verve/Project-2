"use client";

import { SearchableSelect, type SearchableSelectOption } from "@/components/SearchableSelect";
import type { ReminderScope } from "./reminderScope";

const SCOPES: { id: ReminderScope; label: string }[] = [
  { id: "invoice_wise", label: "Invoice Wise" },
  { id: "customer_wise", label: "Customer Wise" },
];

export function ReminderScopePanel({
  scope,
  onScopeChange,
  customerOptions,
  selectedCustomerId,
  onCustomerChange,
  invoiceOptions,
  selectedInvoiceId,
  onInvoiceChange,
}: {
  scope: ReminderScope;
  onScopeChange: (s: ReminderScope) => void;
  customerOptions: SearchableSelectOption[];
  selectedCustomerId: string | null;
  onCustomerChange: (id: string) => void;
  invoiceOptions: SearchableSelectOption[];
  selectedInvoiceId: string | null;
  onInvoiceChange: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Reminder scope" className="flex gap-2">
        {SCOPES.map((s) => {
          const active = scope === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onScopeChange(s.id)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand bg-brand text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-brand/60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Customer
        </label>
        <SearchableSelect
          options={customerOptions}
          value={selectedCustomerId ?? ""}
          onChange={onCustomerChange}
          placeholder="Search customer…"
        />
      </div>

      {scope === "invoice_wise" && (
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Invoice
          </label>
          <SearchableSelect
            options={invoiceOptions}
            value={selectedInvoiceId ?? ""}
            onChange={onInvoiceChange}
            placeholder={selectedCustomerId ? "Search invoice…" : "Pick a customer first"}
          />
        </div>
      )}

      {scope === "customer_wise" && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Tip: insert <code className="font-mono">{"{invoice_table}"}</code> in the body (see Placeholders below) to
          show every outstanding invoice for this customer.
        </p>
      )}
    </div>
  );
}
