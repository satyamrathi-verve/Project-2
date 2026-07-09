"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { Card } from "@/components/ui";
import { fillReminderTemplate } from "@/lib/collections";
import type { ReminderTemplate } from "@/lib/types";
import {
  CANONICAL_NAMES,
  DEFAULT_ATTACHMENT_OPTIONS,
  PREVIEW_SAMPLE,
  REMINDER_TYPES,
  bulletizeSelection,
  insertAtCursor,
  missingRequiredTokens,
  reminderTypeById,
  wrapSelection,
  type ReminderTypeId,
} from "./reminderTemplateConfig";
import { ReminderTypeTabs, OtherTemplatesSelect } from "./ReminderTypeTabs";
import { PlaceholderPanel } from "./PlaceholderPanel";
import { RichBodyEditor } from "./RichBodyEditor";
import { AttachmentsSection, SignatureSection } from "./AttachmentsAndSignature";
import { LivePreviewPanel } from "./LivePreviewPanel";
import { useLocalStorageState } from "./useLocalStorageState";

function fillForPreview(text: string) {
  return fillReminderTemplate(text, {
    customer: PREVIEW_SAMPLE.customer,
    amount: Number(PREVIEW_SAMPLE.amount.replace(/,/g, "")),
    daysOverdue: Number(PREVIEW_SAMPLE.daysOverdue),
    invoiceNo: PREVIEW_SAMPLE.invoiceNo,
  });
}

