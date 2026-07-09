"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, FormSection, FieldError, inputClass } from "@/components/FormField";
import { useColumnCustomizer } from "@/components/useColumnCustomizer";
import {
  TableSkeleton,
  IconMoreVertical,
  IconUpload,
  IconDownload,
  IconRefresh,
  IconRotateCcw,
  IconSliders,
  IconChevronRight,
  IconFile,
  IconAlertTriangle,
  IconX,
} from "@/components/ui";
import {
  downloadSampleFile,
  parseImportFile,
  exportCustomersCsv,
  exportCustomersXlsx,
  EXPORT_COLUMN_LABELS,
  type ImportRowResult,
  type ExportColKey,
} from "@/lib/customerIO";
import type { Customer } from "@/lib/types";
import { CustomerHealthCard } from "./CustomerHealthCard";
import { computeCustomerHealth, type CustomerHealth } from "./customerHealth";

/*
  Customer Master
  ----------------
  This is the base screen every later AR Manager screen leans on — invoices,
  receipts, statements and ageing all point back to a customer row created
  here. This page only ever reads/writes the existing `customers` table
  through the shared client in lib/supabase.ts. It never touches the
  database schema.

  Header actions follow the Zoho Books pattern: a primary "+ Add Customer"
  button plus a single "More Actions" (⋮) menu holding Import, Export,
  Export Current View, Customize Columns, Refresh List and Reset Column
  Settings — instead of separate Import/Export buttons cluttering the header.

  Note on "active/inactive": the customers table in supabase/seed.sql has no
  such column, so there's nothing to filter on yet. If the team wants that,
  it needs a new column added on the backend first — ask before adding one
  here, per the "never alter tables" rule.
*/

