"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { Badge, type BadgeTone } from "@/components/Badge";
import type { Customer, Invoice, Receipt, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";
import {
  aggregateCustomer,
  buildAllocatedMap,
  deriveCollectionStatus,
  formatCurrency,
  formatDate,
  todayISO,
  type CollectionStatus,
  type CustomerAggregate,
  type FollowUpEntry,
  type Priority,
  type PromiseToPay,
} from "@/lib/collections";
import { CustomerDrawer } from "./CustomerDrawer";

const PAGE_SIZE = 8;

interface CustomerRow {
  id: string;
  aggregate: CustomerAggregate;
  status: CollectionStatus;
  lastFollowUpDate: string | null;
  nextFollowUpDate: string | null;
  promiseDate: string | null;
}

const STATUS_TONE: Record<CollectionStatus, BadgeTone> = {
  "Fully Paid": "emerald",
  "No Follow-up": "slate",
  "Reminder Sent": "blue",
  "Promise to Pay": "blue",
  "Broken Promise": "rose",
  "Escalation Required": "rose",
};

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  High: "rose",
  Medium: "amber",
  Low: "slate",
};

export default function CollectionsWorkspacePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminderLog, setReminderLog] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Follow-up / Promise-to-Pay records: session-only, no table exists for these yet.
  const [followUps, setFollowUps] = useState<FollowUpEntry[]>([]);
  const [promises, setPromises] = useState<PromiseToPay[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CollectionStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [sort, setSort] = useState<SortState>({ key: "overdue", dir: "desc" });
  const [page, setPage] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    async function load() {
      const [c, i, r, a, t, l] = await Promise.all([
        supabase!.from("customers").select("*"),
        supabase!.from("invoices").select("*"),
        supabase!.from("receipts").select("*"),
        supabase!.from("receipt_allocations").select("*"),
        supabase!.from("reminder_templates").select("*"),
        supabase!.from("reminder_log").select("*"),
      ]);
      const firstError = [c, i, r, a, t, l].find((res) => res.error)?.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setCustomers(c.data ?? []);
        setInvoices(i.data ?? []);
        setReceipts(r.data ?? []);
        setAllocations(a.data ?? []);
        setTemplates(t.data ?? []);
        setReminderLog(l.data ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  const allocatedByInvoice = useMemo(() => buildAllocatedMap(allocations), [allocations]);
  const today = todayISO();

  const rows: CustomerRow[] = useMemo(() => {
    return customers.map((customer) => {
      const aggregate = aggregateCustomer(customer, invoices, allocatedByInvoice, receipts, today);
      const custInvoiceIds = new Set(invoices.filter((i) => i.customer_id === customer.id).map((i) => i.id));
      const hasReminderSent = reminderLog.some((log) => log.invoice_id && custInvoiceIds.has(log.invoice_id));
      const custFollowUps = followUps.filter((f) => f.customerId === customer.id);
      const custPromises = promises
        .filter((p) => p.customerId === customer.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const latestPromise = custPromises[0];
      const latestFollowUp = [...custFollowUps].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

      const status = deriveCollectionStatus(aggregate, latestPromise, hasReminderSent, custFollowUps.length > 0, today);

      return {
        id: customer.id,
        aggregate,
        status,
        lastFollowUpDate: latestFollowUp?.date ?? null,
        nextFollowUpDate: latestFollowUp?.nextFollowUpDate ?? null,
        promiseDate: latestPromise?.promiseDate ?? null,
      };
    });
  }, [customers, invoices, allocatedByInvoice, receipts, reminderLog, followUps, promises, today]);

  // ---- KPI tiles ----
  const kpis = useMemo(() => {
    const dueToday = rows.filter((r) =>
      r.aggregate.openInvoices.some((inv) => inv.due_date === today)
    ).length;
    const totalOutstanding = rows.reduce((s, r) => s + r.aggregate.outstanding, 0);
    const totalOverdue = rows.reduce((s, r) => s + r.aggregate.overdue, 0);
    const needsFollowUp = rows.filter((r) => r.status === "No Follow-up" || r.status === "Escalation Required").length;
    const promisesToday = promises.filter((p) => p.promiseDate === today);
    const brokenPromises = rows.filter((r) => r.status === "Broken Promise").length;
    const expectedToday = promisesToday.reduce((s, p) => s + p.amount, 0);
    return {
      dueToday,
      totalOutstanding,
      totalOverdue,
      needsFollowUp,
      promisesDueToday: promisesToday.length,
      brokenPromises,
      expectedToday,
    };
  }, [rows, promises, today]);

  // ---- filter + sort + paginate ----
  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          r.aggregate.customer.name.toLowerCase().includes(q) ||
          r.aggregate.customer.code.toLowerCase().includes(q) ||
          (r.aggregate.customer.contact_person ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
    if (priorityFilter !== "all") out = out.filter((r) => r.aggregate.priority === priorityFilter);

    const dir = sort.dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.aggregate.customer.name.localeCompare(b.aggregate.customer.name) * dir;
        case "outstanding":
          return (a.aggregate.outstanding - b.aggregate.outstanding) * dir;
        case "overdue":
          return (a.aggregate.overdue - b.aggregate.overdue) * dir;
        case "ageing":
          return (a.aggregate.maxAgeing - b.aggregate.maxAgeing) * dir;
        default:
          return 0;
      }
    });
    return out;
  }, [rows, search, statusFilter, priorityFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSortChange(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  const selectedRow = rows.find((r) => r.id === selectedCustomerId) ?? null;

  const columns: Column<CustomerRow>[] = [
    { key: "code", header: "Code", render: (r) => r.aggregate.customer.code },
    { key: "name", header: "Customer", sortable: true, render: (r) => r.aggregate.customer.name },
    { key: "contact", header: "Contact", render: (r) => r.aggregate.customer.contact_person ?? "—" },
    { key: "outstanding", header: "Outstanding", sortable: true, className: "text-right", render: (r) => formatCurrency(r.aggregate.outstanding) },
    { key: "overdue", header: "Overdue", sortable: true, className: "text-right", render: (r) => formatCurrency(r.aggregate.overdue) },
    { key: "oldest", header: "Oldest invoice", render: (r) => formatDate(r.aggregate.oldestInvoiceDate) },
    { key: "ageing", header: "Max ageing", sortable: true, render: (r) => (r.aggregate.maxAgeing > 0 ? `${r.aggregate.maxAgeing} days` : "—") },
    { key: "lastFollowUp", header: "Last follow-up", render: (r) => formatDate(r.lastFollowUpDate) },
    { key: "nextFollowUp", header: "Next follow-up", render: (r) => formatDate(r.nextFollowUpDate) },
    { key: "promise", header: "Promise to Pay", render: (r) => formatDate(r.promiseDate) },
    { key: "priority", header: "Priority", render: (r) => <Badge label={r.aggregate.priority} tone={PRIORITY_TONE[r.aggregate.priority]} /> },
    { key: "status", header: "Status", render: (r) => <Badge label={r.status} tone={STATUS_TONE[r.status]} /> },
    {
      key: "action",
      header: "",
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCustomerId(r.id);
          }}
          className="text-xs font-medium text-brand hover:underline"
        >
          Open
        </button>
      ),
    },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Customer Collections Workspace" subtitle="Overdue customers, invoices, and follow-up in one place." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Customer Collections Workspace" subtitle="Overdue customers, invoices, and follow-up in one place." />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading collections data…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : (
        <>
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Follow-up and Promise-to-Pay entries you add below are kept only in this browser tab for this session —
            the database has no table for them yet, so they are not saved to Supabase and will reset on refresh.
          </p>

          {/* KPI cards */}
          <div className="sticky top-0 z-10 -mx-8 mb-6 grid grid-cols-2 gap-3 bg-slate-50 px-8 pb-4 pt-1 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi label="Due today" value={String(kpis.dueToday)} />
            <Kpi label="Total outstanding" value={formatCurrency(kpis.totalOutstanding)} />
            <Kpi label="Total overdue" value={formatCurrency(kpis.totalOverdue)} tone="rose" />
            <Kpi label="Needs follow-up" value={String(kpis.needsFollowUp)} />
            <Kpi label="Promises due today" value={String(kpis.promisesDueToday)} />
            <Kpi label="Broken promises" value={String(kpis.brokenPromises)} tone="rose" />
            <Kpi label="Expected today" value={formatCurrency(kpis.expectedToday)} tone="emerald" />
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search customer, code, or contact…"
              className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "all" | CollectionStatus);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_TONE) as CollectionStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value as "all" | Priority);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <span className="text-sm text-slate-400">{filtered.length} customer{filtered.length === 1 ? "" : "s"}</span>
          </div>

          <div className="[&_thead]:sticky [&_thead]:top-0">
            <DataTable
              columns={columns}
              rows={paged}
              sort={sort}
              onSortChange={handleSortChange}
              onRowClick={(r) => setSelectedCustomerId(r.id)}
              empty="No customers match your filters."
            />
          </div>
          <Pagination page={page} pageCount={pageCount} onChange={setPage} />
        </>
      )}

      {selectedRow && (
        <CustomerDrawer
          aggregate={selectedRow.aggregate}
          allInvoices={invoices}
          receipts={receipts}
          reminderLog={reminderLog.filter((log) => {
            const custInvoiceIds = new Set(
              invoices.filter((i) => i.customer_id === selectedRow.aggregate.customer.id).map((i) => i.id)
            );
            return log.invoice_id && custInvoiceIds.has(log.invoice_id);
          })}
          templates={templates}
          followUps={followUps}
          promises={promises}
          allocatedByInvoice={allocatedByInvoice}
          onClose={() => setSelectedCustomerId(null)}
          onAddFollowUp={(entry) => setFollowUps((prev) => [...prev, entry])}
          onAddPromise={(entry) => setPromises((prev) => [...prev, entry])}
          onReminderSent={(log) => setReminderLog((prev) => [...prev, log])}
        />
      )}
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "rose" | "emerald" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
