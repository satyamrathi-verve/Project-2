"use client";

import { inputClass } from "@/components/FormField";
import { DEFAULT_ATTACHMENT_OPTIONS } from "./reminderTemplateConfig";

/*
  Neither attachments nor a signature have a column in reminder_templates,
  and this app doesn't create schema or file storage. Both are kept in this
  browser's localStorage (see useLocalStorageState) so they persist across
  reloads on this machine without touching Supabase. Attachments are
  simulated — no real file is stored or sent, same convention this app
  already uses for Auto Email Shoot's simulated sending.
*/
export function AttachmentsSection({
  selectedIds,
  onToggle,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {DEFAULT_ATTACHMENT_OPTIONS.map((opt) => (
        <label
          key={opt.id}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:border-brand/60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(opt.id)}
            onChange={() => onToggle(opt.id)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600 dark:bg-slate-900"
          />
          {opt.label}
        </label>
      ))}
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Simulated for the preview — no file is actually stored or attached.
      </p>
    </div>
  );
}

export function SignatureSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Email signature"
        className={`${inputClass} min-h-[100px] leading-relaxed`}
        placeholder={"Warm regards,\nAccounts Receivable Team"}
      />
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        Shared across every reminder type. Saved in this browser, not in the database.
      </p>
    </div>
  );
}
