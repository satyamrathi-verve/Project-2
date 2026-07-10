"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { ColumnFilterMenu } from "@/components/ColumnFilter";
import { Pagination } from "@/components/Pagination";
import { ImportReceiptsModal } from "./ImportReceiptsModal";
import { exportReceiptsCsv, exportReceiptsXlsx, downloadReceiptSample, type ReceiptExportRow } from "@/lib/receiptIO";
import { useTableSort } from "@/lib/useTableSort";
import { sortRows, type SortColumn } from "@/lib/sortRows";
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

// How each column is read + compared when the header sort is applied. Uses the
// shared SortColumn shape so any list screen can describe its columns the same way.
const RECEIPT_SORT_COLUMNS: Record<string, SortColumn<ReceiptRow>> = {
  receipt_no: { accessor: (r) => r.receipt_no, type: "text" }, // alphanumeric
  receipt_date: { accessor: (r) => r.receipt_date, type: "date" }, // chronological
  customer: { accessor: (r) => r.customerName, type: "text" }, // alphabetical
  mode: { accessor: (r) => r.mode, type: "text" }, // alphabetical
  amount: { accessor: (r) => Number(r.amount), type: "number" }, // numeric
  allocation: { accessor: (r) => (r.unallocated > EPS ? "On account" : "Fully allocated"), type: "text" }, // alphabetical
  reference: { accessor: (r) => r.reference ?? "", type: "text" }, // alphanumeric
};

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
const PAGE_SIZE = 10;

// The display value used for a column's per-header value filter — both the
// checklist of distinct options and the row test compare against this string.
function cellValue(key: ColKey, r: ReceiptRow): string {
  switch (key) {
    case "receipt_no":
      return r.receipt_no;
    case "receipt_date":
      return r.receipt_date;
    case "customer":
      return r.customerName;
    case "mode":
      return r.mode.toUpperCase();
    case "amount":
      return inr(Number(r.amount));
    case "allocation":
      return r.unallocated > EPS ? "On account" : "Fully allocated";
    case "reference":
      return r.reference ?? "—";
  }
}

