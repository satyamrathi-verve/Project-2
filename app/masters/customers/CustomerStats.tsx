/*
  Customer Stats — compact insights strip shown above the Customer Master
  table. Everything here is derived from customer master data already on the
  page, EXCEPT "Top 5 by Transaction Amount" below, which reads invoice
  totals (the only place "transaction amount" exists) — that one card fetches
  from the `invoices` table via the shared lib/supabase.ts client, read-only.
  Nothing here is ever saved back to Supabase.
*/
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, KpiCard, IconUsers, IconMail, IconPhone, IconFile, IconWallet, IconCalendar } from "@/components/ui";
import { Badge } from "@/components/Badge";
import type { Customer } from "@/lib/types";
import {
  computeSummaryCounts,
  computeDataQuality,
  topByTransactionAmount,
  recentlyAdded,
  formatCreatedDate,
} from "./customerStatsCalc";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function CustomerStats({ customers }: { customers: Customer[] }) {
  const summary = computeSummaryCounts(customers);
  const quality = computeDataQuality(customers);
  const recent5 = recentlyAdded(customers, 5);

  // Sum of invoice totals per customer, used only to rank "Top 5 by
  // Transaction Amount" below. `null` = still loading, a string = failed.
  const [transactionTotals, setTransactionTotals] = useState<Record<string, number> | null>(null);
  const [transactionTotalsError, setTransactionTotalsError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    async function loadTotals() {
      const { data, error } = await supabase!.from("invoices").select("customer_id, total");
      if (cancelled) return;
      if (error) {
        setTransactionTotalsError(error.message);
        return;
      }
      const totals: Record<string, number> = {};
      (data ?? []).forEach((inv: { customer_id: string; total: number }) => {
        totals[inv.customer_id] = (totals[inv.customer_id] ?? 0) + (inv.total ?? 0);
      });
      setTransactionTotals(totals);
    }
    loadTotals();
    return () => {
      cancelled = true;
    };
  }, []);

  const top5 = transactionTotals ? topByTransactionAmount(customers, transactionTotals, 5) : [];

  return (
    <div className="mb-6 space-y-4">
      {/* 1. Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Customers" value={summary.total} icon={<IconUsers className="h-4 w-4" />} accent="brand" />
        <KpiCard
          label="With Email"
          value={summary.withEmail}
          sub={`${summary.total - summary.withEmail} missing`}
          icon={<IconMail className="h-4 w-4" />}
          accent="emerald"
        />
        <KpiCard
          label="With Phone"
          value={summary.withPhone}
          sub={`${summary.total - summary.withPhone} missing`}
          icon={<IconPhone className="h-4 w-4" />}
          accent="emerald"
        />
        <KpiCard
          label="With GSTIN"
          value={summary.withGstin}
          sub={`${summary.total - summary.withGstin} missing`}
          icon={<IconFile className="h-4 w-4" />}
          accent="violet"
        />
        <KpiCard
          label="With PAN"
          value={summary.withPan}
          sub={`${summary.total - summary.withPan} missing`}
          icon={<IconFile className="h-4 w-4" />}
          accent="amber"
        />
        <KpiCard
          label="With Credit Limit"
          value={summary.withCreditLimit}
          sub={`${summary.total - summary.withCreditLimit} at ₹0`}
          icon={<IconWallet className="h-4 w-4" />}
          accent="brand"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 2. Top 5 by total turnover (lifetime sum of invoice totals) */}
        <Card
          title="Top 5 Customers"
          subtitle="Ranked by total turnover (sum of all invoices to date)"
          bodyClassName="!p-0"
        >
          {transactionTotalsError ? (
            <p className="px-6 py-5 text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t load turnover totals: {transactionTotalsError}
            </p>
          ) : !transactionTotals ? (
            <p className="px-6 py-5 text-sm text-slate-400 dark:text-slate-500">Loading turnover totals…</p>
          ) : top5.length === 0 ? (
            <p className="px-6 py-5 text-sm text-slate-400 dark:text-slate-500">No customers yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-6 py-2.5">#</th>
                  <th className="px-2 py-2.5">Code</th>
                  <th className="px-2 py-2.5">Name</th>
                  <th className="px-2 py-2.5 text-right">Total Turnover</th>
                  <th className="px-6 py-2.5 text-right">Credit Limit</th>
                </tr>
              </thead>
              <tbody>
                {top5.map(({ customer: c, transactionTotal }, i) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                    <td className="px-6 py-2.5 text-slate-400 dark:text-slate-500">{i + 1}</td>
                    <td className="px-2 py-2.5 font-medium text-slate-900 dark:text-white">{c.code}</td>
                    <td className="max-w-[160px] truncate px-2 py-2.5 text-slate-700 dark:text-slate-300">{c.name}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {currency.format(transactionTotal)}
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {currency.format(c.credit_limit ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* 3. Recently added customers */}
        <Card title="Recently Added Customers" subtitle="Newest first, by created date" bodyClassName="!p-0">
          {recent5.length === 0 ? (
            <p className="px-6 py-5 text-sm text-slate-400 dark:text-slate-500">No customers yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-6 py-2.5">Code</th>
                  <th className="px-2 py-2.5">Name</th>
                  <th className="px-2 py-2.5">Contact</th>
                  <th className="px-2 py-2.5">Email</th>
                  <th className="px-6 py-2.5 text-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {recent5.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                    <td className="px-6 py-2.5 font-medium text-slate-900 dark:text-white">{c.code}</td>
                    <td className="max-w-[140px] truncate px-2 py-2.5 text-slate-700 dark:text-slate-300">{c.name}</td>
                    <td className="max-w-[120px] truncate px-2 py-2.5 text-slate-500 dark:text-slate-400">
                      {c.contact_person || "—"}
                    </td>
                    <td className="max-w-[140px] truncate px-2 py-2.5 text-slate-500 dark:text-slate-400">
                      {c.email || "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <IconCalendar className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                        {formatCreatedDate(c.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* 4. Data quality */}
      <Card title="Customer Data Quality" subtitle="Records missing a field, out of the current customer list">
        <div className="flex flex-wrap gap-2">
          <Badge label={`Missing Email: ${quality.missingEmail}`} tone={quality.missingEmail ? "amber" : "emerald"} />
          <Badge label={`Missing Phone: ${quality.missingPhone}`} tone={quality.missingPhone ? "amber" : "emerald"} />
          <Badge label={`Missing GSTIN: ${quality.missingGstin}`} tone={quality.missingGstin ? "amber" : "emerald"} />
          <Badge label={`Missing PAN: ${quality.missingPan}`} tone={quality.missingPan ? "amber" : "emerald"} />
          <Badge label={`Missing Address: ${quality.missingAddress}`} tone={quality.missingAddress ? "amber" : "emerald"} />
        </div>
      </Card>
    </div>
  );
}
