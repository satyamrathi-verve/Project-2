"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { KpiCard, inrCompact } from "@/components/ui";
import { inputClass } from "@/components/FormField";
import type { Customer, Invoice, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";
import { buildAllocatedMap, fillReminderTemplate, formatCurrency, formatDate, todayISO } from "@/lib/collections";
import {
  buildCandidates,
  addDaysISO,
  endOfMonthISO,
  reminderStageLabel,
  type Candidate,
  type EmailStatus,
  type CampaignSummary,
} from "@/lib/reminderCampaign";
import { EmailPreviewPanel, EmailStatusBadge } from "./EmailPreviewPanel";

const PAGE_SIZE = 10;

type Row = Candidate & { id: string };

export default function AutoEmailShootPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminderLog, setReminderLog] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- filters ----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "partial" | "overdue">("all");
  const [ageingFilter, setAgeingFilter] = useState<"all" | "0-30" | "31-60" | "61-90" | "90+">("all");
  const [minOutstanding, setMinOutstanding] = useState("");
  const [maxOutstanding, setMaxOutstanding] = useState("");
  const [dueFilter, setDueFilter] = useState<"all" | "today" | "week" | "month" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "overdue", dir: "desc" });
  const [page, setPage] = useState(1);

  // ---- selection / preview ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  // ---- template + send state ----
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, EmailStatus>>({});
  const [sessionTotals, setSessionTotals] = useState({ sent: 0, failed: 0 });
  const [campaignSummary, setCampaignSummary] = useState<CampaignSummary | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const [c, i, a, t, l] = await Promise.all([
        supabase!.from("customers").select("*"),
        supabase!.from("invoices").select("*"),
        supabase!.from("receipt_allocations").select("*"),
        supabase!.from("reminder_templates").select("*").order("name"),
        supabase!.from("reminder_log").select("*"),
      ]);
      const firstError = [c, i, a, t, l].find((r) => r.error)?.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setCustomers(c.data ?? []);
        setInvoices(i.data ?? []);
        setAllocations(a.data ?? []);
        setTemplates(t.data ?? []);
        setReminderLog(l.data ?? []);
        if (t.data && t.data.length > 0) {
          setTemplateId(t.data[0].id);
          setSubject(t.data[0].subject);
          setBody(t.data[0].body);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [banner]);

  const allocatedByInvoice = useMemo(() => buildAllocatedMap(allocations), [allocations]);
  const today = todayISO();

  const candidates = useMemo(
    () => buildCandidates(customers, invoices, allocatedByInvoice, reminderLog, today),
    [customers, invoices, allocatedByInvoice, reminderLog, today]
  );
  const candidateById = useMemo(() => new Map(candidates.map((c) => [c.customer.id, c])), [candidates]);

  function statusOf(c: Candidate): EmailStatus {
    return runtimeStatus[c.customer.id] ?? (c.hasEmail ? "Ready" : "Missing Email");
  }

  // ---- filter + sort ----
  const filtered = useMemo(() => {
    let out = candidates;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (c) =>
          c.customer.name.toLowerCase().includes(q) ||
          c.customer.code.toLowerCase().includes(q) ||
          (c.customer.contact_person ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      out = out.filter((c) => {
        if (statusFilter === "overdue") return c.invoices.some((l) => l.ageing > 0);
        if (statusFilter === "unpaid") return c.invoices.some((l) => l.status === "open");
        return c.invoices.some((l) => l.status === "partial");
      });
    }
    if (ageingFilter !== "all") {
      out = out.filter((c) => c.maxBucket === ageingFilter);
    }
    const min = parseFloat(minOutstanding);
    if (Number.isFinite(min)) out = out.filter((c) => c.outstanding >= min);
    const max = parseFloat(maxOutstanding);
    if (Number.isFinite(max)) out = out.filter((c) => c.outstanding <= max);

    if (dueFilter !== "all") {
      let from = today;
      let to = today;
      if (dueFilter === "week") to = addDaysISO(today, 6);
      else if (dueFilter === "month") to = endOfMonthISO(today);
      else if (dueFilter === "custom") {
        from = customFrom || today;
        to = customTo || today;
      }
      out = out.filter((c) => c.invoices.some((l) => l.due_date >= from && l.due_date <= to));
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.customer.name.localeCompare(b.customer.name) * dir;
        case "outstanding":
          return (a.outstanding - b.outstanding) * dir;
        case "overdue":
          return (a.overdueAmount - b.overdueAmount) * dir;
        case "ageing":
          return (a.maxAgeing - b.maxAgeing) * dir;
        default:
          return 0;
      }
    });
    return out;
  }, [candidates, search, statusFilter, ageingFilter, minOutstanding, maxOutstanding, dueFilter, customFrom, customTo, sort, today]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rows: Row[] = paged.map((c) => ({ ...c, id: c.customer.id }));

  function resetPage() {
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Adds the currently filtered customers to whatever is already selected, so
  // switching filters to build up a selection doesn't drop earlier picks.
  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((c) => next.add(c.customer.id));
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setSubject(t.subject);
    setBody(t.body);
  }

  const activeCandidate = activeId ? candidateById.get(activeId) ?? null : null;

  // Selected customers regardless of the current filter, so "Send Selected"
  // still reaches everyone picked before the filters changed.
  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selectedIds.has(c.customer.id)),
    [candidates, selectedIds]
  );
  const filteredReadyCandidates = useMemo(() => filtered.filter((c) => c.hasEmail), [filtered]);

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const totalOutstanding = candidates.reduce((s, c) => s + c.outstanding, 0);
    const totalOverdue = candidates.reduce((s, c) => s + c.overdueAmount, 0);
    const withoutEmail = candidates.filter((c) => !c.hasEmail).length;
    const selectedReady = candidates.filter((c) => selectedIds.has(c.customer.id) && c.hasEmail).length;
    return {
      selected: selectedIds.size,
      withOutstanding: candidates.length,
      totalOutstanding,
      totalOverdue,
      emailsReady: selectedReady,
      withoutEmail,
    };
  }, [candidates, selectedIds]);

  // ---- send: simulated (writes to reminder_log, no real mailbox) ----
  async function sendToCandidates(list: Candidate[]) {
    if (!supabase || !templateId || list.length === 0) return;
    setSending(true);
    setCampaignSummary(null);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let outstandingCovered = 0;

    for (const c of list) {
      if (!c.hasEmail || c.invoices.length === 0) {
        setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Skipped" }));
        skipped++;
        continue;
      }
      setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Sending" }));
      // One reminder_log row per outstanding invoice, so every invoice this
      // customer owes on gets its own personalised, individually-tracked email.
      const rows = c.invoices.map((inv) => ({
        invoice_id: inv.id,
        to_email: c.customer.email,
        subject: fillReminderTemplate(subject, {
          customer: c.customer.name,
          amount: inv.outstanding,
          daysOverdue: inv.ageing,
          invoiceNo: inv.invoice_no,
        }),
        body: fillReminderTemplate(body, {
          customer: c.customer.name,
          amount: inv.outstanding,
          daysOverdue: inv.ageing,
          invoiceNo: inv.invoice_no,
        }),
        status: "sent",
      }));
      const { data, error } = await supabase.from("reminder_log").insert(rows).select();
      if (error) {
        setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Failed" }));
        failed++;
      } else {
        setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Sent" }));
        sent++;
        outstandingCovered += c.outstanding;
        setReminderLog((prev) => [...prev, ...((data ?? []) as ReminderLog[])]);
      }
    }

    setSending(false);
    setSessionTotals((prev) => ({ sent: prev.sent + sent, failed: prev.failed + failed }));
    setCampaignSummary({ totalProcessed: list.length, sent, failed, skipped, outstandingCovered, at: new Date().toISOString() });
    setBanner(
      failed > 0
        ? { type: "error", text: `Sent ${sent}, failed ${failed}, skipped ${skipped}.` }
        : {
            type: "success",
            text: `Sent ${sent} reminder${sent === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} (no email)` : ""}.`,
          }
    );
  }

  function handleSendSelected() {
    sendToCandidates(selectedCandidates);
  }
  function handleSendAllFiltered() {
    sendToCandidates(filteredReadyCandidates);
  }

  // ---- table columns ----
  const columns: Column<Row>[] = [
    {
      key: "select",
      header: "",
      render: (r) => (
        <input
          type="checkbox"
          checked={selectedIds.has(r.customer.id)}
          onChange={() => toggleSelect(r.customer.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
        />
      ),
    },
    { key: "code", header: "Code", render: (r) => r.customer.code },
    { key: "name", header: "Customer", sortable: true, render: (r) => r.customer.name },
    {
      key: "email",
      header: "Email",
      render: (r) => r.customer.email ?? <span className="text-amber-600 dark:text-amber-400">missing</span>,
    },
    { key: "count", header: "Invoices", className: "text-right", render: (r) => String(r.invoices.length) },
    {
      key: "outstanding",
      header: "Outstanding",
      sortable: true,
      className: "text-right tabular-nums",
      render: (r) => formatCurrency(r.outstanding),
    },
    { key: "oldest", header: "Oldest Due Date", render: (r) => formatDate(r.oldestDueDate) },
    { key: "ageing", header: "Max Ageing", sortable: true, render: (r) => (r.maxAgeing > 0 ? `${r.maxAgeing} days` : "—") },
    { key: "stage", header: "Reminder Stage", render: (r) => reminderStageLabel(r.remindersSent) },
    { key: "status", header: "Email Status", render: (r) => <EmailStatusBadge status={statusOf(r)} /> },
  ];

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="AR Follow-up – Auto Email Shoot" subtitle="Chase overdue customers with personalised reminder emails." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader title="AR Follow-up – Auto Email Shoot" subtitle="Chase overdue customers with personalised reminder emails." />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Loading outstanding customers…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : (
        <>
          {banner && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                banner.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              }`}
            >
              {banner.text}
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
            <KpiCard label="Customers Selected" value={String(kpis.selected)} />
            <KpiCard label="With Outstanding" value={String(kpis.withOutstanding)} />
            <KpiCard label="Total Outstanding" value={inrCompact(kpis.totalOutstanding)} sub={formatCurrency(kpis.totalOutstanding)} />
            <KpiCard label="Overdue Amount" value={inrCompact(kpis.totalOverdue)} sub={formatCurrency(kpis.totalOverdue)} accent="red" />
            <KpiCard label="Emails Ready" value={String(kpis.emailsReady)} accent="brand" />
            <KpiCard label="Emails Sent" value={String(sessionTotals.sent)} accent="emerald" />
            <KpiCard label="Failed Emails" value={String(sessionTotals.failed)} accent="red" />
            <KpiCard label="Without Email" value={String(kpis.withoutEmail)} accent="amber" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Search</label>
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      resetPage();
                    }}
                    placeholder="Customer name or code…"
                    className={`${inputClass} w-56`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as typeof statusFilter);
                      resetPage();
                    }}
                    className={inputClass}
                  >
                    <option value="all">All</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partly Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Ageing</label>
                  <select
                    value={ageingFilter}
                    onChange={(e) => {
                      setAgeingFilter(e.target.value as typeof ageingFilter);
                      resetPage();
                    }}
                    className={inputClass}
                  >
                    <option value="all">All</option>
                    <option value="0-30">1–30 days</option>
                    <option value="31-60">31–60 days</option>
                    <option value="61-90">61–90 days</option>
                    <option value="90+">Above 90 days</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Min Outstanding</label>
                  <input
                    type="number"
                    value={minOutstanding}
                    onChange={(e) => {
                      setMinOutstanding(e.target.value);
                      resetPage();
                    }}
                    placeholder="0"
                    className={`${inputClass} w-28`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Max Outstanding</label>
                  <input
                    type="number"
                    value={maxOutstanding}
                    onChange={(e) => {
                      setMaxOutstanding(e.target.value);
                      resetPage();
                    }}
                    placeholder="Any"
                    className={`${inputClass} w-28`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Due Date</label>
                  <select
                    value={dueFilter}
                    onChange={(e) => {
                      setDueFilter(e.target.value as typeof dueFilter);
                      resetPage();
                    }}
                    className={inputClass}
                  >
                    <option value="all">All</option>
                    <option value="today">Today</option>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="custom">Custom range</option>
                  </select>
                </div>
                {dueFilter === "custom" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">From</label>
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => {
                          setCustomFrom(e.target.value);
                          resetPage();
                        }}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">To</label>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => {
                          setCustomTo(e.target.value);
                          resetPage();
                        }}
                        className={inputClass}
                      />
                    </div>
                  </>
                )}

                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm text-slate-400">
                    {filtered.length} customer{filtered.length === 1 ? "" : "s"}
                  </span>
                  <button
                    onClick={selectAllFiltered}
                    disabled={filtered.length === 0}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Select all filtered
                  </button>
                  <button
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <DataTable
                columns={columns}
                rows={rows}
                sort={sort}
                onSortChange={(key) =>
                  setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }))
                }
                onRowClick={(r) => setActiveId(r.customer.id)}
                empty="No customers match your filters."
              />
              <Pagination page={page} pageCount={pageCount} onChange={setPage} />
            </div>

            <aside className="lg:col-span-1">
              <div className="lg:sticky lg:top-6">
                <EmailPreviewPanel
                  templates={templates}
                  templateId={templateId}
                  onTemplateChange={selectTemplate}
                  subject={subject}
                  body={body}
                  onSubjectChange={setSubject}
                  onBodyChange={setBody}
                  activeCandidate={activeCandidate}
                  onClearActive={() => setActiveId(null)}
                  selectedCount={selectedCandidates.length}
                  filteredReadyCount={filteredReadyCandidates.length}
                  sending={sending}
                  onSendSelected={handleSendSelected}
                  onSendAllFiltered={handleSendAllFiltered}
                  onClearSelection={clearSelection}
                  campaignSummary={campaignSummary}
                  onDismissSummary={() => setCampaignSummary(null)}
                />
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
