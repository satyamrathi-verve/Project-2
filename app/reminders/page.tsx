"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column, type SortState } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { KpiCard, inrCompact } from "@/components/ui";
import { inputClass } from "@/components/FormField";
import type { Customer, Invoice, Receipt, ReceiptAllocation, ReminderLog, ReminderTemplate } from "@/lib/types";
import { buildAllocatedMap, fillReminderTemplate, formatCurrency, formatDate, todayISO } from "@/lib/collections";
import {
  buildCandidates,
  buildReminderHistory,
  addDaysISO,
  endOfMonthISO,
  fillConsolidatedReminderHtml,
  reminderStageLabel,
  type Candidate,
  type CandidateInvoice,
  type EmailStatus,
  type CampaignSummary,
  type ReminderHistoryRow,
} from "@/lib/reminderCampaign";
import { EmailPreviewPanel, EmailStatusBadge } from "./EmailPreviewPanel";
import { DrillDownModal } from "./DrillDownModal";
import { Badge } from "@/components/Badge";

const PAGE_SIZE = 10;

type Row = Candidate & { id: string };

export default function AutoEmailShootPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [reminderLog, setReminderLog] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- filters ----
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unpaid" | "partial" | "overdue">("all");
  const [ageingFilter, setAgeingFilter] = useState<"all" | "0-30" | "31-60" | "61-90" | "90+">("all");
  const [stageFilter, setStageFilter] = useState<"all" | "0" | "1" | "2" | "3+">("all");
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

  const loadAll = useCallback(async (opts?: { keepTemplateSelection?: boolean }) => {
    if (!supabase) return;
    const [c, i, a, rc, t, l] = await Promise.all([
      supabase.from("customers").select("*"),
      supabase.from("invoices").select("*"),
      supabase.from("receipt_allocations").select("*"),
      supabase.from("receipts").select("*"),
      supabase.from("reminder_templates").select("*").order("name"),
      supabase.from("reminder_log").select("*"),
    ]);
    const firstError = [c, i, a, rc, t, l].find((r) => r.error)?.error;
    if (firstError) {
      setError(firstError.message);
      return;
    }
    setError(null);
    setCustomers(c.data ?? []);
    setInvoices(i.data ?? []);
    setAllocations(a.data ?? []);
    setReceipts(rc.data ?? []);
    setTemplates(t.data ?? []);
    setReminderLog(l.data ?? []);
    if (!opts?.keepTemplateSelection && t.data && t.data.length > 0) {
      // Prefer the consolidated multi-invoice template built for this screen;
      // fall back to whichever template comes first alphabetically.
      const preferred = t.data.find((tpl) => tpl.name === "Outstanding Invoice Payment Reminder") ?? t.data[0];
      setTemplateId(preferred.id);
      setSubject(preferred.subject);
      setBody(preferred.body);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoading(false);
      return;
    }
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadAll({ keepTemplateSelection: true });
    setRefreshing(false);
  }

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [banner]);

  const allocatedByInvoice = useMemo(() => buildAllocatedMap(allocations), [allocations]);
  const today = todayISO();

  const candidates = useMemo(
    () => buildCandidates(customers, invoices, allocatedByInvoice, reminderLog, receipts, today),
    [customers, invoices, allocatedByInvoice, reminderLog, receipts, today]
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
    if (stageFilter !== "all") {
      out = out.filter((c) => {
        if (stageFilter === "3+") return c.remindersSent >= 3;
        return c.remindersSent === Number(stageFilter);
      });
    }
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
  }, [candidates, search, statusFilter, ageingFilter, stageFilter, dueFilter, customFrom, customTo, sort, today]);

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

  // ---- KPIs (all derived from real Supabase data — nothing fabricated) ----
  const kpis = useMemo(() => {
    const totalOutstanding = candidates.reduce((s, c) => s + c.outstanding, 0);
    const totalOverdue = candidates.reduce((s, c) => s + c.overdueAmount, 0);
    const withoutEmail = candidates.filter((c) => !c.hasEmail).length;
    const allInvoiceLines = candidates.flatMap((c) => c.invoices);
    const outstandingInvoices = allInvoiceLines.length;
    const currentNotDue = allInvoiceLines.filter((l) => l.ageing <= 0).length;
    const overdueAgeings = allInvoiceLines.filter((l) => l.ageing > 0).map((l) => l.ageing);
    const avgOverdueDays = overdueAgeings.length
      ? Math.round(overdueAgeings.reduce((s, d) => s + d, 0) / overdueAgeings.length)
      : 0;
    const oldestOutstandingDays = candidates.length ? Math.max(0, ...candidates.map((c) => c.maxAgeing)) : 0;
    const readyToSend = candidates.filter((c) => c.hasEmail).length;
    const emailsSentToday = reminderLog.filter((r) => r.sent_at && r.sent_at.slice(0, 10) === today).length;
    return {
      totalCustomers: customers.length,
      eligibleForReminder: candidates.length,
      totalOutstanding,
      totalOverdue,
      outstandingInvoices,
      currentNotDue,
      avgOverdueDays,
      oldestOutstandingDays,
      readyToSend,
      emailsSentToday,
      withoutEmail,
      totalRemindersSent: reminderLog.length,
    };
  }, [candidates, customers, reminderLog, today]);

  // ---- KPI drill-downs ----
  const [drillDown, setDrillDown] = useState<"outstanding" | "overdue" | "eligible" | "sent" | null>(null);

  interface InvoiceRow {
    id: string;
    customerId: string;
    customerName: string;
    invoiceNo: string;
    invoiceDate: string;
    dueDate: string;
    outstanding: number;
    overdueDays: number;
    reminderStage: string;
    lastReminderSent: string | null;
    status: EmailStatus;
  }

  function toInvoiceRow(c: Candidate, inv: CandidateInvoice): InvoiceRow {
    return {
      id: inv.id,
      customerId: c.customer.id,
      customerName: c.customer.name,
      invoiceNo: inv.invoice_no,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date,
      outstanding: inv.outstanding,
      overdueDays: Math.max(0, inv.ageing),
      reminderStage: reminderStageLabel(c.remindersSent),
      lastReminderSent: c.lastReminderDate,
      status: statusOf(c),
    };
  }

  const outstandingRows = useMemo<InvoiceRow[]>(
    () => candidates.flatMap((c) => c.invoices.map((inv) => toInvoiceRow(c, inv))),
    [candidates, runtimeStatus]
  );
  const overdueRows = useMemo<InvoiceRow[]>(() => outstandingRows.filter((r) => r.overdueDays > 0), [outstandingRows]);
  const eligibleRows = useMemo(
    () => candidates.filter((c) => c.hasEmail).map((c) => ({ ...c, id: c.customer.id })),
    [candidates]
  );
  const reminderHistoryRows = useMemo(
    () => buildReminderHistory(reminderLog, invoices, customers),
    [reminderLog, invoices, customers]
  );

  function exportCsv() {
    const header = [
      "Code",
      "Customer",
      "Contact Person",
      "Email",
      "Invoices",
      "Outstanding",
      "Overdue",
      "Oldest Due Date",
      "Max Ageing (days)",
      "Last Payment",
      "Last Reminder Sent",
      "Reminder Stage",
      "Email Status",
    ];
    const lines = filtered.map((c) => [
      c.customer.code,
      c.customer.name,
      c.customer.contact_person ?? "",
      c.customer.email ?? "",
      c.invoices.length,
      c.outstanding.toFixed(2),
      c.overdueAmount.toFixed(2),
      formatDate(c.oldestDueDate),
      c.maxAgeing,
      formatDate(c.lastPaymentDate),
      formatDate(c.lastReminderDate),
      reminderStageLabel(c.remindersSent),
      statusOf(c),
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auto-email-shoot-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
      // One consolidated reminder_log row per customer, covering every
      // outstanding invoice in a single email (real HTML table, one row per
      // invoice) — matches how an AR team would actually chase a customer,
      // rather than sending a separate email per invoice.
      const primary = c.primaryInvoice ?? c.invoices[0];
      const row = {
        invoice_id: primary.id,
        to_email: c.customer.email,
        subject: fillReminderTemplate(subject, {
          customer: c.customer.name,
          amount: c.outstanding,
          daysOverdue: c.maxAgeing,
          invoiceNo: primary.invoice_no,
        }),
        body: fillConsolidatedReminderHtml(body, { customerName: c.customer.name, invoices: c.invoices }),
        status: "sent",
      };
      const { data, error } = await supabase.from("reminder_log").insert(row).select().single();
      if (error) {
        setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Failed" }));
        failed++;
      } else {
        setRuntimeStatus((prev) => ({ ...prev, [c.customer.id]: "Sent" }));
        sent++;
        outstandingCovered += c.outstanding;
        setReminderLog((prev) => [...prev, data as ReminderLog]);
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
    { key: "contact", header: "Contact Person", render: (r) => r.customer.contact_person ?? "—" },
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
    { key: "lastPayment", header: "Last Payment", render: (r) => formatDate(r.lastPaymentDate) },
    { key: "lastReminder", header: "Last Reminder Sent", render: (r) => formatDate(r.lastReminderDate) },
    { key: "stage", header: "Reminder Stage", render: (r) => reminderStageLabel(r.remindersSent) },
    { key: "status", header: "Email Status", render: (r) => <EmailStatusBadge status={statusOf(r)} /> },
    {
      key: "action",
      header: "",
      render: (r) => (
        <div className="flex items-center gap-3 whitespace-nowrap text-xs font-medium">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveId(r.customer.id);
            }}
            className="text-brand hover:underline"
          >
            Preview
          </button>
          {r.primaryInvoice && (
            <Link
              href={`/invoices/${r.primaryInvoice.id}/print`}
              onClick={(e) => e.stopPropagation()}
              className="text-slate-500 hover:underline dark:text-slate-400"
            >
              Invoice PDF
            </Link>
          )}
        </div>
      ),
    },
  ];

  // ---- drill-down modal configs ----
  const outstandingColumns: Column<InvoiceRow>[] = [
    { key: "customerName", header: "Customer", sortable: true, render: (r) => r.customerName },
    { key: "invoiceNo", header: "Invoice No.", render: (r) => r.invoiceNo },
    { key: "invoiceDate", header: "Invoice Date", render: (r) => formatDate(r.invoiceDate) },
    { key: "dueDate", header: "Due Date", render: (r) => formatDate(r.dueDate) },
    {
      key: "outstanding",
      header: "Outstanding Amount",
      sortable: true,
      className: "text-right tabular-nums",
      render: (r) => formatCurrency(r.outstanding),
    },
    {
      key: "overdueDays",
      header: "Overdue Days",
      sortable: true,
      className: "text-right",
      render: (r) => (r.overdueDays > 0 ? `${r.overdueDays}d` : "—"),
    },
    { key: "status", header: "Reminder Status", render: (r) => <EmailStatusBadge status={r.status} /> },
    {
      key: "pdf",
      header: "Invoice PDF",
      render: (r) => (
        <Link href={`/invoices/${r.id}/print`} className="text-brand hover:underline">
          View PDF
        </Link>
      ),
    },
  ];
  const invoiceRowComparators: Record<string, (a: InvoiceRow, b: InvoiceRow) => number> = {
    customerName: (a, b) => a.customerName.localeCompare(b.customerName),
    outstanding: (a, b) => a.outstanding - b.outstanding,
    overdueDays: (a, b) => a.overdueDays - b.overdueDays,
  };
  const invoiceRowSearch = (r: InvoiceRow, q: string) =>
    r.customerName.toLowerCase().includes(q) || r.invoiceNo.toLowerCase().includes(q);
  const invoiceRowCsvHeader = ["Customer", "Invoice No.", "Invoice Date", "Due Date", "Outstanding", "Overdue Days", "Reminder Status"];
  const invoiceRowToCsv = (r: InvoiceRow): (string | number)[] => [
    r.customerName,
    r.invoiceNo,
    formatDate(r.invoiceDate),
    formatDate(r.dueDate),
    r.outstanding.toFixed(2),
    r.overdueDays,
    r.status,
  ];

  const overdueColumns: Column<InvoiceRow>[] = [
    { key: "customerName", header: "Customer", sortable: true, render: (r) => r.customerName },
    { key: "invoiceNo", header: "Invoice No.", render: (r) => r.invoiceNo },
    { key: "invoiceDate", header: "Invoice Date", render: (r) => formatDate(r.invoiceDate) },
    { key: "dueDate", header: "Due Date", render: (r) => formatDate(r.dueDate) },
    {
      key: "outstanding",
      header: "Outstanding Amount",
      sortable: true,
      className: "text-right tabular-nums",
      render: (r) => formatCurrency(r.outstanding),
    },
    {
      key: "overdueDays",
      header: "Overdue Days",
      sortable: true,
      className: "text-right",
      render: (r) => `${r.overdueDays}d`,
    },
    { key: "stage", header: "Reminder Stage", render: (r) => r.reminderStage },
    { key: "lastReminder", header: "Last Reminder Sent", render: (r) => formatDate(r.lastReminderSent) },
  ];
  const overdueCsvHeader = ["Customer", "Invoice No.", "Invoice Date", "Due Date", "Outstanding", "Overdue Days", "Reminder Stage", "Last Reminder Sent"];
  const overdueToCsv = (r: InvoiceRow): (string | number)[] => [
    r.customerName,
    r.invoiceNo,
    formatDate(r.invoiceDate),
    formatDate(r.dueDate),
    r.outstanding.toFixed(2),
    r.overdueDays,
    r.reminderStage,
    formatDate(r.lastReminderSent),
  ];

  type EligibleRow = Candidate & { id: string };
  const eligibleColumns: Column<EligibleRow>[] = [
    { key: "name", header: "Customer Name", sortable: true, render: (r) => r.customer.name },
    { key: "email", header: "Email ID", render: (r) => r.customer.email ?? "—" },
    { key: "invoiceNo", header: "Invoice No.", render: (r) => r.primaryInvoice?.invoice_no ?? "—" },
    { key: "dueDate", header: "Due Date", render: (r) => formatDate(r.oldestDueDate) },
    {
      key: "outstanding",
      header: "Outstanding Amount",
      sortable: true,
      className: "text-right tabular-nums",
      render: (r) => formatCurrency(r.outstanding),
    },
    { key: "overdueDays", header: "Overdue Days", sortable: true, className: "text-right", render: (r) => `${r.maxAgeing}d` },
    { key: "stage", header: "Reminder Stage", render: (r) => reminderStageLabel(r.remindersSent) },
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-3 text-xs font-medium">
          <button
            onClick={() => {
              setActiveId(r.customer.id);
              setDrillDown(null);
            }}
            className="text-brand hover:underline"
          >
            Preview
          </button>
          <button
            onClick={() => sendToCandidates([r])}
            disabled={sending || !templateId}
            className="text-emerald-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
          >
            Send
          </button>
        </div>
      ),
    },
  ];
  const eligibleComparators: Record<string, (a: EligibleRow, b: EligibleRow) => number> = {
    name: (a, b) => a.customer.name.localeCompare(b.customer.name),
    outstanding: (a, b) => a.outstanding - b.outstanding,
    overdueDays: (a, b) => a.maxAgeing - b.maxAgeing,
  };
  const eligibleSearch = (r: EligibleRow, q: string) =>
    r.customer.name.toLowerCase().includes(q) || (r.primaryInvoice?.invoice_no.toLowerCase() ?? "").includes(q);
  const eligibleCsvHeader = ["Customer Name", "Email ID", "Invoice No.", "Due Date", "Outstanding", "Overdue Days", "Reminder Stage"];
  const eligibleToCsv = (r: EligibleRow): (string | number)[] => [
    r.customer.name,
    r.customer.email ?? "",
    r.primaryInvoice?.invoice_no ?? "",
    formatDate(r.oldestDueDate),
    r.outstanding.toFixed(2),
    r.maxAgeing,
    reminderStageLabel(r.remindersSent),
  ];

  const sentColumns: Column<ReminderHistoryRow>[] = [
    { key: "customerName", header: "Customer", sortable: true, render: (r) => r.customerName },
    { key: "invoiceNo", header: "Invoice No. (Attachment)", render: (r) => r.invoiceNo },
    { key: "toEmail", header: "Recipient Email", render: (r) => r.toEmail ?? "—" },
    { key: "sentAt", header: "Date & Time Sent", sortable: true, render: (r) => new Date(r.sentAt).toLocaleString("en-IN") },
    {
      key: "status",
      header: "Delivery Status",
      render: (r) => <Badge label={r.status === "sent" ? "Sent" : r.status} tone={r.status === "sent" ? "emerald" : "rose"} />,
    },
  ];
  const sentComparators: Record<string, (a: ReminderHistoryRow, b: ReminderHistoryRow) => number> = {
    customerName: (a, b) => a.customerName.localeCompare(b.customerName),
    sentAt: (a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0),
  };
  const sentSearch = (r: ReminderHistoryRow, q: string) =>
    r.customerName.toLowerCase().includes(q) || r.invoiceNo.toLowerCase().includes(q);
  const sentCsvHeader = ["Customer", "Invoice No.", "Recipient Email", "Sent At", "Status"];
  const sentToCsv = (r: ReminderHistoryRow): (string | number)[] => [
    r.customerName,
    r.invoiceNo,
    r.toEmail ?? "",
    new Date(r.sentAt).toLocaleString("en-IN"),
    r.status,
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
    // overflow-x-hidden confines this page to the viewport width — the wide
    // customer table still scrolls horizontally within its own DataTable
    // wrapper (which has its own overflow-x-auto), it just can no longer
    // push the whole screen sideways.
    <div className="overflow-x-hidden">
      <PageHeader title="AR Follow-up – Auto Email Shoot" subtitle="Chase overdue customers with personalised reminder emails." />

      {!loading && !error && candidates.length > 0 && (
        <p className="-mt-4 mb-6 rounded-lg bg-brand/5 px-4 py-2.5 text-sm text-slate-700 dark:bg-brand/10 dark:text-slate-300">
          <strong className="font-semibold">{kpis.eligibleForReminder}</strong> customer
          {kpis.eligibleForReminder === 1 ? "" : "s"} have{" "}
          <strong className="font-semibold">{inrCompact(kpis.totalOverdue)}</strong> overdue across{" "}
          <strong className="font-semibold">{kpis.outstandingInvoices}</strong> invoice
          {kpis.outstandingInvoices === 1 ? "" : "s"}. <strong className="font-semibold">{kpis.readyToSend}</strong> reminder
          email{kpis.readyToSend === 1 ? "" : "s"} {kpis.readyToSend === 1 ? "is" : "are"} ready to send.
        </p>
      )}

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

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label="Total Outstanding Amount"
              value={inrCompact(kpis.totalOutstanding)}
              sub="Every unpaid or partly-paid invoice"
              onClick={() => setDrillDown("outstanding")}
            />
            <KpiCard
              label="Overdue Amount"
              value={inrCompact(kpis.totalOverdue)}
              sub="Past due date, still unpaid"
              accent="red"
              onClick={() => setDrillDown("overdue")}
            />
            <KpiCard
              label="Eligible for Reminder"
              value={String(kpis.eligibleForReminder)}
              sub="Customers with outstanding invoices"
              accent="brand"
              onClick={() => setDrillDown("eligible")}
            />
            <KpiCard
              label="Total Reminders Sent"
              value={String(kpis.totalRemindersSent)}
              sub="All-time, from the reminder log"
              accent="emerald"
              onClick={() => setDrillDown("sent")}
            />
          </div>

          <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-none flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Search</label>
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      resetPage();
                    }}
                    placeholder="Customer name or code…"
                    className={`${inputClass} w-44`}
                  />
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as typeof statusFilter);
                      resetPage();
                    }}
                    className={`${inputClass} w-32`}
                  >
                    <option value="all">All</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partly Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Ageing</label>
                  <select
                    value={ageingFilter}
                    onChange={(e) => {
                      setAgeingFilter(e.target.value as typeof ageingFilter);
                      resetPage();
                    }}
                    className={`${inputClass} w-32`}
                  >
                    <option value="all">All</option>
                    <option value="0-30">1–30 days</option>
                    <option value="31-60">31–60 days</option>
                    <option value="61-90">61–90 days</option>
                    <option value="90+">Above 90 days</option>
                  </select>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Reminder Stage</label>
                  <select
                    value={stageFilter}
                    onChange={(e) => {
                      setStageFilter(e.target.value as typeof stageFilter);
                      resetPage();
                    }}
                    className={`${inputClass} w-36`}
                  >
                    <option value="all">All</option>
                    <option value="0">Not sent yet</option>
                    <option value="1">1st reminder</option>
                    <option value="2">2nd reminder</option>
                    <option value="3+">3rd+ reminder</option>
                  </select>
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Due Date</label>
                  <select
                    value={dueFilter}
                    onChange={(e) => {
                      setDueFilter(e.target.value as typeof dueFilter);
                      resetPage();
                    }}
                    className={`${inputClass} w-32`}
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
                    <div className="flex flex-none flex-col gap-1">
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
                    <div className="flex flex-none flex-col gap-1">
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
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex-none whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  onClick={exportCsv}
                  disabled={filtered.length === 0}
                  className="flex-none whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Export CSV
                </button>
                <button
                  onClick={selectAllFiltered}
                  disabled={filtered.length === 0}
                  className="flex-none whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Select all filtered
                </button>
                <button
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                  className="flex-none whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Clear
                </button>
                <span className="flex-none whitespace-nowrap pb-1.5 text-sm text-slate-400">
                  {filtered.length} customer{filtered.length === 1 ? "" : "s"}
                </span>
              </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* min-w-0: grid items default to min-width:auto, which refuses to
                shrink below the table's natural content width and was
                stretching the whole main content area sideways instead of
                letting the table's own overflow-x-auto scroll it. */}
            <div className="min-w-0 space-y-4 lg:col-span-2">
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
              <div className="lg:sticky lg:top-6 lg:mt-3">
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

          {drillDown === "outstanding" && (
            <DrillDownModal
              title="Total Outstanding Amount"
              subtitle={`${outstandingRows.length} outstanding invoice${outstandingRows.length === 1 ? "" : "s"} across ${kpis.eligibleForReminder} customer${kpis.eligibleForReminder === 1 ? "" : "s"}`}
              rows={outstandingRows}
              columns={outstandingColumns}
              searchPlaceholder="Search customer or invoice no…"
              searchPredicate={invoiceRowSearch}
              sortComparators={invoiceRowComparators}
              defaultSort={{ key: "outstanding", dir: "desc" }}
              csvHeader={invoiceRowCsvHeader}
              toCsvRow={invoiceRowToCsv}
              filename={`outstanding-invoices-${today}.csv`}
              onClose={() => setDrillDown(null)}
            />
          )}
          {drillDown === "overdue" && (
            <DrillDownModal
              title="Overdue Amount"
              subtitle={`${overdueRows.length} invoice${overdueRows.length === 1 ? "" : "s"} past their due date`}
              rows={overdueRows}
              columns={overdueColumns}
              searchPlaceholder="Search customer or invoice no…"
              searchPredicate={invoiceRowSearch}
              sortComparators={invoiceRowComparators}
              defaultSort={{ key: "overdueDays", dir: "desc" }}
              csvHeader={overdueCsvHeader}
              toCsvRow={overdueToCsv}
              filename={`overdue-invoices-${today}.csv`}
              onClose={() => setDrillDown(null)}
            />
          )}
          {drillDown === "eligible" && (
            <DrillDownModal
              title="Eligible for Reminder"
              subtitle={`${eligibleRows.length} customer${eligibleRows.length === 1 ? "" : "s"} with an email on file and money outstanding`}
              rows={eligibleRows}
              columns={eligibleColumns}
              searchPlaceholder="Search customer or invoice no…"
              searchPredicate={eligibleSearch}
              sortComparators={eligibleComparators}
              defaultSort={{ key: "outstanding", dir: "desc" }}
              csvHeader={eligibleCsvHeader}
              toCsvRow={eligibleToCsv}
              filename={`eligible-for-reminder-${today}.csv`}
              onClose={() => setDrillDown(null)}
            />
          )}
          {drillDown === "sent" && (
            <DrillDownModal
              title="Total Reminders Sent"
              subtitle={`${reminderHistoryRows.length} reminder${reminderHistoryRows.length === 1 ? "" : "s"} logged all-time. Open/read tracking isn't available — there's no real email service behind this feature.`}
              rows={reminderHistoryRows}
              columns={sentColumns}
              searchPlaceholder="Search customer or invoice no…"
              searchPredicate={sentSearch}
              sortComparators={sentComparators}
              defaultSort={{ key: "sentAt", dir: "desc" }}
              csvHeader={sentCsvHeader}
              toCsvRow={sentToCsv}
              filename={`reminder-history-${today}.csv`}
              onClose={() => setDrillDown(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