export default function ReminderTemplatePage() {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminderTypeId, setReminderTypeId] = useState<ReminderTypeId | null>(null);
  const [customTemplateId, setCustomTemplateId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [attachmentIds, setAttachmentIds] = useLocalStorageState<string[]>(
    "arManager.reminderTemplate.attachments",
    []
  );
  const [signature, setSignature] = useLocalStorageState<string>(
    "arManager.reminderTemplate.signature",
    "Warm regards,\nAccounts Receivable Team"
  );

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
          setLoading(false);
          return;
        }
        const rows = data ?? [];
        setTemplates(rows);
        const canonicalRow = REMINDER_TYPES.find((t) => rows.some((r) => r.name === t.templateName));
        const customRow = rows.find((r) => !CANONICAL_NAMES.has(r.name));
        if (canonicalRow) {
          loadReminderType(canonicalRow.id, rows);
        } else if (customRow) {
          loadCustomTemplate(customRow.id, rows);
        } else {
          loadReminderType(REMINDER_TYPES[0].id, rows);
        }
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadReminderType(id: ReminderTypeId, rows: ReminderTemplate[]) {
    const config = reminderTypeById(id);
    const existing = rows.find((r) => r.name === config.templateName);
    setReminderTypeId(id);
    setCustomTemplateId(null);
    setSelectedRowId(existing?.id ?? null);
    setSubject(existing?.subject ?? config.defaultSubject);
    setBody(existing?.body ?? config.defaultBody);
    setSaved(false);
    setError(null);
  }

  function loadCustomTemplate(id: string, rows: ReminderTemplate[]) {
    const existing = rows.find((r) => r.id === id);
    if (!existing) return;
    setReminderTypeId(null);
    setCustomTemplateId(id);
    setSelectedRowId(existing.id);
    setSubject(existing.subject);
    setBody(existing.body);
    setSaved(false);
    setError(null);
  }

  const activeConfig = reminderTypeId ? reminderTypeById(reminderTypeId) : null;
  const requiredTokens = activeConfig ? activeConfig.requiredTokens : ["{customer}"];
  const missingTokens = useMemo(
    () => missingRequiredTokens(requiredTokens, subject, body),
    [requiredTokens, subject, body]
  );

  const customTemplates = useMemo(() => templates.filter((t) => !CANONICAL_NAMES.has(t.name)), [templates]);
  const savedNames = useMemo(() => new Set(templates.map((t) => t.name)), [templates]);

  function insertToken(token: string) {
    if (lastFocused === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const cursor = el.selectionStart ?? subject.length;
      const { next, selStart } = insertAtCursor(subject, cursor, token);
      setSubject(next);
      setSaved(false);
      requestAnimationFrame(() => el.setSelectionRange(selStart, selStart));
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const cursor = el.selectionStart ?? body.length;
      const { next, selStart } = insertAtCursor(body, cursor, token);
      setBody(next);
      setSaved(false);
      requestAnimationFrame(() => el.setSelectionRange(selStart, selStart));
    }
  }

  function handleWrap(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const { next, selStart, selEnd } = wrapSelection(body, el.selectionStart ?? 0, el.selectionEnd ?? 0, marker);
    setBody(next);
    setSaved(false);
    requestAnimationFrame(() => el.setSelectionRange(selStart, selEnd));
  }

  function handleBulletize() {
    const el = bodyRef.current;
    if (!el) return;
    const { next, selStart, selEnd } = bulletizeSelection(body, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    setBody(next);
    setSaved(false);
    requestAnimationFrame(() => el.setSelectionRange(selStart, selEnd));
  }

  function toggleAttachment(id: string) {
    setAttachmentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!supabase || missingTokens.length > 0) return;
    setSaving(true);
    setError(null);

    if (selectedRowId) {
      const { error } = await supabase.from("reminder_templates").update({ subject, body }).eq("id", selectedRowId);
      setSaving(false);
      if (error) {
        setError(error.message);
        return;
      }
      setTemplates((prev) => prev.map((t) => (t.id === selectedRowId ? { ...t, subject, body } : t)));
      setSaved(true);
      return;
    }

    if (activeConfig) {
      const { data, error } = await supabase
        .from("reminder_templates")
        .insert({ name: activeConfig.templateName, subject, body })
        .select()
        .single();
      setSaving(false);
      if (error) {
        setError(error.message);
        return;
      }
      const row = data as ReminderTemplate;
      setTemplates((prev) => [...prev, row]);
      setSelectedRowId(row.id);
      setSaved(true);
    }
  }

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Reminder Template" subtitle="The chaser emails sent to overdue customers." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Reminder Template" subtitle="The chaser emails sent to overdue customers, by stage." />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Loading templates…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          {/* Editor column */}
          <div className="space-y-6">
            <Card title="Reminder type" subtitle="Each type is its own template — pick one to edit, or start a new one.">
              <ReminderTypeTabs activeTypeId={reminderTypeId} savedNames={savedNames} onSelect={(id) => loadReminderType(id, templates)} />
              <OtherTemplatesSelect templates={customTemplates} activeId={customTemplateId} onSelect={(id) => loadCustomTemplate(id, templates)} />
            </Card>

            <Card title="Message">
              <div className="flex flex-col gap-4">
                <FormField label="Subject">
                  <input
                    ref={subjectRef}
                    className={inputClass}
                    value={subject}
                    onFocus={() => setLastFocused("subject")}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setSaved(false);
                    }}
                  />
                </FormField>

                <FormField label="Body">
                  <RichBodyEditor
                    textareaRef={bodyRef}
                    value={body}
                    onFocus={() => setLastFocused("body")}
                    onChange={(v) => {
                      setBody(v);
                      setSaved(false);
                    }}
                    onWrap={handleWrap}
                    onBulletize={handleBulletize}
                  />
                </FormField>
              </div>

              {missingTokens.length > 0 && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <p className="font-semibold">Missing required placeholder{missingTokens.length === 1 ? "" : "s"}</p>
                  <p className="mt-1">
                    {activeConfig?.label ?? "This template"} should include{" "}
                    {missingTokens.map((t, i) => (
                      <span key={t}>
                        {i > 0 && ", "}
                        <code className="font-mono">{t}</code>
                      </span>
                    ))}{" "}
                    somewhere in the subject or body.
                  </p>
                </div>
              )}

              {error && (
                <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || missingTokens.length > 0}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save template"}
                </button>
                <span aria-live="polite">
                  {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
                </span>
              </div>
            </Card>

            <Card title="Placeholders" subtitle="Click one to insert it wherever you last clicked.">
              <PlaceholderPanel onInsert={insertToken} />
            </Card>

            <Card title="Attachments" subtitle="Shown in the preview below — not real files.">
              <AttachmentsSection selectedIds={attachmentIds} onToggle={toggleAttachment} />
            </Card>

            <Card title="Signature">
              <SignatureSection value={signature} onChange={setSignature} />
            </Card>
          </div>

          {/* Preview column */}
          <LivePreviewPanel
            reminderType={activeConfig ?? REMINDER_TYPES[0]}
            subject={fillForPreview(subject)}
            body={fillForPreview(body)}
            attachmentIds={attachmentIds}
            attachmentOptions={DEFAULT_ATTACHMENT_OPTIONS}
            signature={signature}
            missingTokens={missingTokens}
          />
        </div>
      )}
    </>
  );
}
