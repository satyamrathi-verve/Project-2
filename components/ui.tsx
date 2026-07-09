import type { ReactNode } from "react";
import type { InvoiceStatus, ReceiptMode } from "@/lib/types";

/*
  Shared "house style" UI primitives. Reused across every screen so the whole
  app looks like one polished product. Add to this file rather than reinventing
  badges / avatars / cards per screen.
*/

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ---- money + text formatting ----------------------------------------------
export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

/** Compact currency for KPI tiles: ₹1.2L, ₹3.4Cr, ₹8,500. */
export const inrCompact = (n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)}L`;
  return inr(v);
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_STYLES = [
  "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const style = AVATAR_STYLES[hash(name) % AVATAR_STYLES.length];
  const dim = size === "lg" ? "h-11 w-11 text-sm" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className={cx("inline-flex flex-none items-center justify-center rounded-full font-semibold", dim, style)}>
      {initials(name)}
    </span>
  );
}

// ---- badges ----------------------------------------------------------------
const STATUS_STYLES: Record<InvoiceStatus, string> = {
  open: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/50",
  partial: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  overdue: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
};
const STATUS_DOT: Record<InvoiceStatus, string> = {
  open: "bg-slate-400",
  partial: "bg-amber-500",
  overdue: "bg-red-500",
  paid: "bg-emerald-500",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset",
        STATUS_STYLES[status]
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {status}
    </span>
  );
}

const MODE_STYLES: Record<ReceiptMode, string> = {
  cash: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  cheque: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  upi: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30",
  neft: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
};

export function ModeBadge({ mode }: { mode: ReceiptMode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset",
        MODE_STYLES[mode]
      )}
    >
      {mode}
    </span>
  );
}

// ---- icons (inline, no deps) ----------------------------------------------
type IconProps = { className?: string };
export function IconReceipt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5 5 3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
export function IconBanknote({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9v.01M18 15v.01" />
    </svg>
  );
}
export function IconCalendar({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}
export function IconWallet({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2Z" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5" />
      <path d="M17 12.5h.01" />
    </svg>
  );
}
export function IconSearch({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
export function IconPlus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
export function IconArrowLeft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
export function IconSliders({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </svg>
  );
}
export function IconRotateCcw({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
export function IconX({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
export function IconChevronDown({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
export function IconPhone({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z" />
    </svg>
  );
}
export function IconMoreVertical({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
export function IconUpload({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M12 4 7 9M12 4l5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
export function IconDownload({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v12M12 16l-5-5M12 16l5-5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
export function IconRefresh({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
export function IconChevronRight({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
export function IconFile({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
export function IconAlertTriangle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}
export function IconPrinter({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}
export function IconMail({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

// ---- KPI tile --------------------------------------------------------------
export function KpiCard({
  label,
  value,
  sub,
  icon,
  accent = "brand",
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: "brand" | "emerald" | "amber" | "violet" | "red";
  /** Makes the tile clickable — adds a pointer cursor, hover ring, and a "View details" affordance. */
  onClick?: () => void;
}) {
  const chip =
    accent === "emerald"
      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
      : accent === "amber"
      ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
      : accent === "violet"
      ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
      : accent === "red"
      ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
      : "bg-brand/10 text-brand dark:bg-brand/20 dark:text-blue-300";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "themed min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:shadow-none dark:hover:border-slate-700",
        onClick && "w-full cursor-pointer hover:-translate-y-0.5 hover:border-brand/40 hover:ring-1 hover:ring-brand/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {icon && <span className={cx("flex h-9 w-9 flex-none items-center justify-center rounded-lg", chip)}>{icon}</span>}
      </div>
      <p className="mt-3 break-words text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      {onClick && <p className="mt-2 text-xs font-semibold text-brand">View details &rarr;</p>}
    </Tag>
  );
}

// ---- card shell ------------------------------------------------------------
export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("themed rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {action && <div className="flex-none">{action}</div>}
        </header>
      )}
      <div className={cx("p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---- skeletons -------------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/50", className)} />;
}

export function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
        <Skeleton className="h-3 w-40" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-0 dark:border-slate-800">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cx("h-4", c === 1 ? "w-40" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}
