"use client";

/*
  Upload Report — CSV bulk import of Sales Invoices.

  Scope: this only creates new invoices (+ one invoice_items line per invoice)
  in the existing `invoices` / `invoice_items` tables via lib/supabase.ts.
  It never creates, alters, or drops anything, and it never overwrites an
  existing invoice — a duplicate invoice_no is always flagged and skipped.

  CSV columns expected (header row, any order):
    invoice_no, invoice_date (YYYY-MM-DD), customer_code, subtotal, description (optional)

  Everything else is computed here, the same way the rest of the app does it:
    tax_amount = subtotal * 18%
    total      = subtotal + tax_amount
    due_date   = invoice_date + the customer's credit_days
    status     = "open" (paid/overdue/partial are all derived elsewhere from
                 due_date and receipt_allocations, same as the Invoice List)
*/

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import { NotConfigured } from "@/components/NotConfigured";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, KpiCard, cx, inr } from "@/components/ui";
import type { Customer } from "@/lib/types";

const REQUIRED_COLUMNS = ["invoice_no", "invoice_date", "customer_code", "subtotal"] as const;
const TAX_RATE = 0.18;

// ---- tiny CSV helpers (no library — the files here are small and simple) ----

/** Parses CSV text into rows of string cells. Handles quoted fields with
 *  embedded commas/newlines/escaped quotes ("") per the usual CSV convention. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const clean = text.replace(/^﻿/, ""); // strip a BOM if the file has one

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking the object URL immediately can race the browser's download
  // manager and cancel the download before it finishes — give it a beat.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- row types ----

type ParsedRow = {
  id: string; // synthetic, = rowNum, so DataTable can key rows
  rowNum: number;
  invoice_no: string;
  invoice_date: string;
  customer_code: string;
  subtotal: string;
  description: string;
  customer: Customer | null;
  taxAmount: number | null;
  total: number | null;
  dueDate: string | null;
  issues: string[];
};

type SkippedEntry = { rowNum: number; invoice_no: string; reason: string };

export default function UploadReportPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [existingInvoiceNos, setExistingInvoiceNos] = useState<Set<string>>(new Set());
  const [refDataLoading, setRefDataLoading] = useState(true);
  const [refDataError, setRefDataError] = useState<string | null>(null);

  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ inserted: number; skipped: SkippedEntry[] } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadRefData() {
      if (!supabase) return;
      setRefDataLoading(true);
      setRefDataError(null);
      const [customersRes, invoicesRes] = await Promise.all([
        supabase.from("customers").select("*").order("code"),
        supabase.from("invoices").select("invoice_no"),
      ]);
      if (customersRes.error) {
        setRefDataError(customersRes.error.message);
      } else if (invoicesRes.error) {
        setRefDataError(invoicesRes.error.message);
      } else {
        setCustomers((customersRes.data ?? []) as Customer[]);
        setExistingInvoiceNos(
          new Set((invoicesRes.data ?? []).map((r: { invoice_no: string }) => r.invoice_no.trim().toLowerCase()))
        );
      }
      setRefDataLoading(false);
    }
    loadRefData();
  }, []);

  const customerByCode = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.code.trim().toLowerCase(), c);
    return map;
  }, [customers]);

  function resetFile() {
    setFileInfo(null);
    setParseError(null);
    setRows(null);
    setSelected(new Set());
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileInfo(null);
      setRows(null);
      setParseError("Please choose a .csv file.");
      return;
    }

    setFileInfo({ name: file.name, size: file.size });
    setParseError(null);

    const text = await file.text();
    const table = parseCsv(text);

    if (table.length < 2) {
      setRows(null);
      setParseError("This file has no data rows (just a header, or it's empty).");
      return;
    }

    const header = table[0].map(normalizeHeader);
    const colIndex: Record<string, number> = {};
    header.forEach((h, i) => (colIndex[h] = i));

    const missing = REQUIRED_COLUMNS.filter((c) => !(c in colIndex));
    if (missing.length > 0) {
      setRows(null);
      setParseError(
        `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
          `Expected columns: invoice_no, invoice_date, customer_code, subtotal, description (optional).`
      );
      return;
    }

    const dataLines = table.slice(1);
    const seenInFile = new Map<string, number>(); // lowercased invoice_no -> first rowNum seen

    const parsed: ParsedRow[] = dataLines.map((cells, i) => {
      const rowNum = i + 2; // account for header row, 1-indexed for humans
      const get = (col: string) => (colIndex[col] !== undefined ? (cells[colIndex[col]] ?? "").trim() : "");

      const invoice_no = get("invoice_no");
      const invoice_date = get("invoice_date");
      const customer_code = get("customer_code");
      const subtotal = get("subtotal");
      const description = get("description");

      const issues: string[] = [];

      if (!invoice_no || !invoice_date || !customer_code || !subtotal) {
        issues.push("Missing required field(s)");
      }

      const key = invoice_no.trim().toLowerCase();
      if (invoice_no) {
        if (existingInvoiceNos.has(key)) {
          issues.push("Invoice no. already exists");
        } else if (seenInFile.has(key)) {
          issues.push(`Duplicate of row ${seenInFile.get(key)}`);
        } else {
          seenInFile.set(key, rowNum);
        }
      }

      if (invoice_date && !(DATE_RE.test(invoice_date) && !Number.isNaN(new Date(invoice_date).getTime()))) {
        issues.push("Invalid date (use YYYY-MM-DD)");
      }

      const customer = customer_code ? customerByCode.get(customer_code.trim().toLowerCase()) ?? null : null;
      if (customer_code && !customer) {
        issues.push("Unknown customer code");
      }

      const subtotalNum = Number(subtotal);
      const subtotalValid = subtotal !== "" && Number.isFinite(subtotalNum) && subtotalNum > 0;
      if (subtotal && !subtotalValid) {
        issues.push("Subtotal must be a positive number");
      }

      let taxAmount: number | null = null;
      let total: number | null = null;
      let dueDate: string | null = null;
      if (issues.length === 0 && customer && subtotalValid) {
        taxAmount = Math.round(subtotalNum * TAX_RATE * 100) / 100;
        total = Math.round((subtotalNum + taxAmount) * 100) / 100;
        dueDate = addDays(invoice_date, customer.credit_days ?? 0);
      }

      return {
        id: String(rowNum),
        rowNum,
        invoice_no,
        invoice_date,
        customer_code,
        subtotal,
        description,
        customer,
        taxAmount,
        total,
        dueDate,
        issues,
      };
    });

    setRows(parsed);
    setSelected(new Set(parsed.filter((r) => r.issues.length === 0).map((r) => r.id)));
  }

  const validRows = useMemo(() => (rows ?? []).filter((r) => r.issues.length === 0), [rows]);
  const problemRows = useMemo(() => (rows ?? []).filter((r) => r.issues.length > 0), [rows]);
  const selectedRows = useMemo(() => validRows.filter((r) => selected.has(r.id)), [validRows, selected]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllValid() {
    setSelected((prev) => (prev.size === validRows.length ? new Set() : new Set(validRows.map((r) => r.id))));
  }

  async function handleImport() {
    if (!supabase || importing || selectedRows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: selectedRows.length });

    let inserted = 0;
    const skipped: SkippedEntry[] = problemRows.map((r) => ({
      rowNum: r.rowNum,
      invoice_no: r.invoice_no || "(blank)",
      reason: r.issues.join("; "),
    }));

    // Insert one invoice + its item at a time, so one bad row can't block the
    // rest of the file — each row's success/failure is tracked independently.
    for (const row of selectedRows) {
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          invoice_no: row.invoice_no,
          invoice_date: row.invoice_date,
          customer_id: row.customer!.id,
          due_date: row.dueDate!,
          subtotal: Number(row.subtotal),
          tax_amount: row.taxAmount!,
          total: row.total!,
          status: "open",
        })
        .select("id")
        .single();

      if (invoiceError || !invoiceData) {
        skipped.push({ rowNum: row.rowNum, invoice_no: row.invoice_no, reason: invoiceError?.message ?? "Insert failed" });
      } else {
        const { error: itemError } = await supabase.from("invoice_items").insert({
          invoice_id: invoiceData.id,
          description: row.description || `Sale as per invoice ${row.invoice_no}`,
          qty: 1,
          rate: Number(row.subtotal),
          amount: Number(row.subtotal),
        });
        if (itemError) {
          skipped.push({ rowNum: row.rowNum, invoice_no: row.invoice_no, reason: `Invoice saved but line item failed: ${itemError.message}` });
        } else {
          inserted++;
        }
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setResult({ inserted, skipped });
    setImporting(false);
  }

  function downloadSample() {
    const sampleCustomers = customers.slice(0, 5);
    const today = new Date();
    const header = ["invoice_no", "invoice_date", "customer_code", "subtotal", "description"];
    const descriptions = [
      "Consulting services",
      "Goods supplied as per PO",
      "Monthly retainer",
      "Equipment rental",
      "Professional services",
    ];
    const body = sampleCustomers.map((c, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i); // spread the sample dates out a little
      return [
        `CSV-SAMPLE-${c.code}`,
        d.toISOString().slice(0, 10),
        c.code,
        String(5000 + i * 1500),
        descriptions[i % descriptions.length],
      ];
    });
    downloadCsv("sample_invoices.csv", toCsv(header, body));
  }

  function downloadErrorReport() {
    if (!result || result.skipped.length === 0) return;
    downloadCsv(
      "upload_errors.csv",
      toCsv(
        ["row", "invoice_no", "reason"],
        result.skipped.map((s) => [s.rowNum, s.invoice_no, s.reason])
      )
    );
  }

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Upload Report" subtitle="Bulk-import sales invoices from a CSV file." />
        <NotConfigured />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Upload Report"
        subtitle="Bulk-import sales invoices from a CSV file."
        action={
          <button
            onClick={downloadSample}
            disabled={refDataLoading || customers.length === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Download sample CSV
          </button>
        }
      />

      {refDataError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Couldn&apos;t load customers/invoices: {refDataError}
        </div>
      )}

      {/* Step 1: choose file */}
      <Card title="1. Choose a CSV file" subtitle="Columns: invoice_no, invoice_date (YYYY-MM-DD), customer_code, subtotal, description (optional)">
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark">
            Choose File
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" disabled={refDataLoading} />
          </label>
          {fileInfo && (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {fileInfo.name} · {(fileInfo.size / 1024).toFixed(1)} KB
                {rows && ` · ${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </span>
              <button onClick={resetFile} className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">
                Remove
              </button>
            </>
          )}
        </div>
        {parseError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {parseError}
          </p>
        )}
      </Card>

      {/* Step 2: preview + validate */}
      {rows && rows.length > 0 && !result && (
        <div className="mt-6">
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <KpiCard label="Total Rows" value={rows.length} accent="brand" />
            <KpiCard label="Ready to Import" value={validRows.length} sub={`${selectedRows.length} selected`} accent="emerald" />
            <KpiCard label="Rows With Issues" value={problemRows.length} sub="won't be imported" accent="red" />
          </div>

          <Card
            title="2. Preview & validate"
            subtitle="Problem rows are highlighted and can't be selected. Fix them in your CSV and re-upload if needed."
            action={
              <button onClick={toggleAllValid} className="text-xs font-medium text-brand hover:underline">
                {selected.size === validRows.length ? "Deselect all" : "Select all valid rows"}
              </button>
            }
            bodyClassName="p-0"
          >
            <PreviewTable rows={rows} selected={selected} onToggle={toggleRow} />
          </Card>

          <Card className="mt-4" title="3. Import" subtitle="You're about to add new invoices — nothing existing is changed or removed.">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This will insert <strong>{selectedRows.length}</strong> new invoice{selectedRows.length === 1 ? "" : "s"} (and one line item
              each) into the existing <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">invoices</code> and{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">invoice_items</code> tables.{" "}
              {problemRows.length > 0 && (
                <>
                  {problemRows.length} row{problemRows.length === 1 ? "" : "s"} with issues will be skipped.
                </>
              )}
            </p>

            {importing && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Imported {progress.done} of {progress.total}…
                </p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleImport}
                disabled={importing || selectedRows.length === 0}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import ${selectedRows.length} Selected Row${selectedRows.length === 1 ? "" : "s"}`}
              </button>
              <button
                onClick={resetFile}
                disabled={importing}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Step 3: summary */}
      {result && (
        <div className="mt-6">
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <KpiCard label="Rows Uploaded" value={rows?.length ?? 0} accent="brand" />
            <KpiCard label="Imported" value={result.inserted} accent="emerald" />
            <KpiCard label="Skipped" value={result.skipped.length} accent={result.skipped.length > 0 ? "red" : "brand"} />
          </div>

          <Card
            title="Import complete"
            subtitle={`Imported ${new Date().toLocaleString("en-IN")}`}
            action={
              result.skipped.length > 0 ? (
                <button onClick={downloadErrorReport} className="text-xs font-medium text-brand hover:underline">
                  Download error report
                </button>
              ) : undefined
            }
          >
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {result.inserted} invoice{result.inserted === 1 ? "" : "s"} imported successfully.
              {result.skipped.length > 0 && ` ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} skipped.`}
            </p>

            {result.skipped.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/60">
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Row</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Invoice No.</th>
                      <th className="px-3 py-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={s.rowNum} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{s.rowNum}</td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{s.invoice_no}</td>
                        <td className="px-3 py-2 text-red-600 dark:text-red-400">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Link href="/invoices" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                View Invoice List
              </Link>
              <button
                onClick={resetFile}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Upload Another File
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function PreviewTable({
  rows,
  selected,
  onToggle,
}: {
  rows: ParsedRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const columns: Column<ParsedRow>[] = [
    {
      key: "select",
      header: "",
      render: (r) =>
        r.issues.length === 0 ? (
          <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} className="h-4 w-4 accent-brand" />
        ) : (
          <span className="block h-4 w-4" />
        ),
    },
    { key: "rowNum", header: "#", render: (r) => r.rowNum },
    { key: "invoice_no", header: "Invoice No.", render: (r) => r.invoice_no || <span className="italic text-red-500">missing</span> },
    {
      key: "customer",
      header: "Customer",
      render: (r) =>
        r.customer ? (
          <span>{r.customer.name}</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">{r.customer_code || "missing"}</span>
        ),
    },
    { key: "invoice_date", header: "Invoice Date", render: (r) => r.invoice_date || <span className="italic text-red-500">missing</span> },
    { key: "due_date", header: "Due Date", render: (r) => r.dueDate ?? "—" },
    {
      key: "subtotal",
      header: "Subtotal",
      className: "text-right",
      render: (r) => (r.taxAmount !== null ? inr(Number(r.subtotal)) : r.subtotal || <span className="italic text-red-500">missing</span>),
    },
    { key: "tax", header: "Tax (18%)", className: "text-right", render: (r) => (r.taxAmount !== null ? inr(r.taxAmount) : "—") },
    { key: "total", header: "Total", className: "text-right", render: (r) => (r.total !== null ? inr(r.total) : "—") },
    {
      key: "issues",
      header: "Status",
      render: (r) =>
        r.issues.length === 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">Ready</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">{r.issues.join("; ")}</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowClassName={(r) => cx(r.issues.length > 0 && "bg-red-50/60 dark:bg-red-500/[0.06]")}
    />
  );
}
