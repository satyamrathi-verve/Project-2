"use client";

import { SearchableSelect, type SearchableSelectOption } from "@/components/SearchableSelect";
import type { ReminderScope } from "./reminderTemplateConfig";

/*
  Reminder Mode — sits above everything else on the page since it decides
  what real data (which customer, which invoice) feeds the live preview.
  Invoice Wise reminds about one invoice; Customer Wise rolls every
  outstanding invoice for the chosen customer into the {invoice_table}.
  Switching mode doesn't touch what's saved to reminder_templates — see
  handleScopeChange in page.tsx for that.
*/
export function ReminderModePanel({
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
  onScopeChange: (scope: ReminderScope) => void;
  customerOptions: SearchableSelectOption[];
  selectedCustomerId: string | null;
  onCustomerChange: (id: string) => void;
  invoiceOptions: SearchableSelectOption[];
  selectedInvoiceId: string | null;
  onInvoiceChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
      <fieldset className="flex-none">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Reminder Mode
        </legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="radio"
              name="reminder-mode"
              checked={scope === "invoice_wise"}
              onChange={() => onScopeChange("invoice_wise")}
              className="h-4 w-4 border-slate-300 text-brand focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
            />
            Invoice Wise
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="radio"
              name="reminder-mode"
              checked={scope === "customer_wise"}
              onChange={() => onScopeChange("customer_wise")}
              className="h-4 w-4 border-slate-300 text-brand focus:ring-brand dark:border-slate-600 dark:bg-slate-800"
            />
            Customer Wise
          </label>
        </div>
      </fieldset>

      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