type FormState = {
  id: string | null;
  code: string;
  name: string;
  gstin: string;
  pan: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  credit_limit: string;
  credit_days: string;
  opening_balance: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  code: "",
  name: "",
  gstin: "",
  pan: "",
  contact_person: "",
  email: "",
  phone: "",
  address: "",
  credit_limit: "0",
  credit_days: "30",
  opening_balance: "0",
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// Compact input style for the per-column filter row — smaller than the
// standard form inputClass so it fits neatly under a table header.
const filterInputClass =
  "w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal text-slate-600 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The 8 columns Import/Export/Customize Columns all agree on — matches the
// existing customers table exactly, nothing invented.
const COLUMN_DEFS: { key: ExportColKey; label: string }[] = [
  { key: "code", label: "Customer Code" },
  { key: "name", label: "Customer Name" },
  { key: "contact_person", label: "Contact Person" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "credit_limit", label: "Credit Limit" },
  { key: "credit_days", label: "Credit Days" },
  { key: "opening_balance", label: "Opening Balance" },
];
const COLS_STORAGE_KEY = "customers.visibleColumns.v1";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Excel-style per-column filters, shown as a second header row in the table.
  // Text columns match "contains"; the three number columns match "at least".
  const [colFilters, setColFilters] = useState({
    code: "",
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    credit_limit: "",
    credit_days: "",
    opening_balance: "",
  });
  const hasColumnFilters = Object.values(colFilters).some((v) => v.trim() !== "");
  function setColFilter(key: keyof typeof colFilters, value: string) {
    setColFilters((prev) => ({ ...prev, [key]: value }));
  }
  function clearColumnFilters() {
    setColFilters({
      code: "",
      name: "",
      contact_person: "",
      email: "",
      phone: "",
      credit_limit: "",
      credit_days: "",
      opening_balance: "",
    });
  }

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Customer Health Card — shown for one customer at a time, fetched on demand
  // when "View Health" is clicked. Nothing here is saved back to Supabase.
  const [viewingCustomerId, setViewingCustomerId] = useState<string | null>(null);
  const [health, setHealth] = useState<CustomerHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewingCustomerId || !supabase) return;
    let cancelled = false;

    async function loadHealth() {
      setHealthLoading(true);
      setHealthError(null);
      const customer = customers.find((c) => c.id === viewingCustomerId);
      if (!customer) {
        setHealthLoading(false);
        return;
      }
      const [invoicesRes, receiptsRes] = await Promise.all([
        supabase!.from("invoices").select("*").eq("customer_id", viewingCustomerId),
        supabase!.from("receipts").select("*").eq("customer_id", viewingCustomerId),
      ]);
      if (cancelled) return;
      const firstError = invoicesRes.error ?? receiptsRes.error;
      if (firstError) {
        setHealthError(firstError.message);
        setHealthLoading(false);
        return;
      }
      const invoiceIds = (invoicesRes.data ?? []).map((inv) => inv.id);
      const allocationsRes = invoiceIds.length
        ? await supabase!.from("receipt_allocations").select("*").in("invoice_id", invoiceIds)
        : { data: [], error: null };
      if (cancelled) return;
      if (allocationsRes.error) {
        setHealthError(allocationsRes.error.message);
        setHealthLoading(false);
        return;
      }
      setHealth(
        computeCustomerHealth(customer, invoicesRes.data ?? [], allocationsRes.data ?? [], receiptsRes.data ?? [])
      );
      setHealthLoading(false);
    }

    loadHealth();
    return () => {
      cancelled = true;
    };
  }, [viewingCustomerId, customers]);

  const viewingCustomer = viewingCustomerId ? customers.find((c) => c.id === viewingCustomerId) ?? null : null;

  function handleViewHealth(c: Customer) {
    setHealth(null);
    setViewingCustomerId(c.id);
  }

  function closeHealthCard() {
    setViewingCustomerId(null);
    setHealth(null);
    setHealthError(null);
  }

  // "More Actions" menu (Zoho-style) + its Export/Export Current View sub-lists.
  const [moreMenuAt, setMoreMenuAt] = useState<{ top: number; right: number } | null>(null);
  const [expandedExport, setExpandedExport] = useState<"all" | "view" | null>(null);

  // Column show/hide — shared with Receipt Entry via useColumnCustomizer.
  const { orderedKeys, openCustomizeModal, requestReset, overlay: columnOverlay } = useColumnCustomizer(
    COLUMN_DEFS,
    COLS_STORAGE_KEY
  );

  // Import Customers modal.
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Print-to-PDF payload for Export (Excel/CSV are direct file downloads;
  // PDF reuses the browser Print dialog, same convention as every other
  // printable report in this app).
  const [printPayload, setPrintPayload] = useState<{ rows: Customer[]; cols: ExportColKey[]; title: string } | null>(
    null
  );

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("code", { ascending: true });
    if (error) {
      setLoadError(error.message);
    } else {
      setCustomers((data ?? []) as Customer[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  // Close the More Actions menu on Escape.
  useEffect(() => {
    if (!moreMenuAt) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreMenuAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreMenuAt]);

  // Print, then clear the print-only payload once the print dialog closes.
  useEffect(() => {
    if (!printPayload) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    const onAfterPrint = () => setPrintPayload(null);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printPayload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const contains = (value: string | null, needle: string) =>
      !needle.trim() || (value ?? "").toLowerCase().includes(needle.trim().toLowerCase());
    const atLeast = (value: number | null | undefined, needle: string) =>
      !needle.trim() || Number(value ?? 0) >= Number(needle);

    return customers.filter((c) => {
      if (q) {
        const matchesGlobalSearch = [c.code, c.name, c.contact_person, c.email, c.phone]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(q));
        if (!matchesGlobalSearch) return false;
      }
      if (!contains(c.code, colFilters.code)) return false;
      if (!contains(c.name, colFilters.name)) return false;
      if (!contains(c.contact_person, colFilters.contact_person)) return false;
      if (!contains(c.email, colFilters.email)) return false;
      if (!contains(c.phone, colFilters.phone)) return false;
      if (!atLeast(c.credit_limit, colFilters.credit_limit)) return false;
      if (!atLeast(c.credit_days, colFilters.credit_days)) return false;
      if (!atLeast(c.opening_balance, colFilters.opening_balance)) return false;
      return true;
    });
  }, [customers, search, colFilters]);

  function openAddForm() {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setPanelOpen(true);
  }

  function openEditForm(c: Customer) {
    setForm({
      id: c.id,
      code: c.code,
      name: c.name,
      gstin: c.gstin ?? "",
      pan: c.pan ?? "",
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      credit_limit: String(c.credit_limit ?? 0),
      credit_days: String(c.credit_days ?? 0),
      opening_balance: String(c.opening_balance ?? 0),
    });
    setFormErrors({});
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
  }

  function validate(f: FormState): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!f.code.trim()) errs.code = "Customer code is required.";
    if (!f.name.trim()) errs.name = "Customer name is required.";
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) {
      errs.email = "Enter a valid email address.";
    }
    if (Number(f.credit_limit) < 0) errs.credit_limit = "Credit limit cannot be negative.";
    if (Number(f.credit_days) < 0) errs.credit_days = "Credit days cannot be negative.";
    if (Number(f.opening_balance) < 0) errs.opening_balance = "Opening balance cannot be negative.";
    return errs;
  }

  async function handleSave() {
    if (!supabase) return;
    const errs = validate(form);
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      gstin: form.gstin.trim() || null,
      pan: form.pan.trim() || null,
      contact_person: form.contact_person.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      credit_limit: Number(form.credit_limit) || 0,
      credit_days: Number(form.credit_days) || 0,
      opening_balance: Number(form.opening_balance) || 0,
    };

    const { error } = form.id
      ? await supabase.from("customers").update(payload).eq("id", form.id)
      : await supabase.from("customers").insert(payload);

    setSaving(false);

    if (error) {
      setBanner({ type: "error", text: `Could not save: ${error.message}` });
      return;
    }

    setBanner({ type: "success", text: form.id ? "Customer updated." : "Customer added." });
    setPanelOpen(false);
    loadCustomers();
  }

  // ---- More Actions menu ---------------------------------------------------

  function openMoreMenu(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setMoreMenuAt((open) => (open ? null : { top: r.bottom + 6, right: window.innerWidth - r.right }));
    setExpandedExport(null);
  }

  function closeMoreMenu() {
    setMoreMenuAt(null);
    setExpandedExport(null);
  }

  function handleRefresh() {
    closeMoreMenu();
    loadCustomers();
  }

  // ---- Export -----------------------------------------------------------

  function printCustomers(rows: Customer[], cols: ExportColKey[], title: string) {
    setPrintPayload({ rows, cols, title });
  }

  function handleExportAll(fmt: "xlsx" | "csv" | "pdf") {
    closeMoreMenu();
    const cols = COLUMN_DEFS.map((c) => c.key); // "complete customer master" — every column, every row
    if (fmt === "xlsx") exportCustomersXlsx(customers, cols, `Customer_Master_${todayStr()}.xlsx`);
    else if (fmt === "csv") exportCustomersCsv(customers, cols, `Customer_Master_${todayStr()}.csv`);
    else printCustomers(customers, cols, "Customer Master — Complete List");
  }

  function handleExportCurrentView(fmt: "xlsx" | "csv" | "pdf") {
    closeMoreMenu();
    // Respects the current search, column filters, and the currently-visible columns.
    if (fmt === "xlsx") exportCustomersXlsx(filtered, orderedKeys, `Customer_Master_CurrentView_${todayStr()}.xlsx`);
    else if (fmt === "csv") exportCustomersCsv(filtered, orderedKeys, `Customer_Master_CurrentView_${todayStr()}.csv`);
    else printCustomers(filtered, orderedKeys, "Customer Master — Current View");
  }

  // ---- Import -----------------------------------------------------------

  function openImportModal() {
    closeMoreMenu();
    setImportResults(null);
    setIsDragOver(false);
    setImportModalOpen(true);
  }

  function closeImportModal() {
    setImportModalOpen(false);
    setImportResults(null);
    setIsDragOver(false);
  }

  async function handleFile(file: File) {
    setImporting(true);
    const existingCodes = new Set(customers.map((c) => c.code.toLowerCase()));
    try {
      const { results } = await parseImportFile(file, existingCodes);
      setImportResults(results);
    } catch (err) {
      setImportResults([
        { row: 0, data: null, errors: [`Couldn't read this file: ${err instanceof Error ? err.message : "unknown error"}`] },
      ]);
    }
    setImporting(false);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const validImportRows = importResults?.filter((r) => r.data !== null) ?? [];

  async function handleConfirmImport() {
    if (!supabase || validImportRows.length === 0) return;
    setImporting(true);
    const { error } = await supabase.from("customers").insert(
      validImportRows.map((r) => ({
        code: r.data!.code,
        name: r.data!.name,
        contact_person: r.data!.contact_person,
        email: r.data!.email,
        phone: r.data!.phone,
        credit_limit: r.data!.credit_limit,
        credit_days: r.data!.credit_days,
        opening_balance: r.data!.opening_balance,
      }))
    );
    setImporting(false);

    if (error) {
      setBanner({ type: "error", text: `Import failed: ${error.message}` });
      return;
    }

    setBanner({ type: "success", text: `Imported ${validImportRows.length} customer${validImportRows.length === 1 ? "" : "s"}.` });
    closeImportModal();
    loadCustomers();
  }

  const allColumns: Record<ExportColKey, Column<Customer>> = {
    code: {
      key: "code",
      header: "Code",
      className: "font-medium text-slate-900 dark:text-white",
      filter: (
        <input
          value={colFilters.code}
          onChange={(e) => setColFilter("code", e.target.value)}
          placeholder="Filter…"
          className={filterInputClass}
        />
      ),
    },
    name: {
      key: "name",
      header: "Customer Name",
      className: "max-w-[220px]",
      render: (r) => <span className="line-clamp-2">{r.name}</span>,
      filter: (
        <input
          value={colFilters.name}
          onChange={(e) => setColFilter("name", e.target.value)}
          placeholder="Filter…"
          className={filterInputClass}
        />
      ),
    },
    contact_person: {
      key: "contact_person",
      header: "Contact Person",
      render: (r) => r.contact_person || "—",
      filter: (
        <input
          value={colFilters.contact_person}
          onChange={(e) => setColFilter("contact_person", e.target.value)}
          placeholder="Filter…"
          className={filterInputClass}
        />
      ),
    },
    email: {
      key: "email",
      header: "Email",
      render: (r) => r.email || "—",
      filter: (
        <input
          value={colFilters.email}
          onChange={(e) => setColFilter("email", e.target.value)}
          placeholder="Filter…"
          className={filterInputClass}
        />
      ),
    },
    phone: {
      key: "phone",
      header: "Phone",
      className: "whitespace-nowrap",
      render: (r) => r.phone || "—",
      filter: (
        <input
          value={colFilters.phone}
          onChange={(e) => setColFilter("phone", e.target.value)}
          placeholder="Filter…"
          className={filterInputClass}
        />
      ),
    },
    credit_limit: {
      key: "credit_limit",
      header: "Credit Limit",
      className: "text-right tabular-nums",
      render: (r) => currency.format(r.credit_limit ?? 0),
      filter: (
        <input
          type="number"
          min={0}
          value={colFilters.credit_limit}
          onChange={(e) => setColFilter("credit_limit", e.target.value)}
          placeholder="Min ₹"
          className={`${filterInputClass} text-right`}
        />
      ),
    },
    credit_days: {
      key: "credit_days",
      header: "Credit Days",
      className: "text-right tabular-nums",
      render: (r) => `${r.credit_days} days`,
      filter: (
        <input
          type="number"
          min={0}
          value={colFilters.credit_days}
          onChange={(e) => setColFilter("credit_days", e.target.value)}
          placeholder="Min days"
          className={`${filterInputClass} text-right`}
        />
      ),
    },
    opening_balance: {
      key: "opening_balance",
      header: "Opening Balance",
      className: "text-right tabular-nums",
      render: (r) => currency.format(r.opening_balance ?? 0),
      filter: (
        <input
          type="number"
          min={0}
          value={colFilters.opening_balance}
          onChange={(e) => setColFilter("opening_balance", e.target.value)}
          placeholder="Min ₹"
          className={`${filterInputClass} text-right`}
        />
      ),
    },
  };

  const columns: Column<Customer>[] = [
    ...orderedKeys.map((k) => allColumns[k]),
    {
      key: "action",
      header: "",
      className: "text-right whitespace-nowrap",
      render: (r) => (
        <span className="inline-flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => handleViewHealth(r)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500"
          >
            View Health
          </button>
          <button
            onClick={() => openEditForm(r)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500"
          >
            Edit
          </button>
        </span>
      ),
    },
  ];

  if (!isConfigured || !supabase) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Customer Master"
          subtitle="Manage customer details, credit terms, and opening balances."
        />
        <NotConfigured />
      </div>
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Customer Master"
          subtitle="Manage customer details, credit terms, and opening balances."
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={openAddForm}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                + Add Customer
              </button>
              <button
                onClick={openMoreMenu}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={Boolean(moreMenuAt)}
                className="rounded-lg border border-slate-300 p-2.5 text-slate-500 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <IconMoreVertical className="h-4 w-4" />
              </button>
            </div>
          }
        />

        {viewingCustomer && (
          <CustomerHealthCard
            customer={viewingCustomer}
            health={health}
            loading={healthLoading}
            error={healthError}
            onClose={closeHealthCard}
          />
        )}

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

        <div className="mb-2 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, name, contact person, email or phone…"
            className={`${inputClass} w-full max-w-md`}
          />
          {hasColumnFilters && (
            <button
              onClick={clearColumnFilters}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/10"
            >
              Clear column filters
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          Tip: use the filter boxes under each column heading below to narrow the list further.
        </p>

        {loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            Couldn&apos;t load customers: {loadError}
          </div>
        ) : loading ? (
          <TableSkeleton rows={7} cols={8} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            stickyHeader
            empty={
              <div className="flex flex-col items-center gap-3 py-6">
                <span className="text-sm text-slate-400 dark:text-slate-500">
                  {search || hasColumnFilters ? "No customers match your search/filters." : "No customers yet."}
                </span>
                {!search && !hasColumnFilters && (
                  <button
                    onClick={openAddForm}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    + Add Customer
                  </button>
                )}
              </div>
            }
          />
        )}

        {/* More Actions dropdown — rendered at page level (fixed) so it can't
            be clipped by anything. */}
        {moreMenuAt && (
          <div className="fixed inset-0 z-40" onClick={closeMoreMenu}>
            <div
              role="menu"
              aria-label="More actions"
              style={{ top: moreMenuAt.top, right: moreMenuAt.right }}
              onClick={(e) => e.stopPropagation()}
              className="fixed w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40"
            >
              <MenuButton icon={<IconUpload className="h-4 w-4" />} label="Import Customers" onClick={openImportModal} />

              <ExportMenuItem
                icon={<IconDownload className="h-4 w-4" />}
                label="Export Customers"
                expanded={expandedExport === "all"}
                onToggle={() => setExpandedExport((v) => (v === "all" ? null : "all"))}
                onPick={handleExportAll}
              />
              <ExportMenuItem
                icon={<IconDownload className="h-4 w-4" />}
                label="Export Current View"
                expanded={expandedExport === "view"}
                onToggle={() => setExpandedExport((v) => (v === "view" ? null : "view"))}
                onPick={handleExportCurrentView}
              />

              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />

              <MenuButton
                icon={<IconSliders className="h-4 w-4" />}
                label="Customize Columns"
                onClick={() => {
                  closeMoreMenu();
                  openCustomizeModal();
                }}
              />
              <MenuButton icon={<IconRefresh className="h-4 w-4" />} label="Refresh List" onClick={handleRefresh} />
              <MenuButton
                icon={<IconRotateCcw className="h-4 w-4" />}
                label="Reset Column Settings"
                onClick={() => {
                  closeMoreMenu();
                  requestReset();
                }}
              />
            </div>
          </div>
        )}

        {/* Slide-over: always mounted, visibility + motion driven by classes so
            open/close animates instead of snapping in. */}
        <div
          className={`fixed inset-0 z-50 flex justify-end bg-slate-900/30 transition-opacity duration-200 dark:bg-black/50 ${
            panelOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!panelOpen}
        >
          <div
            className={`themed flex h-full w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-200 ease-out dark:bg-slate-900 ${
              panelOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {form.id ? "Edit Customer" : "Add Customer"}
              </h3>
              <button
                onClick={closePanel}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <FormSection title="Basic Details">
                <FormField label="Customer Code">
                  <input
                    className={inputClass}
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. CUST013"
                  />
                  {formErrors.code && <FieldError text={formErrors.code} />}
                </FormField>
                <FormField label="Customer Name">
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Business name"
                  />
                  {formErrors.name && <FieldError text={formErrors.name} />}
                </FormField>
              </FormSection>

              <FormSection title="Tax Details">
                <FormField label="GSTIN">
                  <input
                    className={inputClass}
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                    placeholder="27AAACV1234F1Z5"
                  />
                </FormField>
                <FormField label="PAN">
                  <input
                    className={inputClass}
                    value={form.pan}
                    onChange={(e) => setForm({ ...form, pan: e.target.value })}
                    placeholder="AAACV1234F"
                  />
                </FormField>
              </FormSection>

              <FormSection title="Contact Details">
                <FormField label="Contact Person">
                  <input
                    className={inputClass}
                    value={form.contact_person}
                    onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                  />
                </FormField>
                <FormField label="Email">
                  <input
                    className={inputClass}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@company.com"
                  />
                  {formErrors.email && <FieldError text={formErrors.email} />}
                </FormField>
                <FormField label="Phone">
                  <input
                    className={inputClass}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98xxx xxxxx"
                  />
                </FormField>
                <FormField label="Address">
                  <textarea
                    className={`${inputClass} min-h-[70px]`}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </FormField>
              </FormSection>

              <FormSection title="Credit Terms">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Credit Limit (₹)">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={form.credit_limit}
                      onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                    />
                    {formErrors.credit_limit && <FieldError text={formErrors.credit_limit} />}
                  </FormField>
                  <FormField label="Credit Days" hint="Due date auto-calculates from this">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={form.credit_days}
                      onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
                    />
                    {formErrors.credit_days && <FieldError text={formErrors.credit_days} />}
                  </FormField>
                </div>
              </FormSection>

              <FormSection title="Opening Balance">
                <FormField label="Opening Balance (₹)">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                  />
                  {formErrors.opening_balance && <FieldError text={formErrors.opening_balance} />}
                </FormField>
              </FormSection>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button
                onClick={closePanel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-60"
              >
                {saving ? "Saving…" : form.id ? "Save Changes" : "Add Customer"}
              </button>
            </div>
          </div>
        </div>

        {/* Import Customers modal */}
        {importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={closeImportModal} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Import Customers"
              className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Import Customers</h3>
                <button
                  onClick={closeImportModal}
                  aria-label="Close"
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <button
                  onClick={downloadSampleFile}
                  className="mb-5 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5">
                    <IconDownload className="h-4 w-4 text-brand" />
                    Download Sample File
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">Customer_Master_Sample.xlsx</span>
                </button>

                {!importResults ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                      isDragOver ? "border-brand bg-brand/5" : "border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    <IconUpload className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      {importing ? "Reading file…" : "Drag File Here"}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">.xlsx or .csv</p>
                    <label className="mt-1 cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90">
                      Browse File
                      <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileInput} disabled={importing} />
                    </label>
                  </div>
                ) : (
                  <ImportResultsView results={importResults} onPickAnother={() => setImportResults(null)} />
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <button
                  onClick={closeImportModal}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                {importResults && (
                  <button
                    onClick={handleConfirmImport}
                    disabled={importing || validImportRows.length === 0}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing ? "Importing…" : `Import ${validImportRows.length} Customer${validImportRows.length === 1 ? "" : "s"}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {columnOverlay}
      </div>

      {/* Print-only view for "Export → PDF": a complete table (not the
          on-screen filtered/customized one), shown only inside the print
          dialog. Everything else on this page is hidden while printing via
          the print:hidden wrapper above. */}
      {printPayload && (
        <div className="hidden print:block">
          <h2 className="mb-4 text-xl font-bold text-slate-900">{printPayload.title}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {printPayload.cols.map((k) => (
                  <th key={k} className="border-b-2 border-slate-400 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {EXPORT_COLUMN_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printPayload.rows.map((r) => (
                <tr key={r.id}>
                  {printPayload.cols.map((k) => (
                    <td key={k} className="border-b border-slate-200 px-2 py-1.5 text-slate-800">
                      {printCell(r, k)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function printCell(c: Customer, key: ExportColKey): string {
  switch (key) {
    case "code":
      return c.code;
    case "name":
      return c.name;
    case "contact_person":
      return c.contact_person ?? "—";
    case "email":
      return c.email ?? "—";
    case "phone":
      return c.phone ?? "—";
    case "credit_limit":
      return currency.format(c.credit_limit ?? 0);
    case "credit_days":
      return `${c.credit_days ?? 0} days`;
    case "opening_balance":
      return currency.format(c.opening_balance ?? 0);
  }
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-200 dark:hover:bg-slate-700/60"
    >
      <span className="flex h-4 w-4 flex-none items-center justify-center text-slate-400 dark:text-slate-500">{icon}</span>
      {label}
    </button>
  );
}

function ExportMenuItem({
  icon,
  label,
  expanded,
  onToggle,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  onPick: (fmt: "xlsx" | "csv" | "pdf") => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        role="menuitem"
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-200 dark:hover:bg-slate-700/60"
      >
        <span className="flex h-4 w-4 flex-none items-center justify-center text-slate-400 dark:text-slate-500">{icon}</span>
        <span className="flex-1">{label}</span>
        <IconChevronRight className={`h-3.5 w-3.5 flex-none text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && (
        <div className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-slate-100 pl-3 dark:border-slate-700">
          {(
            [
              ["xlsx", "Excel (.xlsx)"],
              ["csv", "CSV (.csv)"],
              ["pdf", "PDF (.pdf)"],
            ] as const
          ).map(([fmt, label]) => (
            <button
              key={fmt}
              onClick={() => onPick(fmt)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-300 dark:hover:bg-slate-700/60"
            >
              <IconFile className="h-3.5 w-3.5 flex-none text-slate-400" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportResultsView({
  results,
  onPickAnother,
}: {
  results: ImportRowResult[];
  onPickAnother: () => void;
}) {
  const validCount = results.filter((r) => r.data !== null).length;
  const errorRows = results.filter((r) => r.errors.length > 0);
  const shown = errorRows.slice(0, 20);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="text-sm">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{validCount} ready to import</span>
          {errorRows.length > 0 && (
            <span className="text-slate-500 dark:text-slate-400"> · {errorRows.length} with errors</span>
          )}
        </div>
        <button onClick={onPickAnother} className="text-xs font-medium text-brand hover:underline">
          Choose a different file
        </button>
      </div>

      {errorRows.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-red-200 dark:border-red-500/30">
          {shown.map((r) => (
            <div
              key={r.row}
              className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 last:border-0 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                <span className="font-semibold">Row {r.row}:</span> {r.errors.join(" ")}
              </span>
            </div>
          ))}
          {errorRows.length > shown.length && (
            <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              +{errorRows.length - shown.length} more row{errorRows.length - shown.length === 1 ? "" : "s"} with errors
            </p>
          )}
        </div>
      )}

      {validCount === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Nothing here can be imported yet — fix the rows above and choose the file again.
        </p>
      )}
    </div>
  );
}
