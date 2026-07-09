import type { ReactNode } from "react";

export function FormField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

/** Shared input styling so every form looks the same. Use on <input>/<select>. */
export const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-brand dark:[color-scheme:dark]";

/**
 * Groups a few FormFields under a labelled section (e.g. "Basic Details",
 * "Credit Terms") so a long form reads as chunks, not one continuous list.
 * Shared by every add/edit form (Customer Master, GL Master, …).
 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-7">
      <h4 className="mb-3 border-b border-slate-100 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
        {title}
      </h4>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

/** Small inline error for a single field — icon + message, red-600, sits right under the input. */
export function FieldError({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="mt-0.5 h-3.5 w-3.5 flex-none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
      <span>{text}</span>
    </p>
  );
}
