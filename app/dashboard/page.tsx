"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt, ReceiptAllocation, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { useTheme } from "@/components/ThemeProvider";
import {
  Avatar,
  Card,
  KpiCard,
  KpiSkeleton,
  ModeBadge,
  StatusBadge,
  Skeleton,
  IconReceipt,
  IconBanknote,
  IconCalendar,
  IconWallet,
  IconPlus,
  IconPhone,
  IconChevronDown,
  inr,
  inrCompact,
  cx,
} from "@/components/ui";

/*
  Screen 15 — Dashboard: the executive AR command center.
  Every number is computed live from the existing tables (customers, invoices,
  receipts, receipt_allocations) — no mock data, no new tables, read-only.
  invoice_items carries line detail only; no KPI here needs it.

  KPIs that would need history we don't store (true DSO trend, promise-to-pay,
  disputes) are deliberately absent rather than faked. Anything with no data —
  MoM trend, individual insights, banner clauses — hides gracefully.

  Charts are hand-rolled SVG/CSS (no chart library); the ageing ramp and donut
  colors were validated with the dataviz palette script for both themes.
*/

const EPS = 0.005;

// Ordinal ageing ramps — validated for each surface; dark mode flips the
// anchor so the worst bucket is the most visible.
const AGEING_LIGHT = ["#60a5fa", "#2f6bff", "#1d4ed8", "#1e3a8a", "#172554"];
const AGEING_DARK = ["#1d4ed8", "#2f6bff", "#60a5fa", "#93c5fd", "#dbeafe"];
const AGEING_LABELS = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"];

const STATUS_ORDER: { key: InvoiceStatus; label: string }[] = [
  { key: "paid", label: "Paid" },
  { key: "partial", label: "Partial" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
];
const STATUS_COLORS_LIGHT: Record<InvoiceStatus, string> = {
  paid: "#10b981",
  partial: "#f59e0b",
  open: "#94a3b8",
  overdue: "#ef4444",
};
const STATUS_COLORS_DARK: Record<InvoiceStatus, string> = {
  paid: "#34d399",
  partial: "#fbbf24",
  open: "#94a3b8",
  overdue: "#f87171",
};

const COLLAPSE_KEY = "dashboard.collapsed.v1";
const RANGE_KEY = "dashboard.trendRange.v1";

const dayMs = 86400000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / dayMs);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/** Round a max up to a clean 1/2/2.5/5 × 10^n so axis ticks look intentional. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// ---- AR health --------------------------------------------------------------

type Health = {
  score: number;
  status: "Excellent" | "Good" | "Attention Required" | "Critical";
  why: string[];
};

/**
 * AR Health Score (0–100) from receivable + ageing data only:
 *   40% collection efficiency (all-time collected ÷ billed)
 *   40% share of receivables NOT yet overdue
 *   20% share of receivables NOT aged past 60 days
 */
function healthScore(efficiency: number, overdueShare: number, severeShare: number): Health {
  const score = Math.round(100 * (0.4 * efficiency + 0.4 * (1 - overdueShare) + 0.2 * (1 - severeShare)));
  const status = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Attention Required" : "Critical";
  const why: string[] = [];
  if (efficiency < 0.6) why.push(`only ${(efficiency * 100).toFixed(0)}% of all billings collected so far`);
  else why.push(`${(efficiency * 100).toFixed(0)}% of all billings already collected`);
  if (overdueShare > 0.3) why.push(`${(overdueShare * 100).toFixed(0)}% of receivables are past due`);
  if (severeShare > 0.1) why.push(`${(severeShare * 100).toFixed(0)}% has aged beyond 60 days`);
  if (why.length === 1) why.push("overdue exposure is under control");
  return { score, status, why };
}

