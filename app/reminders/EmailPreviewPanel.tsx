"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FormField, inputClass } from "@/components/FormField";
import { Badge, type BadgeTone } from "@/components/Badge";
import { formatCurrency, formatDate, fillReminderTemplate } from "@/lib/collections";
import {
  fillConsolidatedReminderHtml,
  reminderStageLabel,
  type Candidate,
  type CampaignSummary,
  type EmailStatus,
} from "@/lib/reminderCampaign";
import type { ReminderTemplate } from "@/lib/types";

const STATUS_TONE: Record<EmailStatus, BadgeTone> = {
  Ready: "slate",
  "Missing Email": "amber",
  Sending: "blue",
  Sent: "emerald",
  Failed: "rose",
  Skipped: "amber",
};

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <Badge label={status} tone={STATUS_TONE[status]} />;
}

export function EmailPreviewPanel({
  templates,
  templateId,
  onTemplateChange,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  activeCandidate,
  onClearActive,
  selectedCount,
  filteredReadyCount,
  sending,
  onSendSelected,
  onSendAllFiltered,
  onClearSelection,
  campaignSummary,
  onDismissSummary,
}: {
  templates: ReminderTemplate[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  activeCandidate: Candidate | null;
  onClearActive: () => void;
  selectedCount: number;
  filteredReadyCount: number;
  sending: boolean;
  onSendSelected: () => void;
  onSendAllFiltered: () => void;
  onClearSelection: () => void;
  campaignSummary: CampaignSummary | null;
  onDismissSummary: () => void;
}) {
  const hasTemplate = templates.length > 0;
  const primary = activeCandidate?.primaryInvoice ?? null;

  const filledSubject = useMemo(() => {
    if (!activeCandidate || !primary) return subject;
    return fillReminderTemplate(subject, {
      customer: activeCandidate.customer.name,
      amount: activeCandidate.outstanding,
      daysOverdue: activeCandidate.maxAgeing,
      invoiceNo: primary.invoice_no,
    });
  }, [subject, activeCandidate, primary]);

  // Real HTML — one row per outstanding invoice, rendered exactly as it
  // would be written to reminder_log if this customer is sent to.
  const filledBodyHtml = useMemo(() => {
    if (!activeCandidate) return "";
    return fillConsolidatedReminderHtml(body, {
      customerName: activeCandidate.customer.name,
      invoices: activeCandidate.invoices,
    });
  }, [body, activeCandidate]);

  return (
    <div className="space-y-4">
      {!hasTemplate ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          No reminder templates found yet. Add one on the{" "}
          <Link href="/followup/template" className="font-semibold underline">
            Reminder Template
          </Link>{" "}
          screen first.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Reminder Template</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Applies to every email in this send. Edits here don&apos;t change the saved template.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <FormField label="Template">
              <select className={inputClass} value={templateId} onChange={(e) => onTemplateChange(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Subject">
              <input className={inputClass} value={subject} onChange={(e) => onSubjectChange(e.target.value)} />
            </FormField>
            <FormField label="Body">
              <textarea
                className={`${inputClass} min-h-[140px] font-mono text-xs leading-relaxed`}
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
              />
            </FormField>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Email Preview</h3>
          {activeCandidate && (
            <button onClick={onClearActive} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              Clear
            </button>
          )}
        </div>

        {!activeCandidate ? (
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            Click a customer row to preview their reminder email.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {!activeCandidate.hasEmail && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                This customer has no email address on file — they&apos;ll be skipped when sending.
              </p>
            )}

            {/* Attachments — every outstanding invoice for this customer, each with a real PDF link */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Attachments — Invoice PDFs ({activeCandidate.invoices.length})
              </p>
              <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {activeCandidate.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-100">
                        <Link href={`/invoices/${inv.id}`} className="hover:underline">
                          {inv.invoice_no}
                        </Link>
                      </p>
                      <p className="text-slate-400">
                        {formatDate(inv.invoice_date)} · due {formatDate(inv.due_date)} ·{" "}
                        <Link href={`/invoices/${inv.id}/print`} className="hover:underline">
                          PDF
                        </Link>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {formatCurrency(inv.outstanding)}
                      </p>
                      <p className={inv.ageing > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}>
                        {inv.ageing > 0 ? `${inv.ageing} days overdue` : "not yet due"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rendered email — kept on a fixed light "paper" background regardless
                of app theme, since the injected HTML has hardcoded email-safe
                inline colors (an actual mail client is always light-background). */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
                <p className="text-xs text-slate-400">To</p>
                <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">
                  {activeCandidate.customer.email ?? "(no email on file)"}
                </p>
                <p className="mt-2 text-xs text-slate-400">Subject</p>
                <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                  {filledSubject || <span className="text-slate-300">(empty)</span>}
                </p>
              </div>
              <div className="px-4 py-4">
                {filledBodyHtml ? (
                  <div
                    className="overflow-x-auto text-sm [&_table]:my-3 [&_td]:align-top [&_th]:align-top"
                    dangerouslySetInnerHTML={{ __html: filledBodyHtml }}
                  />
                ) : (
                  <p className="text-slate-300">(empty)</p>
                )}
                {primary && (
                  <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800/60">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                        {formatCurrency(activeCandidate.outstanding)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Oldest Due Date</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                        {formatDate(activeCandidate.oldestDueDate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Reminder</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                        {reminderStageLabel(activeCandidate.remindersSent)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {campaignSummary && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Campaign summary</p>
            <button onClick={onDismissSummary} className="text-xs text-emerald-700 hover:underline dark:text-emerald-300">
              Dismiss
            </button>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs text-emerald-900 dark:text-emerald-200">
            <Row label="Customers processed" value={String(campaignSummary.totalProcessed)} />
            <Row label="Emails sent" value={String(campaignSummary.sent)} />
            <Row label="Failed" value={String(campaignSummary.failed)} />
            <Row label="Skipped (no email)" value={String(campaignSummary.skipped)} />
            <Row label="Outstanding covered" value={formatCurrency(campaignSummary.outstandingCovered)} />
            <Row label="Sent at" value={new Date(campaignSummary.at).toLocaleString("en-IN")} />
          </dl>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={onSendSelected}
          disabled={!hasTemplate || sending || selectedCount === 0}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "Sending…" : `Send Selected (${selectedCount})`}
        </button>
        <button
          onClick={onSendAllFiltered}
          disabled={!hasTemplate || sending || filteredReadyCount === 0}
          className="w-full rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send All Filtered ({filteredReadyCount})
        </button>
        <button
          onClick={onClearSelection}
          disabled={selectedCount === 0}
          className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cancel / Clear selection
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
