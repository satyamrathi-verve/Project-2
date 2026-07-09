"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import type { ReminderTemplate } from "@/lib/types";

/* Sample values used only to render the live preview — never sent anywhere. */
const SAMPLE = {
  customer: "Sterling Textiles Pvt Ltd",
  amount: "42,500",
  days_overdue: "15",
  invoice_no: "INV-0007",
};

const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{customer}", label: "Customer name" },
  { token: "{amount}", label: "Outstanding amount" },
  { token: "{days_overdue}", label: "Days overdue" },
  { token: "{invoice_no}", label: "Invoice number" },
];

function fillTemplate(text: string) {
  return text
    .replaceAll("{customer}", SAMPLE.customer)
    .replaceAll("{amount}", SAMPLE.amount)
    .replaceAll("{days_overdue}", SAMPLE.days_overdue)
    .replaceAll("{invoice_no}", SAMPLE.invoice_no);
}

export default function ReminderTemplatePage() {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("reminder_templates")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else if (data && data.length > 0) {
          setTemplates(data);
          setSelectedId(data[0].id);
          setSubject(data[0].subject);
          setBody(data[0].body);
        }
        setLoading(false);
      });
  }, []);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  );

  function selectTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedId(id);
    setSubject(t.subject);
    setBody(t.body);
    setSaved(false);
  }

  async function handleSave() {
    if (!supabase || !selected) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("reminder_templates")
      .update({ subject, body })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTemplates((prev) =>
      prev.map((t) => (t.id === selected.id ? { ...t, subject, body } : t))
    );
    setSaved(true);
  }

  if (!isConfigured) {
    return (
      <>
        <PageHeader
          title="Reminder Template"
          subtitle="The chaser email sent to overdue customers."
        />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reminder Template"
        subtitle="The chaser email sent to overdue customers."
      />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Loading template…
        </div>
      ) : !selected ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          No reminder templates found yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Form */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            {templates.length > 1 && (
              <div className="mb-4">
                <FormField label="Template">
                  <select
                    className={inputClass}
                    value={selected.id}
                    onChange={(e) => selectTemplate(e.target.value)}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <FormField label="Subject">
                <input
                  className={inputClass}
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setSaved(false);
                  }}
                />
              </FormField>

              <FormField label="Body">
                <textarea
                  className={`${inputClass} min-h-[220px] font-mono text-xs leading-relaxed`}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setSaved(false);
                  }}
                />
              </FormField>
            </div>

            {/* Placeholder legend */}
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Placeholders you can use
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PLACEHOLDERS.map((p) => (
                  <span
                    key={p.token}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <code className="font-mono text-brand dark:text-blue-300">{p.token}</code>
                    <span className="text-slate-400 dark:text-slate-500">— {p.label}</span>
                  </span>
                ))}
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save template"}
              </button>
              {saved && (
                <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Live preview
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Shown with sample values — not sent to anyone.
            </p>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                <p className="text-xs text-slate-400 dark:text-slate-500">Subject</p>
                <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {fillTemplate(subject) || <span className="text-slate-300 dark:text-slate-600">(empty)</span>}
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-xs text-slate-400 dark:text-slate-500">Body</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                  {fillTemplate(body) || <span className="text-slate-300 dark:text-slate-600">(empty)</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
