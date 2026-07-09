"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Receipt, ReceiptMode } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { NotConfigured } from "@/components/NotConfigured";
import { useColumnCustomizer, ColumnSettingsTrigger } from "@/components/useColumnCustomizer";
import {
  Avatar,
  KpiCard,
  KpiSkeleton,
  ModeBadge,
  TableSkeleton,
  IconReceipt,
  IconBanknote,
  IconCalendar,
  IconWallet,
  IconSearch,
  IconPlus,
  inr,
  inrCompact,
} from "@/components/ui";

/*
  Screen 8 — Receipt List (default /receipts).
  Read-only dashboard of all receipts with KPIs, search, filter, sort,
  row selection, and a customize-columns popup (choices persist in
  localStorage). Reads only (receipts + customers + receipt_allocations);
  no writes here.
*/

const EPS = 0.005;

interface ReceiptRow extends Receipt {
  customerName: string;
  customerCode: string;
  allocated: number;
  unallocated: number;
}

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

// ---- customizable columns ---------------------------------------------------
type ColKey = "receipt_no" | "receipt_date" | "customer" | "mode" | "amount" | "allocation" | "reference";

const COLUMN_DEFS: { key: ColKey; label: string }[] = [
  { key: "receipt_no", label: "Receipt Number" },
  { key: "receipt_date", label: "Receipt Date" },
  { key: "customer", label: "Customer Name" },
  { key: "mode", label: "Payment Mode" },
  { key: "amount", label: "Amount" },
  { key: "allocation", label: "Allocation Status" },
  { key: "reference", label: "Reference Number" },
];

const COLS_STORAGE_KEY = "receipts.visibleColumns.v1";

