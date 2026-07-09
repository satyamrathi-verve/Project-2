"use client";

import { REMINDER_TYPES, scopedDefaults, type ReminderScope, type ReminderTypeId } from "./reminderTemplateConfig";
import type { ReminderTemplate } from "@/lib/types";

export function ReminderTypeTabs({
  activeTypeId,
  scope,
  savedNames,
  onSelect,
}: {
  activeTypeId: ReminderTypeId | null;
  scope: ReminderScope;
  savedNames: Set<string>;
  onSelect: (id: ReminderTypeId) => void;
}) {
  return (
    <div role="tablist" aria-label="Reminder type" className="flex flex-wrap gap-2">
      {REMINDER_TYPES.map((t) => {
        const active = activeTypeId === t.id;
        const saved = savedNames.has(scopedDefaults(t, scope).templateName);
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            title={t.description}
            onClick={() => onSelect(t.id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-brand bg-brand text-white"
                : "border-slate-300 bg-white text-slate-700 hover:border-brand/60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {t.label}
            {!saved && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                }`}
              >
                New
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Invoice Wise (one email per invoice — the original behaviour) vs Customer
// Wise (one roll-up email per customer, built around {invoice_table}). Each
// of the 4 reminder stages above has its own pair of templates, one per scope.
export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: ReminderScope;
  onChange: (scope: ReminderScope) => void;
}) {
  const options: { id: ReminderScope; label: string }[] = [
    { id: "invoice_wise", label: "Invoice Wise" },
    { id: "customer_wise", label: "Customer Wise" },
  ];
  return (
    <div role="tablist" aria-label="Reminder scope" className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
      {options.map((o) => {
        const active = scope === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "bg-white text-brand shadow-sm dark:bg-slate-900 dark:text-blue-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function OtherTemplatesSelect({
  templates,
  activeId,
  onSelect,
}: {
  templates: ReminderTemplate[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <div className="mt-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Other templates saved earlier
        </span>
        <select
          value={activeId ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="" disabled>
            Choose a template…
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
