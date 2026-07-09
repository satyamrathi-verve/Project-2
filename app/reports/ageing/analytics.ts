import type { Customer, Invoice, ReceiptAllocation } from "@/lib/types";

/*
  All the AR Ageing report's number-crunching lives here, kept apart from the
  screen's JSX on purpose so the calculations can be read (and trusted) on
  their own, and reused by the Age Matrix / Risk Matrix sections without
  copy-pasting the ageing logic a second time. Nothing here talks to Supabase —
  it only transforms the rows the page already fetched.
*/

export type BucketKey = "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const BUCKET_ORDER: BucketKey[] = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"];

export const BUCKET_LABELS: Record<BucketKey, string> = {
  not_due: "Not Due",
  d1_30: "1–30 Days",
  d31_60: "31–60 Days",
  d61_90: "61–90 Days",
  d90_plus: "Above 90 Days",
};

// Traffic-light severity colours, reused everywhere a bucket needs a background
// (the Age Matrix cells). Intensity increases with age, light and dark variants
// both provided so the report stays readable in either theme.
export const BUCKET_COLORS: Record<BucketKey, string> = {
  not_due: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  d1_30: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  d31_60: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  d61_90: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  d90_plus: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200",
};

export const EMPTY_BUCKETS: Record<BucketKey, number> = {
  not_due: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// How many whole days "as on date" is past the invoice's due date.
// 0 (or negative) means the invoice isn't due yet.
export function ageingDaysFor(asOnDate: string, dueDate: string): number {
  const ms = Date.parse(asOnDate) - Date.parse(dueDate);
  return Math.round(ms / 86400000);
}

export function bucketFor(ageingDays: number): BucketKey {
  if (ageingDays <= 0) return "not_due";
  if (ageingDays <= 30) return "d1_30";
  if (ageingDays <= 60) return "d31_60";
  if (ageingDays <= 90) return "d61_90";
  return "d90_plus";
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface InvoiceRow {
  id: string;
  customerId: string;
  customerName: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  amountReceived: number;
  outstanding: number;
  ageingDays: number;
  bucket: BucketKey;
  status: "Paid" | "Current" | "Overdue";
}

/**
 * One row per invoice: outstanding = invoice total minus whatever's been
 * received against it (its receipt_allocations), ageing worked out against
 * the chosen "as on" date. This is the single source of truth every other
 * calculation below (and the page's existing tables) is built from.
 */
export function buildInvoiceRows(
  invoices: Invoice[],
  allocations: ReceiptAllocation[],
  customers: Customer[],
  asOnDate: string
): InvoiceRow[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const receivedByInvoice = new Map<string, number>();
  for (const a of allocations) {
    receivedByInvoice.set(a.invoice_id, (receivedByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount));
  }

  return invoices.map((inv) => {
    const received = receivedByInvoice.get(inv.id) ?? 0;
    const outstanding = Math.round((Number(inv.total) - received) * 100) / 100;
    const ageingDays = ageingDaysFor(asOnDate, inv.due_date);
    const status: InvoiceRow["status"] = outstanding <= 0 ? "Paid" : ageingDays <= 0 ? "Current" : "Overdue";
    return {
      id: inv.id,
      customerId: inv.customer_id,
      customerName: customerById.get(inv.customer_id)?.name ?? "Unknown customer",
      invoiceNo: inv.invoice_no,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      invoiceAmount: Number(inv.total),
      amountReceived: received,
      outstanding,
      ageingDays,
      bucket: bucketFor(ageingDays),
      status,
    };
  });
}

// ---- Age Matrix -------------------------------------------------------------

export interface BucketStat {
  amount: number;
  count: number;
  oldestInvoiceDate: string | null;
  maxAgeingDays: number;
  sumAgeingDays: number;
  largestOutstanding: number;
}

function emptyBucketStat(): BucketStat {
  return { amount: 0, count: 0, oldestInvoiceDate: null, maxAgeingDays: 0, sumAgeingDays: 0, largestOutstanding: 0 };
}

export interface CustomerMatrixRow {
  customerId: string;
  code: string;
  name: string;
  creditLimit: number;
  buckets: Record<BucketKey, BucketStat>;
  totalOutstanding: number;
  totalInvoiceCount: number;
  maxAgeingDays: number;
}

/**
 * Rolls invoice-wise rows up into one matrix row per customer, with full
 * detail (amount, count, oldest invoice, max/average ageing, largest single
 * invoice) kept per bucket — that detail is what the Age Matrix's hover
 * tooltip and the Risk Matrix are built from. Zero-outstanding (paid)
 * invoices are skipped; they don't represent any exposure to show here.
 */
export function buildAgeMatrix(invoiceRows: InvoiceRow[], customers: Customer[]): CustomerMatrixRow[] {
  const byCustomer = new Map<string, CustomerMatrixRow>();

  for (const row of invoiceRows) {
    if (row.outstanding <= 0) continue;
    let entry = byCustomer.get(row.customerId);
    if (!entry) {
      const customer = customers.find((c) => c.id === row.customerId);
      entry = {
        customerId: row.customerId,
        code: customer?.code ?? "—",
        name: row.customerName,
        creditLimit: customer?.credit_limit ?? 0,
        buckets: {
          not_due: emptyBucketStat(),
          d1_30: emptyBucketStat(),
          d31_60: emptyBucketStat(),
          d61_90: emptyBucketStat(),
          d90_plus: emptyBucketStat(),
        },
        totalOutstanding: 0,
        totalInvoiceCount: 0,
        maxAgeingDays: 0,
      };
      byCustomer.set(row.customerId, entry);
    }

    const stat = entry.buckets[row.bucket];
    stat.amount += row.outstanding;
    stat.count += 1;
    stat.sumAgeingDays += row.ageingDays;
    if (row.ageingDays > stat.maxAgeingDays) stat.maxAgeingDays = row.ageingDays;
    if (row.outstanding > stat.largestOutstanding) stat.largestOutstanding = row.outstanding;
    if (!stat.oldestInvoiceDate || row.invoiceDate < stat.oldestInvoiceDate) stat.oldestInvoiceDate = row.invoiceDate;

    entry.totalOutstanding += row.outstanding;
    entry.totalInvoiceCount += 1;
    if (row.ageingDays > entry.maxAgeingDays) entry.maxAgeingDays = row.ageingDays;
  }

  return Array.from(byCustomer.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}

// ---- Risk Matrix -------------------------------------------------------------

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export const RISK_ORDER: RiskLevel[] = ["Critical", "High", "Medium", "Low"];

export const RECOMMENDED_ACTION: Record<RiskLevel, string> = {
  Critical: "Escalate to AR Manager and prioritise collection",
  High: "Immediate phone follow-up",
  Medium: "Send reminder email",
  Low: "Continue normal follow-up",
};

// Same green→red severity language as the Age Matrix, so a risk level always
// means the same colour everywhere it appears on this report.
export const RISK_COLORS: Record<RiskLevel, { badge: string; bar: string; emoji: string }> = {
  Low: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30", bar: "bg-emerald-500", emoji: "🟢" },
  Medium: { badge: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30", bar: "bg-amber-500", emoji: "🟡" },
  High: { badge: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30", bar: "bg-orange-500", emoji: "🟠" },
  Critical: { badge: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30", bar: "bg-red-600", emoji: "🔴" },
};

/**
 * Risk level per customer, derived only from the ageing buckets above —
 * nothing new is stored or fetched.
 *
 *  - Critical: any balance is over 90 days overdue, OR the customer's total
 *    outstanding has crossed their credit limit (only when a limit is set),
 *    OR it's crossed the optional rupee threshold entered on screen.
 *  - High / Medium: compare only the 1–30 / 31–60 / 61–90 buckets (90+ is
 *    already handled above) and take whichever holds the most money — that's
 *    the "majority" bucket driving the risk. Largest in 61–90 => High,
 *    largest in 31–60 => Medium, largest in 1–30 (or nothing overdue) => Low.
 */
export function computeRiskLevel(row: CustomerMatrixRow, criticalThreshold: number | null): RiskLevel {
  const b = row.buckets;
  const creditLimitBreached = row.creditLimit > 0 && row.totalOutstanding > row.creditLimit;
  const thresholdBreached = !!criticalThreshold && criticalThreshold > 0 && row.totalOutstanding > criticalThreshold;
  if (b.d90_plus.amount > 0 || creditLimitBreached || thresholdBreached) return "Critical";

  const candidates: { level: RiskLevel; amount: number }[] = [
    { level: "High", amount: b.d61_90.amount },
    { level: "Medium", amount: b.d31_60.amount },
    { level: "Low", amount: b.d1_30.amount },
  ];
  const top = candidates.reduce((a, c) => (c.amount > a.amount ? c : a));
  return top.amount > 0 ? top.level : "Low";
}

// ---- Smart Collection Insights ----------------------------------------------

/**
 * Plain-English business insights, generated with simple front-end rules —
 * no AI service involved. Every number here is derived from the same
 * matrix/invoice rows the rest of the report uses.
 */
export function generateInsights(
  matrixRows: CustomerMatrixRow[],
  invoiceRows: InvoiceRow[],
  riskByCustomer: Map<string, RiskLevel>
): string[] {
  if (matrixRows.length === 0) return [];
  const insights: string[] = [];

  const totalOutstanding = matrixRows.reduce((s, r) => s + r.totalOutstanding, 0);
  const byOutstandingDesc = [...matrixRows].sort((a, b) => b.totalOutstanding - a.totalOutstanding);

  if (totalOutstanding > 0) {
    const topN = byOutstandingDesc.slice(0, Math.min(10, byOutstandingDesc.length));
    const topSum = topN.reduce((s, r) => s + r.totalOutstanding, 0);
    const pct = Math.round((topSum / totalOutstanding) * 100);
    insights.push(`Top ${topN.length} customer${topN.length === 1 ? "" : "s"} contribute ${pct}% of total outstanding.`);
  }

  const over90 = matrixRows.reduce((s, r) => s + r.buckets.d90_plus.amount, 0);
  if (over90 > 0) insights.push(`${formatCompactINR(over90)} is overdue for more than 90 days.`);

  if (byOutstandingDesc[0]) {
    insights.push(`${byOutstandingDesc[0].name} has the highest overdue balance.`);
  }

  const dueSoon = invoiceRows.filter((r) => r.outstanding > 0 && r.ageingDays <= 0 && r.ageingDays >= -7);
  if (dueSoon.length > 0) {
    insights.push(`${dueSoon.length} invoice${dueSoon.length === 1 ? " is" : "s are"} due within the next 7 days.`);
  }

  const immediateActionCount = matrixRows.filter((r) => {
    const level = riskByCustomer.get(r.customerId);
    return level === "High" || level === "Critical";
  }).length;
  if (immediateActionCount > 0) {
    insights.push(`${immediateActionCount} customer${immediateActionCount === 1 ? "" : "s"} require immediate collection action.`);
  }

  const overdueCountByCustomer = new Map<string, number>();
  for (const row of invoiceRows) {
    if (row.status === "Overdue") {
      overdueCountByCustomer.set(row.customerId, (overdueCountByCustomer.get(row.customerId) ?? 0) + 1);
    }
  }
  const manyOverdueCount = Array.from(overdueCountByCustomer.values()).filter((c) => c > 5).length;
  if (manyOverdueCount > 0) {
    insights.push(`${manyOverdueCount} customer${manyOverdueCount === 1 ? "" : "s"} have more than 5 overdue invoices.`);
  }

  const avgAgeing = matrixRows.reduce((s, r) => s + Math.max(r.maxAgeingDays, 0), 0) / matrixRows.length;
  insights.push(`Average customer ageing is ${Math.round(avgAgeing)} days.`);

  const largestInvoice = [...invoiceRows].filter((r) => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding)[0];
  if (largestInvoice) {
    insights.push(
      `Largest single outstanding invoice is ${formatCompactINR(largestInvoice.outstanding)} (${largestInvoice.invoiceNo}, ${largestInvoice.customerName}).`
    );
  }

  return insights;
}

/** Compact INR for dense cells and one-line insights: ₹8.50L, ₹1.20Cr, ₹42,000. */
export function formatCompactINR(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(2)}L`;
  return formatINR(amount);
}
