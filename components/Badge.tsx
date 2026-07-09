/*
  Small coloured pill for statuses/priorities. Shared so every screen (invoices,
  ageing, collections) uses the same look instead of one-off spans.
*/
const TONES = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  rose: "bg-rose-100 text-rose-700",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
