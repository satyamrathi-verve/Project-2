/*
  Customer Stats — pure calculations for the compact insights section on
  Customer Master. Everything here reads only the `customers` rows already
  loaded on the page (fields from lib/types.ts's Customer). No invoices,
  receipts, ageing or collection data is used, and nothing is written back
  to Supabase — these are frontend-only derived numbers.
*/
import type { Customer } from "@/lib/types";

// A field counts as "present" once trimmed of whitespace — blank strings in
// the database should count the same as null.
function has(value: string | null | undefined): boolean {
  return Boolean(value && value.trim() !== "");
}

export interface CustomerSummaryCounts {
  total: number;
  withEmail: number;
  withPhone: number;
  withGstin: number;
  withPan: number;
  withCreditLimit: number;
}

export function computeSummaryCounts(customers: Customer[]): CustomerSummaryCounts {
  return {
    total: customers.length,
    withEmail: customers.filter((c) => has(c.email)).length,
    withPhone: customers.filter((c) => has(c.phone)).length,
    withGstin: customers.filter((c) => has(c.gstin)).length,
    withPan: customers.filter((c) => has(c.pan)).length,
    withCreditLimit: customers.filter((c) => (c.credit_limit ?? 0) > 0).length,
  };
}

export interface DataQualityCounts {
  missingEmail: number;
  missingPhone: number;
  missingGstin: number;
  missingPan: number;
  missingAddress: number;
}

// "Missing" is simply total minus present, so the two sections always add up.
export function computeDataQuality(customers: Customer[]): DataQualityCounts {
  const total = customers.length;
  return {
    missingEmail: total - customers.filter((c) => has(c.email)).length,
    missingPhone: total - customers.filter((c) => has(c.phone)).length,
    missingGstin: total - customers.filter((c) => has(c.gstin)).length,
    missingPan: total - customers.filter((c) => has(c.pan)).length,
    missingAddress: total - customers.filter((c) => has(c.address)).length,
  };
}

export interface RankedByTransaction {
  customer: Customer;
  transactionTotal: number;
}

// Highest total invoice amount first. `totalsByCustomerId` is the sum of each
// customer's invoice totals, computed by the caller from the `invoices` table
// (the only place "transaction amount" actually lives — it isn't a field on
// the customer master row itself).
export function topByTransactionAmount(
  customers: Customer[],
  totalsByCustomerId: Record<string, number>,
  count = 5
): RankedByTransaction[] {
  return customers
    .map((c) => ({ customer: c, transactionTotal: totalsByCustomerId[c.id] ?? 0 }))
    .sort((a, b) => b.transactionTotal - a.transactionTotal)
    .slice(0, count);
}

// Newest `created_at` first. Customers without a created_at are pushed to
// the end rather than dropped, since the column is expected to always be set.
export function recentlyAdded(customers: Customer[], count = 5): Customer[] {
  return [...customers]
    .sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : -Infinity;
      const bt = b.created_at ? new Date(b.created_at).getTime() : -Infinity;
      return bt - at;
    })
    .slice(0, count);
}

export type QuickFilterKey =
  | "all"
  | "with_email"
  | "missing_email"
  | "missing_phone"
  | "missing_gstin"
  | "with_credit_limit";

export const QUICK_FILTERS: { key: QuickFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "with_email", label: "With Email" },
  { key: "missing_email", label: "Missing Email" },
  { key: "missing_phone", label: "Missing Phone" },
  { key: "missing_gstin", label: "Missing GSTIN" },
  { key: "with_credit_limit", label: "With Credit Limit" },
];

export function applyQuickFilter(customers: Customer[], key: QuickFilterKey): Customer[] {
  switch (key) {
    case "with_email":
      return customers.filter((c) => has(c.email));
    case "missing_email":
      return customers.filter((c) => !has(c.email));
    case "missing_phone":
      return customers.filter((c) => !has(c.phone));
    case "missing_gstin":
      return customers.filter((c) => !has(c.gstin));
    case "with_credit_limit":
      return customers.filter((c) => (c.credit_limit ?? 0) > 0);
    case "all":
    default:
      return customers;
  }
}

export function formatCreatedDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