const HEALTH_STYLE: Record<Health["status"], { ring: string; ringDark: string; chip: string }> = {
  Excellent: { ring: "#10b981", ringDark: "#34d399", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30" },
  Good: { ring: "#2f6bff", ringDark: "#60a5fa", chip: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30" },
  "Attention Required": { ring: "#f59e0b", ringDark: "#fbbf24", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30" },
  Critical: { ring: "#ef4444", ringDark: "#f87171", chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30" },
};

function ScoreGauge({ health, dark }: { health: Health; dark: boolean }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const color = dark ? HEALTH_STYLE[health.status].ringDark : HEALTH_STYLE[health.status].ring;
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32 flex-none">
      <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(health.score / 100) * C} ${C}`}
        transform="rotate(-90 60 60)"
        className="transition-all duration-700"
      />
      <text x="60" y="60" textAnchor="middle" fontSize="28" fontWeight="700" className="fill-slate-900 dark:fill-white">
        {health.score}
      </text>
      <text x="60" y="78" textAnchor="middle" fontSize="10" className="fill-slate-400 dark:fill-slate-500">
        / 100
      </text>
    </svg>
  );
}

// ---- tiny presentational helpers -------------------------------------------

function TrendChip({ pct, goodWhenUp = true }: { pct: number; goodWhenUp?: boolean }) {
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
        good
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function ChartSkeleton({ h = "h-56" }: { h?: string }) {
  return (
    <Card>
      <Skeleton className="h-4 w-40" />
      <Skeleton className={cx("mt-4 w-full", h)} />
    </Card>
  );
}

/** A Card with a collapse toggle whose state persists via the parent. */
function Widget({
  title,
  subtitle,
  action,
  collapsed,
  onToggle,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("themed rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none", className)}>
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          {subtitle && !collapsed && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex flex-none items-center gap-2">
          {!collapsed && action}
          <button
            onClick={onToggle}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <IconChevronDown className={cx("h-4 w-4 transition-transform duration-200", collapsed && "-rotate-90")} />
          </button>
        </div>
      </header>
      {!collapsed && (
        <div className={cx("animate-fade-in border-t border-slate-100 dark:border-slate-800", bodyClassName ?? "p-6")}>{children}</div>
      )}
    </section>
  );
}

// ---- charts -----------------------------------------------------------------

function CollectionsLine({ points, dark }: { points: { label: string; value: number }[]; dark: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 210;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));
  const n = points.length;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `M${x(0)},${y(points[0].value)} L${line.split(" ").join(" L")} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const stroke = dark ? "#60a5fa" : "#2f6bff";
  const surface = dark ? "#0f172a" : "#ffffff";
  const labelEvery = n > 8 ? 2 : 1;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
        ))}
        {[0, 0.5, 1].map((t) => (
          <text key={t} x={padL - 8} y={y(max * t) + 3.5} textAnchor="end" fontSize="10" className="fill-slate-400 dark:fill-slate-500">
            {inrCompact(max * t)}
          </text>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={`${p.label}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" className="fill-slate-400 dark:fill-slate-500">
              {p.label}
            </text>
          ) : null
        )}
        <path d={area} fill={stroke} opacity="0.1" />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(points[n - 1].value)} r="4.5" fill={stroke} stroke={surface} strokeWidth="2" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill={stroke} stroke={surface} strokeWidth="2" />
          </>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">{points[hover].label}</span>{" "}
          <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{inr(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

function StatusDonut({
  slices,
  colors,
}: {
  slices: { key: InvoiceStatus; label: string; count: number; amount: number }[];
  colors: Record<InvoiceStatus, string>;
}) {
  const [active, setActive] = useState<InvoiceStatus | null>(null);
  const total = slices.reduce((s, x) => s + x.count, 0);
  const R = 56;
  const C = 2 * Math.PI * R;
  const gap = 2.5;
  let acc = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 flex-none">
        {slices
          .filter((s) => s.count > 0)
          .map((s) => {
            const frac = s.count / total;
            const len = Math.max(frac * C - gap, 0.5);
            const off = -acc * C;
            acc += frac;
            return (
              <circle
                key={s.key}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={colors[s.key]}
                strokeWidth={active === s.key ? 27 : 23}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={off}
                transform="rotate(-90 70 70)"
                className="transition-all duration-150"
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{`${s.label}: ${s.count} invoice${s.count === 1 ? "" : "s"} · ${inr(s.amount)}`}</title>
              </circle>
            );
          })}
        <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="700" className="fill-slate-900 dark:fill-white">
          {total}
        </text>
        <text x="70" y="82" textAnchor="middle" fontSize="9.5" className="fill-slate-400 dark:fill-slate-500">
          invoices
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <li key={s.key} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}>
            <Link
              href="/invoices"
              className={cx(
                "flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition-colors",
                active === s.key && "bg-slate-50 dark:bg-slate-800/60"
              )}
            >
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: colors[s.key] }} />
              <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-white">{s.count}</span>
              <span className="w-20 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">{inrCompact(s.amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HBarList({
  rows,
  colorFor,
}: {
  rows: { label: string; value: number; sub?: string; href?: string }[];
  colorFor?: (i: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-slate-600 dark:text-slate-300">{r.label}</span>
              <span className="flex-none text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{inrCompact(r.value)}</span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded-r bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-r transition-all duration-300 group-hover:opacity-80"
                style={{ width: `${Math.max((r.value / max) * 100, 1)}%`, background: colorFor?.(i) ?? "#2f6bff" }}
              />
            </div>
            {r.sub && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{r.sub}</p>}
          </>
        );
        const title = `${r.label}: ${inr(r.value)}${r.sub ? ` (${r.sub})` : ""}`;
        return r.href ? (
          <Link key={r.label} href={r.href} className="group block" title={title}>
            {body}
          </Link>
        ) : (
          <div key={r.label} className="group" title={title}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

// ---- the page ---------------------------------------------------------------

interface InvoiceRow extends Invoice {
  outstanding: number;
  allocated: number;
  effStatus: InvoiceStatus;
  daysOverdue: number;
  customerName: string;
}

interface PriorityRow {
  customerId: string;
  name: string;
  phone: string | null;
  outstanding: number;
  daysOverdue: number;
  invoiceCount: number;
  onAccount: number;
  impact: number;
  priority: "High" | "Medium" | "Low";
  action: { label: string; href: string };
}

export default function DashboardPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocs, setAllocs] = useState<ReceiptAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Personalization: widget collapse state + trend range, persisted per browser.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [trendRange, setTrendRange] = useState<6 | 12>(12);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
      const r = localStorage.getItem(RANGE_KEY);
      if (r === "6" || r === "12") setTrendRange(Number(r) as 6 | 12);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleWidget = (id: string) =>
    setCollapsed((c) => {
      const next = { ...c, [id]: !c[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const setRange = (r: 6 | 12) => {
    setTrendRange(r);
    try {
      localStorage.setItem(RANGE_KEY, String(r));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const [inv, cust, rcpt, alloc] = await Promise.all([
        supabase!.from("invoices").select("*"),
        supabase!.from("customers").select("*"),
        supabase!.from("receipts").select("*"),
        supabase!.from("receipt_allocations").select("*"),
      ]);
      const err = inv.error || cust.error || rcpt.error || alloc.error;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setInvoices((inv.data as Invoice[]) ?? []);
      setCustomers((cust.data as Customer[]) ?? []);
      setReceipts((rcpt.data as Receipt[]) ?? []);
      setAllocs((alloc.data as ReceiptAllocation[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const m = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const custById = new Map(customers.map((c) => [c.id, c]));
    const rcptById = new Map(receipts.map((r) => [r.id, r]));

    const allocByInvoice: Record<string, number> = {};
    const allocByReceipt: Record<string, number> = {};
    for (const a of allocs) {
      allocByInvoice[a.invoice_id] = (allocByInvoice[a.invoice_id] ?? 0) + Number(a.amount);
      allocByReceipt[a.receipt_id] = (allocByReceipt[a.receipt_id] ?? 0) + Number(a.amount);
    }

    const rows: InvoiceRow[] = invoices.map((iv) => {
      const allocated = allocByInvoice[iv.id] ?? 0;
      const outstanding = Number(iv.total) - allocated;
      const overdueDays = daysBetween(today, iv.due_date);
      const effStatus: InvoiceStatus =
        outstanding <= EPS ? "paid" : overdueDays > 0 ? "overdue" : allocated > EPS ? "partial" : "open";
      return {
        ...iv,
        allocated,
        outstanding,
        effStatus,
        daysOverdue: Math.max(overdueDays, 0),
        customerName: custById.get(iv.customer_id)?.name ?? "Unknown",
      };
    });

    const unpaid = rows.filter((r) => r.effStatus !== "paid");
    const overdue = rows.filter((r) => r.effStatus === "overdue");

    // ---- KPIs
    const totalReceivables = unpaid.reduce((s, r) => s + r.outstanding, 0);
    const overdueAmount = overdue.reduce((s, r) => s + r.outstanding, 0);

    const ym = today.slice(0, 7);
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    const ymPrev = prev.toISOString().slice(0, 7);
    const collectedThisMonth = receipts.filter((r) => r.receipt_date.startsWith(ym)).reduce((s, r) => s + Number(r.amount), 0);
    const collectedLastMonth = receipts.filter((r) => r.receipt_date.startsWith(ymPrev)).reduce((s, r) => s + Number(r.amount), 0);
    const collectedMoM = collectedLastMonth > EPS ? ((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100 : null;

    const totalBilled = rows.reduce((s, r) => s + Number(r.total), 0);
    const totalCollected = rows.reduce((s, r) => s + r.allocated, 0);
    const efficiency = totalBilled > EPS ? totalCollected / totalBilled : 0;

    let wDays = 0;
    let wSum = 0;
    const invById = new Map(rows.map((r) => [r.id, r]));
    for (const a of allocs) {
      const iv = invById.get(a.invoice_id);
      const rc = rcptById.get(a.receipt_id);
      if (!iv || !rc) continue;
      wDays += Number(a.amount) * Math.max(daysBetween(rc.receipt_date, iv.invoice_date), 0);
      wSum += Number(a.amount);
    }
    const avgCollectionDays = wSum > EPS ? wDays / wSum : 0;
    const avgCreditDays = customers.length ? customers.reduce((s, c) => s + (c.credit_days ?? 0), 0) / customers.length : 0;

    const outstandingByCustomer: Record<string, number> = {};
    for (const r of unpaid) outstandingByCustomer[r.customer_id] = (outstandingByCustomer[r.customer_id] ?? 0) + r.outstanding;
    const customersWithDues = Object.keys(outstandingByCustomer).length;
    const invoicedThisMonth = rows.filter((r) => r.invoice_date.startsWith(ym)).length;

    // ---- ageing buckets
    const buckets = [0, 0, 0, 0, 0];
    const bucketCounts = [0, 0, 0, 0, 0];
    for (const r of unpaid) {
      const d = daysBetween(today, r.due_date);
      const i = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
      buckets[i] += r.outstanding;
      bucketCounts[i]++;
    }
    const severeShare = totalReceivables > EPS ? (buckets[3] + buckets[4]) / totalReceivables : 0;
    const overdueShare = totalReceivables > EPS ? overdueAmount / totalReceivables : 0;

    // ---- health
    const health = healthScore(efficiency, overdueShare, severeShare);

    // ---- 12-month collections trend
    const months: { label: string; value: number }[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const key = cursor.toISOString().slice(0, 7);
      months.push({
        label: cursor.toLocaleDateString("en-IN", { month: "short" }),
        value: receipts.filter((r) => r.receipt_date.startsWith(key)).reduce((s, r) => s + Number(r.amount), 0),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // ---- status distribution
    const statusSlices = STATUS_ORDER.map((s) => ({
      key: s.key,
      label: s.label,
      count: rows.filter((r) => r.effStatus === s.key).length,
      amount: rows.filter((r) => r.effStatus === s.key).reduce((sum, r) => sum + (s.key === "paid" ? Number(r.total) : r.outstanding), 0),
    }));

    // ---- top outstanding customers
    const topCustomers = Object.entries(outstandingByCustomer)
      .map(([id, v]) => ({ label: custById.get(id)?.name ?? "Unknown", value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const topShare = totalReceivables > EPS && topCustomers[0] ? topCustomers[0].value / totalReceivables : 0;

    // ---- due in the next 7 days
    const dueSoon = unpaid.filter((r) => {
      const d = daysBetween(r.due_date, today);
      return d >= 0 && d <= 7;
    });
    const dueSoonAmount = dueSoon.reduce((s, r) => s + r.outstanding, 0);

    // ---- on-account money per customer (receipts not yet knocked off)
    const onAccountByCustomer: Record<string, number> = {};
    for (const r of receipts) {
      const un = Number(r.amount) - (allocByReceipt[r.id] ?? 0);
      if (un > EPS) onAccountByCustomer[r.customer_id] = (onAccountByCustomer[r.customer_id] ?? 0) + un;
    }

    // ---- today's collection priorities (per customer, sorted by impact)
    const overdueByCustomer: Record<string, { out: number; days: number; n: number }> = {};
    for (const r of overdue) {
      const e = (overdueByCustomer[r.customer_id] ??= { out: 0, days: 0, n: 0 });
      e.out += r.outstanding;
      e.days = Math.max(e.days, r.daysOverdue);
      e.n++;
    }
    const priorities: PriorityRow[] = Object.entries(overdueByCustomer)
      .map(([id, e]) => {
        const c = custById.get(id);
        const onAccount = onAccountByCustomer[id] ?? 0;
        const impact = e.out * (1 + Math.min(e.days, 90) / 45);
        const priority: PriorityRow["priority"] = e.days > 60 ? "High" : e.days > 30 ? "Medium" : "Low";
        const action =
          onAccount > EPS
            ? { label: "Record Receipt", href: "/receipts/new" }
            : e.days > 60
            ? { label: "Escalate", href: "/followup/workspace" }
            : e.days > 30
            ? { label: "Call Customer", href: c?.phone ? `tel:${c.phone.replace(/\s+/g, "")}` : "/followup/workspace" }
            : { label: "Send Reminder", href: "/followup/workspace" };
        return {
          customerId: id,
          name: c?.name ?? "Unknown",
          phone: c?.phone ?? null,
          outstanding: e.out,
          daysOverdue: e.days,
          invoiceCount: e.n,
          onAccount,
          impact,
          priority,
          action,
        };
      })
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 8);

    // ---- widgets
    const recentInvoices = [...rows].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).slice(0, 5);
    const recentReceipts = [...receipts]
      .sort((a, b) => b.receipt_date.localeCompare(a.receipt_date))
      .slice(0, 5)
      .map((r) => ({ ...r, customerName: custById.get(r.customer_id)?.name ?? "Unknown" }));
    const attention = [...overdue].sort((a, b) => b.outstanding - a.outstanding).slice(0, 6);

    // ---- insights
    const largestOverdueCustomer = Object.entries(
      overdue.reduce<Record<string, number>>((acc, r) => {
        acc[r.customer_id] = (acc[r.customer_id] ?? 0) + r.outstanding;
        return acc;
      }, {})
    )
      .map(([id, v]) => ({ name: custById.get(id)?.name ?? "Unknown", value: v }))
      .sort((a, b) => b.value - a.value)[0];
    const biggestInvoice = [...unpaid].sort((a, b) => b.outstanding - a.outstanding)[0];
    const nearLimit = customers
      .filter((c) => Number(c.credit_limit) > 0)
      .map((c) => ({ name: c.name, used: (outstandingByCustomer[c.id] ?? 0) / Number(c.credit_limit) }))
      .filter((c) => c.used >= 0.8)
      .sort((a, b) => b.used - a.used);

    return {
      today,
      totalReceivables,
      overdueAmount,
      overdueCount: overdue.length,
      overdueCustomers: Object.keys(overdueByCustomer).length,
      overdueShare,
      collectedThisMonth,
      collectedLastMonth,
      collectedMoM,
      openCount: unpaid.length,
      efficiency,
      avgCollectionDays,
      avgCreditDays,
      customersWithDues,
      totalCustomers: customers.length,
      invoicedThisMonth,
      buckets,
      bucketCounts,
      health,
      months,
      statusSlices,
      topCustomers,
      topShare,
      dueSoonAmount,
      dueSoonCount: dueSoon.length,
      priorities,
      recentInvoices,
      recentReceipts,
      attention,
      largestOverdueCustomer,
      biggestInvoice,
      nearLimit,
    };
  }, [invoices, customers, receipts, allocs]);

  const ageingColors = dark ? AGEING_DARK : AGEING_LIGHT;
  const statusColors = dark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
  const trendPoints = m.months.slice(12 - trendRange);

  const quickActions = [
    { href: "/invoices/new", label: "New Invoice", icon: <IconPlus className="h-4 w-4" /> },
    { href: "/receipts/new", label: "New Receipt", icon: <IconReceipt className="h-4 w-4" /> },
    { href: "/masters/customers", label: "Customer Master", icon: <IconWallet className="h-4 w-4" /> },
    { href: "/followup/workspace", label: "Collections Workspace", icon: <IconBanknote className="h-4 w-4" /> },
    { href: "/reports/statement", label: "Customer Statement", icon: <IconCalendar className="h-4 w-4" /> },
  ];

  const PRIORITY_CHIP: Record<PriorityRow["priority"], string> = {
    High: "bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
    Medium: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    Low: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/50",
  };

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Accounts receivable at a glance." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your accounts receivable command center — live from the books."
        action={
          <Link
            href="/receipts/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark hover:shadow"
          >
            <IconPlus className="h-4 w-4" />
            New Receipt
          </Link>
        }
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      )}

      {/* ---- executive summary + health ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {loading ? (
          <>
            <div className="lg:col-span-2"><ChartSkeleton h="h-24" /></div>
            <ChartSkeleton h="h-24" />
          </>
        ) : (
          <>
            <div className="animate-fade-in rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-6 text-white shadow-sm lg:col-span-2">
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Executive Summary</p>
                <span className="flex-none rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                  as of {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/95">
                {m.totalReceivables <= EPS ? (
                  <>The book is fully collected — no receivables outstanding. 🎉</>
                ) : (
                  <>
                    Total receivables stand at <span className="font-bold">{inr(m.totalReceivables)}</span>
                    {m.overdueAmount > EPS && (
                      <>
                        , of which <span className="font-bold">{inr(m.overdueAmount)}</span> ({(m.overdueShare * 100).toFixed(0)}%) is overdue
                      </>
                    )}
                    . Collections this month: <span className="font-bold">{inr(m.collectedThisMonth)}</span>.
                    {m.overdueCount > 0 && (
                      <>
                        {" "}Immediate attention is required for <span className="font-bold">{m.overdueCustomers} customer{m.overdueCustomers === 1 ? "" : "s"}</span> and{" "}
                        <span className="font-bold">{m.overdueCount} invoice{m.overdueCount === 1 ? "" : "s"}</span>.
                      </>
                    )}
                  </>
                )}
              </p>
            </div>

            <div className="animate-fade-in themed flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
              <ScoreGauge health={m.health} dark={dark} />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">AR Health Score</p>
                <span className={cx("mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", HEALTH_STYLE[m.health.status].chip)}>
                  {m.health.status}
                </span>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {m.health.why.join("; ")}.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- KPI grid (each card drills down) ---- */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : (
          <>
            <Link href="/reports/ageing" className="block">
              <KpiCard label="Total Receivables" value={inrCompact(m.totalReceivables)} sub={`${inr(m.totalReceivables)} outstanding`} icon={<IconWallet className="h-5 w-5" />} accent="brand" />
            </Link>
            <Link href="/reports/ageing" className="block">
              <KpiCard
                label="Overdue Amount"
                value={inrCompact(m.overdueAmount)}
                sub={<span className="text-red-500 dark:text-red-400">{m.totalReceivables > EPS ? `${(m.overdueShare * 100).toFixed(0)}% of receivables` : "—"}</span>}
                icon={<IconBanknote className="h-5 w-5" />}
                accent="amber"
              />
            </Link>
            <Link href="/receipts" className="block">
              <KpiCard
                label="Collected This Month"
                value={inrCompact(m.collectedThisMonth)}
                sub={
                  m.collectedMoM !== null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <TrendChip pct={m.collectedMoM} goodWhenUp />
                      <span>vs last month</span>
                    </span>
                  ) : (
                    "no receipts last month"
                  )
                }
                icon={<IconCalendar className="h-5 w-5" />}
                accent="emerald"
              />
            </Link>
            <Link href="/invoices" className="block">
              <KpiCard
                label="Collection Efficiency"
                value={`${(m.efficiency * 100).toFixed(1)}%`}
                sub={
                  <span className={m.efficiency >= 0.7 ? "text-emerald-500 dark:text-emerald-400" : m.efficiency >= 0.4 ? "text-amber-500 dark:text-amber-400" : "text-red-500 dark:text-red-400"}>
                    collected vs billed, all time
                  </span>
                }
                icon={<IconReceipt className="h-5 w-5" />}
                accent="violet"
              />
            </Link>
            <Link href="/invoices" className="block">
              <KpiCard label="Open Invoices" value={m.openCount} sub={`${m.invoicedThisMonth} raised this month`} icon={<IconReceipt className="h-5 w-5" />} accent="brand" />
            </Link>
            <Link href="/invoices" className="block">
              <KpiCard label="Overdue Invoices" value={m.overdueCount} sub={<span className="text-red-500 dark:text-red-400">need follow-up</span>} icon={<IconCalendar className="h-5 w-5" />} accent="amber" />
            </Link>
            <Link href="/receipts" className="block">
              <KpiCard
                label="Avg Collection Days"
                value={`${m.avgCollectionDays.toFixed(0)}d`}
                sub={
                  <span className="inline-flex items-center gap-1.5">
                    <TrendChip pct={m.avgCreditDays > 0 ? ((m.avgCollectionDays - m.avgCreditDays) / m.avgCreditDays) * 100 : 0} goodWhenUp={false} />
                    <span>vs ~{m.avgCreditDays.toFixed(0)}d credit terms</span>
                  </span>
                }
                icon={<IconCalendar className="h-5 w-5" />}
                accent="emerald"
              />
            </Link>
            <Link href="/masters/customers" className="block">
              <KpiCard label="Customers with Dues" value={m.customersWithDues} sub={`of ${m.totalCustomers} customers`} icon={<IconWallet className="h-5 w-5" />} accent="violet" />
            </Link>
          </>
        )}
      </div>

      {/* ---- charts row A: trend + status ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {loading ? (
          <>
            <div className="lg:col-span-2"><ChartSkeleton /></div>
            <ChartSkeleton />
          </>
        ) : (
          <>
            <Widget
              title="Monthly Collections"
              subtitle={`Money received, last ${trendRange} months`}
              className="lg:col-span-2"
              collapsed={!!collapsed["trend"]}
              onToggle={() => toggleWidget("trend")}
              action={
                <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                  {([6, 12] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cx(
                        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                        trendRange === r ? "bg-brand text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      )}
                    >
                      {r}M
                    </button>
                  ))}
                </div>
              }
            >
              <CollectionsLine points={trendPoints} dark={dark} />
            </Widget>
            <Widget
              title="Invoice Status"
              subtitle="All invoices, live status — click a row to open the list"
              collapsed={!!collapsed["status"]}
              onToggle={() => toggleWidget("status")}
            >
              <StatusDonut slices={m.statusSlices} colors={statusColors} />
            </Widget>
          </>
        )}
      </div>

      {/* ---- charts row B: ageing + top customers ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {loading ? (
          <>
            <ChartSkeleton />
            <ChartSkeleton />
          </>
        ) : (
          <>
            <Widget
              title="AR Ageing"
              subtitle="Outstanding by how overdue — click a bucket for the full report"
              collapsed={!!collapsed["ageing"]}
              onToggle={() => toggleWidget("ageing")}
            >
              <HBarList
                rows={AGEING_LABELS.map((label, i) => ({
                  label,
                  value: m.buckets[i],
                  sub: `${m.bucketCounts[i]} invoice${m.bucketCounts[i] === 1 ? "" : "s"}`,
                  href: "/reports/ageing",
                }))}
                colorFor={(i) => ageingColors[i]}
              />
            </Widget>
            <Widget
              title="Top Outstanding Customers"
              subtitle="Largest exposures first — click through to their statement"
              collapsed={!!collapsed["topcust"]}
              onToggle={() => toggleWidget("topcust")}
            >
              <HBarList rows={m.topCustomers.map((r) => ({ ...r, href: "/reports/statement" }))} colorFor={() => (dark ? "#60a5fa" : "#2f6bff")} />
            </Widget>
          </>
        )}
      </div>

      {/* ---- priorities + quick actions ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Widget
          title="Today's Collection Priorities"
          subtitle="Who to chase first — sorted by collection impact (amount × how late)"
          className="lg:col-span-2"
          collapsed={!!collapsed["priorities"]}
          onToggle={() => toggleWidget("priorities")}
          bodyClassName="p-0"
        >
          {loading ? (
            <div className="p-6"><Skeleton className="h-40 w-full" /></div>
          ) : m.priorities.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">No overdue customers — nothing to chase today. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-left dark:border-slate-800 dark:bg-slate-800/60">
                    {["Customer", "Outstanding", "Days Overdue", "Priority", "Suggested Action"].map((h, i) => (
                      <th key={h} className={cx("whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400", i === 1 && "text-right", i === 2 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.priorities.map((p) => (
                    <tr key={p.customerId} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-brand/[0.03] dark:border-slate-800 dark:hover:bg-brand/[0.08]">
                      <td className="px-4 py-3">
                        <Link href="/reports/statement" className="flex items-center gap-2.5">
                          <Avatar name={p.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                            <span className="block text-xs text-slate-400 dark:text-slate-500">
                              {p.invoiceCount} overdue invoice{p.invoiceCount === 1 ? "" : "s"}
                              {p.onAccount > EPS && ` · ${inrCompact(p.onAccount)} on account`}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{inr(p.outstanding)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{p.daysOverdue}d</td>
                      <td className="px-4 py-3">
                        <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", PRIORITY_CHIP[p.priority])}>{p.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={p.action.href}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-brand hover:bg-brand/[0.05] hover:text-brand dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand dark:hover:text-blue-300"
                        >
                          {p.action.label === "Call Customer" && <IconPhone className="h-3.5 w-3.5" />}
                          {p.action.label}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Widget>

        <Widget title="Quick Actions" collapsed={!!collapsed["actions"]} onToggle={() => toggleWidget("actions")}>
          <div className="grid gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-700 transition-all hover:border-brand hover:bg-brand/[0.04] hover:text-brand dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand dark:hover:text-blue-300"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-brand/10 text-brand dark:bg-brand/20 dark:text-blue-300">{a.icon}</span>
                {a.label}
              </Link>
            ))}
          </div>
        </Widget>
      </div>

      {/* ---- attention + smart insights ---- */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Widget
          title="Overdue Invoices Requiring Attention"
          subtitle="Largest overdue balances first — click through to the invoice"
          className="lg:col-span-2"
          collapsed={!!collapsed["attention"]}
          onToggle={() => toggleWidget("attention")}
          bodyClassName="p-0"
        >
          {loading ? (
            <div className="p-6"><Skeleton className="h-40 w-full" /></div>
          ) : m.attention.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">Nothing overdue — the book is clean. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-left dark:border-slate-800 dark:bg-slate-800/60">
                    {["Invoice", "Customer", "Due Date", "Days Overdue", "Outstanding"].map((h, i) => (
                      <th key={h} className={cx("whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400", i >= 3 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.attention.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/invoices/${r.id}`)}
                      className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-brand/[0.03] dark:border-slate-800 dark:hover:bg-brand/[0.08]"
                    >
                      <td className="px-4 py-3 font-semibold text-brand">{r.invoice_no}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.customerName}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{fmtDate(r.due_date)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                          {r.daysOverdue}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{inr(r.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Widget>

        <Widget title="Smart Insights" subtitle="Computed from the live book" collapsed={!!collapsed["insights"]} onToggle={() => toggleWidget("insights")}>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ul className="space-y-3 text-sm">
              {m.largestOverdueCustomer && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-red-500" />
                  <span className="text-slate-600 dark:text-slate-300">
                    <Link href="/reports/statement" className="font-semibold text-slate-900 hover:text-brand dark:text-white dark:hover:text-blue-300">{m.largestOverdueCustomer.name}</Link> owes the most overdue money — {inr(m.largestOverdueCustomer.value)}.
                  </span>
                </li>
              )}
              {m.biggestInvoice && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-amber-500" />
                  <span className="text-slate-600 dark:text-slate-300">
                    Largest unpaid invoice: <Link href={`/invoices/${m.biggestInvoice.id}`} className="font-semibold text-slate-900 hover:text-brand dark:text-white dark:hover:text-blue-300">{m.biggestInvoice.invoice_no}</Link> ({m.biggestInvoice.customerName}) at {inr(m.biggestInvoice.outstanding)}.
                  </span>
                </li>
              )}
              {m.topCustomers[0] && m.topShare > EPS && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-brand" />
                  <span className="text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-white">{m.topCustomers[0].label}</span> holds {(m.topShare * 100).toFixed(0)}% of all receivables.
                  </span>
                </li>
              )}
              {m.dueSoonCount > 0 && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-violet-500" />
                  <span className="text-slate-600 dark:text-slate-300">
                    <Link href="/invoices" className="font-semibold text-slate-900 hover:text-brand dark:text-white dark:hover:text-blue-300">{inr(m.dueSoonAmount)}</Link> across {m.dueSoonCount} invoice{m.dueSoonCount === 1 ? "" : "s"} falls due in the next 7 days.
                  </span>
                </li>
              )}
              {m.totalReceivables > EPS && (
                <li className="flex gap-2.5">
                  <span className={cx("mt-1.5 h-2 w-2 flex-none rounded-full", m.overdueShare > 0.5 ? "bg-red-500" : "bg-emerald-500")} />
                  <span className="text-slate-600 dark:text-slate-300">
                    <Link href="/reports/ageing" className="font-semibold text-slate-900 hover:text-brand dark:text-white dark:hover:text-blue-300">{(m.overdueShare * 100).toFixed(0)}%</Link> of the book is overdue.
                  </span>
                </li>
              )}
              {m.nearLimit.length > 0 && (
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-amber-500" />
                  <span className="text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-white">{m.nearLimit[0].name}</span>
                    {m.nearLimit.length > 1 ? ` and ${m.nearLimit.length - 1} other${m.nearLimit.length > 2 ? "s" : ""}` : ""} at ≥80% of credit limit.
                  </span>
                </li>
              )}
              <li className="flex gap-2.5">
                <span className={cx("mt-1.5 h-2 w-2 flex-none rounded-full", m.collectedThisMonth >= m.collectedLastMonth ? "bg-emerald-500" : "bg-red-500")} />
                <span className="text-slate-600 dark:text-slate-300">
                  Collections this month {inr(m.collectedThisMonth)} vs {inr(m.collectedLastMonth)} last month
                  {m.collectedMoM !== null ? ` (${m.collectedMoM >= 0 ? "+" : ""}${m.collectedMoM.toFixed(1)}%).` : "."}
                </span>
              </li>
            </ul>
          )}
        </Widget>
      </div>

      {/* ---- recent activity ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Widget title="Recent Invoices" subtitle="Latest 5 raised" collapsed={!!collapsed["recentinv"]} onToggle={() => toggleWidget("recentinv")} bodyClassName="p-3">
          {loading ? (
            <Skeleton className="m-3 h-40 w-full" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {m.recentInvoices.map((r) => (
                <li key={r.id}>
                  <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-brand/[0.03] dark:hover:bg-brand/[0.08]">
                    <Avatar name={r.customerName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-brand">{r.invoice_no}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{r.customerName}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{inr(Number(r.total))}</span>
                    <StatusBadge status={r.effStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Widget>

        <Widget title="Recent Receipts" subtitle="Latest 5 received" collapsed={!!collapsed["recentrcpt"]} onToggle={() => toggleWidget("recentrcpt")} bodyClassName="p-3">
          {loading ? (
            <Skeleton className="m-3 h-40 w-full" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {m.recentReceipts.map((r) => (
                <li key={r.id}>
                  <Link href={`/receipts/${r.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-brand/[0.03] dark:hover:bg-brand/[0.08]">
                    <Avatar name={r.customerName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-brand">{r.receipt_no}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{r.customerName}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{inr(Number(r.amount))}</span>
                    <ModeBadge mode={r.mode} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Widget>
      </div>
    </>
  );
}