export default function ReceiptListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [customers, setCustomers] = useState<Pick<Customer, "id" | "code" | "name">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Column-header sort state. Sorting is driven entirely from the per-column
  // filter popups (Sort ascending / descending), applied in the `visible` memo.
  const { sort: columnSort, setSort: setColumnSort } = useTableSort();

  // Per-column value filters (Excel-style). A key present = only those values pass;
  // absent = no filter on that column.
  const [colFilters, setColFilters] = useState<Partial<Record<ColKey, Set<string>>>>({});
  const setColumnFilter = useCallback((key: ColKey, next: Set<string> | undefined) => {
    setColFilters((prev) => {
      const copy = { ...prev };
      if (next === undefined) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }, []);

  // Row selection (presentation state only).
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Column show/hide, persisted per-device — shared with every other list
  // screen via useColumnCustomizer (originally built here, factored out).
  const { orderedKeys, openCustomizeModal, requestReset, overlay: columnOverlay } = useColumnCustomizer(
    COLUMN_DEFS,
    COLS_STORAGE_KEY
  );

  // Extracted so the import modal can refresh the list after inserting rows.
  const loadData = useCallback(async () => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: receipts, error: e1 }, { data: custData, error: e2 }, { data: allocs, error: e3 }] =
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
    const custList = (custData as Pick<Customer, "id" | "code" | "name">[]) ?? [];
    setCustomers(custList);
    const custMap = new Map(custList.map((c) => [c.id, c]));
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
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lookups the import flow needs: customer code -> {id, name} and existing receipt numbers.
  const customerByCode = useMemo(
    () => new Map(customers.map((c) => [c.code.toLowerCase(), { id: c.id, name: c.name }])),
    [customers]
  );
  const existingReceiptNos = useMemo(() => new Set(rows.map((r) => r.receipt_no.toLowerCase())), [rows]);

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

  // Distinct values per column for the header filter checklists — computed from
  // the full dataset (not the filtered view) so every value stays selectable.
  const columnOptions = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const out = {} as Record<ColKey, string[]>;
    for (const { key } of COLUMN_DEFS) {
      const set = new Set<string>();
      for (const r of rows) set.add(cellValue(key, r));
      out[key] = Array.from(set).sort((a, b) => collator.compare(a, b));
    }
    return out;
  }, [rows]);

  // ---- filter + sort -------------------------------------------------------
  // Search + per-column value filters, then apply the active column sort. Memoised
  // so re-sorting/re-filtering is instant (no refetch) and only recomputes when a
  // dependency changes.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeFilters = Object.entries(colFilters) as [ColKey, Set<string>][];
    const filtered = rows.filter((r) => {
      if (q) {
        const match =
          r.receipt_no.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          (r.reference ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      for (const [key, set] of activeFilters) {
        if (!set.has(cellValue(key, r))) return false;
      }
      return true;
    });
    return sortRows(filtered, columnSort, RECEIPT_SORT_COLUMNS);
  }, [rows, search, colFilters, columnSort]);

  // ---- pagination (client-side, over the filtered + sorted rows) ----------
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Back to page 1 whenever the filter/search narrows the set.
  useEffect(() => setPage(1), [search, colFilters]);
  // Keep the page valid if the set shrinks for any other reason.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(visible.length / PAGE_SIZE))));
  }, [visible.length]);

  // Export the current (filtered) view.
  function handleExport(fmt: "csv" | "xlsx") {
    const exportRows: ReceiptExportRow[] = visible.map((r) => ({
      receipt_no: r.receipt_no,
      receipt_date: r.receipt_date,
      customerCode: r.customerCode,
      customerName: r.customerName,
      mode: r.mode,
      amount: Number(r.amount),
      allocated: r.allocated,
      unallocated: r.unallocated,
      reference: r.reference,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === "csv") exportReceiptsCsv(exportRows, `Receipts_${stamp}.csv`);
    else exportReceiptsXlsx(exportRows, `Receipts_${stamp}.xlsx`);
  }

  // Every column is sortable; clicking a header sets the sort state and reorders
  // rows via the `visible` memo (see RECEIPT_SORT_COLUMNS). Memoised so the column
  // definitions keep a stable identity across renders.
  const allColumns: Record<ColKey, Column<ReceiptRow>> = useMemo(() => ({
    receipt_no: {
      key: "receipt_no",
      header: "Receipt #",      render: (r) => (
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
      header: "Date",      render: (r) => <span className="text-slate-600 dark:text-slate-300">{r.receipt_date}</span>,
    },
    customer: {
      key: "customer",
      header: "Customer",      render: (r) => (
        <span className="flex items-center gap-3">
          <Avatar name={r.customerName} size="sm" />
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">{r.customerName}</span>
        </span>
      ),
    },
    mode: { key: "mode", header: "Mode", render: (r) => <ModeBadge mode={r.mode} /> },
    amount: {
      key: "amount",
      header: "Amount",
      className: "text-right",      render: (r) => <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{inr(Number(r.amount))}</span>,
    },
    allocation: {
      key: "allocation",
      header: "Allocation",
      className: "text-right",      render: (r) =>
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
      header: "Reference #",      render: (r) =>
        r.reference ? (
          <span className="text-slate-600 dark:text-slate-300">{r.reference}</span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        ),
    },
  }), []);

  // Attach the per-column sort + value filter popup to each header. Uses
  // DataTable's own funnel + popup (column.filter); the menu contents handle
  // sorting and value selection.
  const columns = useMemo(
    () =>
      orderedKeys.map((key) => {
        const base = allColumns[key];
        return {
          ...base,
          filterActive: colFilters[key] !== undefined,
          filter: (
            <ColumnFilterMenu
              options={columnOptions[key] ?? []}
              value={colFilters[key]}
              onChange={(next) => setColumnFilter(key, next)}
              sortDir={columnSort?.key === key ? columnSort.dir : undefined}
              onSortAsc={() => setColumnSort({ key, dir: "asc" })}
              onSortDesc={() => setColumnSort({ key, dir: "desc" })}
            />
          ),
        };
      }),
    [orderedKeys, allColumns, columnOptions, colFilters, columnSort, setColumnFilter, setColumnSort]
  );

  const customizeButton = <ColumnSettingsTrigger onCustomize={openCustomizeModal} onReset={requestReset} />;

  const actionItem =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60";

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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="flex-none text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Receipts</h1>
        <div className="relative w-full sm:w-80">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt, customer, reference…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="relative">
            <button
              type="button"
              aria-label="More actions"
              onClick={() => setActionsOpen((o) => !o)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
            {actionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActionsOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                  <button onClick={() => { setActionsOpen(false); setImportOpen(true); }} className={actionItem}>Import receipts…</button>
                  <button onClick={() => { setActionsOpen(false); handleExport("csv"); }} className={actionItem}>Export as CSV</button>
                  <button onClick={() => { setActionsOpen(false); handleExport("xlsx"); }} className={actionItem}>Export as Excel (.xlsx)</button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />
                  <button onClick={() => { setActionsOpen(false); downloadReceiptSample(); }} className={actionItem}>Download sample template</button>
                </div>
              </>
            )}
          </div>
          {newButton}
        </div>
      </div>

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
            rows={paged}
            stickyHeader
            onRowClick={(r) => router.push(`/receipts/${r.id}`)}
            selectable
            selectedIds={selected}
            onSelectionChange={(ids) => setSelected(new Set(ids))}
            headerAccessory={customizeButton}
            empty="No receipts match your search."
          />
          {pageCount > 1 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageCount={pageCount} onChange={setPage} />
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {visible.length > 0
              ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visible.length)} of ${visible.length} receipts`
              : "No receipts match your search"}
            {selected.size > 0 && <span className="font-medium text-brand"> · {selected.size} selected</span>}
            {visible.length > 0 && " · click a row for details"}
          </p>
        </>
      )}

      {columnOverlay}

      {importOpen && (
        <ImportReceiptsModal
          customerByCode={customerByCode}
          existingReceiptNos={existingReceiptNos}
          onClose={() => setImportOpen(false)}
          onImported={() => loadData()}
        />
      )}
    </>
  );
}
