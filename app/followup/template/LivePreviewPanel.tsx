"use client";

import { Card } from "@/components/ui";
import { Badge } from "@/components/Badge";
import { renderFormattedHtml, type ReminderTypeConfig } from "./reminderTemplateConfig";
import type { AttachmentOption } from "./reminderTemplateConfig";

const ACCENT_BAR: Record<ReminderTypeConfig["accent"], string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
};

export function LivePreviewPanel({
  reminderType,
  subject,
  body,
  invoiceTableHtml,
  invoiceTableError,
  attachmentIds,
  attachmentOptions,
  signature,
  missingTokens,
}: {
  reminderType: ReminderTypeConfig;
  subject: string;
  body: string;
  /** Rendered HTML for the {invoice_table} token — only meaningful in Customer Wise. */
  invoiceTableHtml?: string | null;
  invoiceTableError?: string | null;
  attachmentIds: string[];
  attachmentOptions: AttachmentOption[];
  signature: string;
  missingTokens: string[];
}) {
  const enabledAttachments = attachmentOptions.filter((a) => attachmentIds.includes(a.id));
  const showTableSlot = body.includes("{invoice_table}") && (Boolean(invoiceTableHtml) || Boolean(invoiceTableError));
  const [bodyBefore, bodyAfter] = showTableSlot ? body.split("{invoice_table}") : [body, ""];

  return (
    <div className="sticky top-6">
      <Card title="Live preview" subtitle="Shown with sample values — nothing here is sent." bodyClassName="p-0">
        <div className={`h-1.5 w-full ${ACCENT_BAR[reminderType.accent]}`} />
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge label={reminderType.label} tone={reminderType.accent} />
            {missingTokens.length > 0 && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {missingTokens.length} required placeholder{missingTokens.length === 1 ? "" : "s"} missing
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Subject</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">
            {subject || <span className="text-slate-300 dark:text-slate-600">(empty)</span>}
          </p>
        </div>

        <div className="px-5 py-5">
          {body ? (
            <div className="max-w-none text-sm text-slate-700 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 dark:text-slate-300">
              <div dangerouslySetInnerHTML={{ __html: renderFormattedHtml(bodyBefore) }} />
              {showTableSlot && invoiceTableError ? (
                <p className="my-2 text-xs text-red-600 dark:text-red-400">
                  Couldn&apos;t load the invoice table: {invoiceTableError}
                </p>
              ) : (
                showTableSlot && (
                  <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: invoiceTableHtml ?? "" }} />
                )
              )}
              {showTableSlot && <div dangerouslySetInnerHTML={{ __html: renderFormattedHtml(bodyAfter) }} />}
            </div>
          ) : (
            <p className="text-sm text-slate-300 dark:text-slate-600">(empty)</p>
          )}

          {signature && (
            <div className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {signature}
            </div>
          )}

          {enabledAttachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              {enabledAttachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                >
                  📎 {a.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