export default function ReceiptListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | ReceiptMode>("all");
  const [sort, setSort] = useState<SortKey>("date_desc");

  // Row selection (presentation state only).
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Column show/hide, persisted per-device — shared with every other list
  // screen via useColumnCustomizer (originally built here, factored out).
  const { orderedKeys, openCustomizeModal, requestReset, overlay: columnOverlay } = useColumnCustomizer(
    COLUMN_DEFS,
    COLS_STORAGE_KEY
  );

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const [{ data: receipts, error: e1 }, { data: customers, error: e2 }, { data: allocs, error: e3 }] =
        await Promise.all([
          supabase!.from("receipts").select("*").order("receipt_date", { ascending: false }),
          supabase!.from("customers").select("id, code, name"),
          supabase!.from("receipt_allocations").select("receipt_id, amount"),
        ]);
      if (e1 || e2 || e3) {
        setError((e1 || e2 || e3)!.message);
        setLoading(false);
        return;
      }
      const custMap = new Map((customers as Pick<Customer, "id" | "code" | "name">[]).map((c) => [c.id, c]));
      const allocMap: Record<string, number> = {};
      for (const a of (allocs as { receipt_id: string; amount: number }[]) ?? []) {
        allocMap[a.receipt_id] = (allocMap[a.receipt_id] ?? 0) + Number(a.amount);
      }
      const built: ReceiptRow[] = (receipts as Receipt[]).map((r) => {
        const cust = custMap.get(r.customer_id);
        const allocated = allocMap[r.id] ?? 0;
        return {
          ...r,
          customerName: cust?.name ?? "Unknown customer",
          customerCode: cust?.code ?? "—",
          allocated,
          unallocated: Number(r.amount) - allocated,
        };
      });
      setRows(built);
      setLoading(false);
    })();
  }, []);

  // ---- KPIs ----------------------------------------------------------------
  const kpis = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
    const monthRows = rows.filter((r) => (r.receipt_date ?? "").startsWith(ym));
    const monthAmount = monthRows.reduce((s, r) => s + Number(r.amount), 0);
    const unallocated = rows.reduce((s, r) => s + Math.max(0, r.unallocated), 0);
    return {
      count: rows.length,
      totalAmount,
      monthCount: monthRows.length,
      monthAmount,
      unallocated,
    };
  }, [rows]);

  // ---- filter + sort -------------------------------------------------------
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (modeFilter !== "all" && r.mode !== modeFilter) return false;
      if (!q) return true;
      return (
        r.receipt_no.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        (r.reference ?? "").toLowerCase().includes(q)
      );
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "date_asc":
          return a.receipt_date.localeCompare(b.receipt_date);
        case "amount_desc":
          return Number(b.amount) - Number(a.amount);
        case "amount_asc":
          return Number(a.amount) - Number(b.amount);
        default:
          return b.receipt_date.localeCompare(a.receipt_date);
      }
    });
    return out;
  }, [rows, search, modeFilter, sort]);

  // NOTE: `sortable` here only turns on the up/down header indicators. Clicking
  // is wired to a no-op below — sorting logic is intentionally not implemented yet.
  const allColumns: Record<ColKey, Column<ReceiptRow>> = {
    receipt_no: {
      key: "receipt_no",
      header: "Receipt #",
      sortable: true,
      render: (r) => (
        <Link
          href={`/receipts/${r.id}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded font-semibold text-brand transition-colors hover:text-brand-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:hover:text-blue-300"
        >
          {r.receipt_no}
        </Link>
      ),
    },
    receipt_date: {
      key: "receipt_date",
      header: "Date",
      sortable: true,
      render: (r) => <span className="text-slate-600 dark:text-slate-300">{r.receipt_date}</span>,
    },
    customer: {
      key: "customer",
      header: "Customer",
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-3">
          <Avatar name={r.customerName} size="sm" />
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">{r.customerName}</span>
        </span>
      ),
    },
    mode: { key: "mode", header: "Mode", sortable: true, render: (r) => <ModeBadge mode={r.mode} /> },
    amount: {
      key: "amount",
      header: "Amount",
      className: "text-right",
      sortable: true,
      render: (r) => <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{inr(Number(r.amount))}</span>,
    },
    allocation: {
      key: "allocation",
      header: "Allocation",
      className: "text-right",
      sortable: true,
      render: (r) =>
        r.unallocated > EPS ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
            {inr(r.unallocated)} on account
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
            Fully allocated
          </span>
        ),
    },
    reference: {
      key: "reference",
      header: "Reference #",
      sortable: true,
      render: (r) =>
        r.reference ? (
          <span className="text-slate-600 dark:text-slate-300">{r.reference}</span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        ),
    },
  };

  const columns = orderedKeys.map((k) => allColumns[k]);

  const customizeButton = <ColumnSettingsTrigger onCustomize={openCustomizeModal} onReset={requestReset} />;

  const newButton = (
    <Link
      href="/receipts/new"
      className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark hover:shadow"
    >
      <IconPlus className="h-4 w-4" />
      New Receipt
    </Link>
  );

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Receipts" subtitle="Money received from customers." action={newButton} />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Track money received and how it's been allocated across invoices."
        action={newButton}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>
      )}

      {/* KPIs */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard label="Total Receipts" value={kpis.count} sub="all time" icon={<IconReceipt className="h-5 w-5" />} accent="brand" />
            <KpiCard label="Total Received" value={inrCompact(kpis.totalAmount)} sub={inr(kpis.totalAmount)} icon={<IconBanknote className="h-5 w-5" />} accent="emerald" />
            <KpiCard label="This Month" value={kpis.monthCount} sub={inr(kpis.monthAmount)} icon={<IconCalendar className="h-5 w-5" />} accent="violet" />
            <KpiCard label="Unallocated" value={inrCompact(kpis.unallocated)} sub="on-account balance" icon={<IconWallet className="h-5 w-5" />} accent="amber" />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt, customer, reference…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as "all" | ReceiptMode)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
          >
            <option value="all">All modes</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="upi">UPI</option>
            <option value="neft">NEFT</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:[color-scheme:dark]"
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Amount: high → low</option>
            <option value="amount_asc">Amount: low → high</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand dark:bg-brand/20 dark:text-blue-300">
            <IconReceipt className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-white">No receipts yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Record money received from a customer and allocate it against their open invoices.
          </p>
          <Link
            href="/receipts/new"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark"
          >
            <IconPlus className="h-4 w-4" />
            New Receipt
          </Link>
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={visible}
            stickyHeader
            onRowClick={(r) => router.push(`/receipts/${r.id}`)}
            selectable
            selectedIds={selected}
            onSelectionChange={(ids) => setSelected(new Set(ids))}
            headerAccessory={customizeButton}
            /* Shows the sort indicators; sorting itself is not wired yet. */
            onSortChange={() => {}}
            empty="No receipts match your search."
          />
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Showing {visible.length} of {rows.length} receipts
            {selected.size > 0 && (
              <span className="font-medium text-brand"> · {selected.size} selected</span>
            )}
            {" · "}click a row for details
          </p>
        </>
      )}

      {columnOverlay}
    </>
  );
}
