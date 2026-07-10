import * as XLSX from "xlsx";
import type { ReceiptMode } from "@/lib/types";

/*
  Import/export helpers for the Receipts "More actions" menu. Pure data in/out —
  no Supabase calls, no UI. The page sources the rows to export and decides what
  to do with the parsed import rows (insert them). Mirrors lib/customerIO.ts.
*/

const MODES = new Set<ReceiptMode>(["cash", "cheque", "upi", "neft"]);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Coerce a spreadsheet/CSV cell (Date, Excel serial, or string) to YYYY-MM-DD. */
function toISODate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY or DD-MM-YYYY
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return null;
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- export -----------------------------------------------------------------

export interface ReceiptExportRow {
  receipt_no: string;
  receipt_date: string;
  customerCode: string;
  customerName: string;
  mode: string;
  amount: number;
  allocated: number;
  unallocated: number;
  reference: string | null;
}

const EXPORT_HEADERS = [
  "Receipt Number",
  "Receipt Date",
  "Customer Code",
  "Customer Name",
  "Payment Mode",
  "Amount",
  "Allocated",
  "Unallocated",
  "Reference",
];

function toAoa(rows: ReceiptExportRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.receipt_no,
    r.receipt_date,
    r.customerCode,
    r.customerName,
    r.mode.toUpperCase(),
    r.amount,
    r.allocated,
    r.unallocated,
    r.reference ?? "",
  ]);
}

export function exportReceiptsCsv(rows: ReceiptExportRow[], filename: string) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [EXPORT_HEADERS, ...toAoa(rows)].map((r) => r.map(esc).join(",")).join("\n");
  downloadBlob(filename, csv, "text/csv;charset=utf-8;");
}

export function exportReceiptsXlsx(rows: ReceiptExportRow[], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...toAoa(rows)]);
  ws["!cols"] = EXPORT_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Receipts");
  XLSX.writeFile(wb, filename);
}

// ---- sample template --------------------------------------------------------

const IMPORT_HEADERS = ["Receipt Number", "Receipt Date", "Customer Code", "Amount", "Payment Mode", "Reference"];

export function downloadReceiptSample() {
  const sample = [
    IMPORT_HEADERS,
    ["RCP-1001", "2026-07-01", "CUST001", 25000, "neft", "TXN90001"],
    ["RCP-1002", "2026-07-02", "CUST003", 14500, "upi", "UPI778234"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws["!cols"] = IMPORT_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Receipts");
  XLSX.writeFile(wb, "Receipts_Import_Sample.xlsx");
}

// ---- import -----------------------------------------------------------------

export interface ReceiptImportRow {
  receipt_no: string;
  receipt_date: string; // YYYY-MM-DD
  customer_id: string;
  customer_code: string;
  amount: number;
  mode: ReceiptMode;
  reference: string | null;
}

export interface ReceiptImportRowResult {
  row: number; // spreadsheet row number (header is row 1)
  raw: { receipt_no: string; receipt_date: string; customer_code: string; amount: string; mode: string; reference: string };
  data: ReceiptImportRow | null; // null when the row failed validation
  errors: string[];
}

type ImportField = "receipt_no" | "receipt_date" | "customer_code" | "amount" | "mode" | "reference";

const HEADER_ALIASES: Record<string, ImportField> = {
  receiptnumber: "receipt_no",
  receiptno: "receipt_no",
  receipt: "receipt_no",
  no: "receipt_no",
  receiptdate: "receipt_date",
  date: "receipt_date",
  customercode: "customer_code",
  custcode: "customer_code",
  customer: "customer_code",
  code: "customer_code",
  amount: "amount",
  paymentmode: "mode",
  mode: "mode",
  reference: "reference",
  referencenumber: "reference",
  ref: "reference",
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function readSpreadsheetRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
}

/**
 * Parses an uploaded .xlsx or .csv file into validated receipt rows.
 * `existingReceiptNos` is every receipt_no already in Supabase (lower-cased);
 * `customerByCode` maps a lower-cased customer code to its id + name.
 */
export async function parseReceiptImportFile(
  file: File,
  existingReceiptNos: Set<string>,
  customerByCode: Map<string, { id: string; name: string }>
): Promise<{ results: ReceiptImportRowResult[]; validCount: number }> {
  const rows = await readSpreadsheetRows(file);
  if (rows.length === 0) return { results: [], validCount: 0 };

  const header = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const mapped = HEADER_ALIASES[h];
    if (mapped && colIndex[mapped] === undefined) colIndex[mapped] = i;
  });

  const seenInFile = new Set<string>();
  const results: ReceiptImportRowResult[] = [];

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || raw.every((c) => c === undefined || c === "")) continue;

    const cell = (key: ImportField) => {
      const idx = colIndex[key];
      return idx === undefined ? "" : String(raw[idx] ?? "").trim();
    };
    const rawDateCell = colIndex.receipt_date === undefined ? undefined : raw[colIndex.receipt_date];

    const errors: string[] = [];
    const receiptNo = cell("receipt_no");
    const customerCode = cell("customer_code");
    const modeRaw = cell("mode").toLowerCase();
    const amountRaw = cell("amount").replace(/[,₹\s]/g, "");
    const reference = cell("reference");
    const isoDate = toISODate(rawDateCell);

    if (!receiptNo) errors.push("Receipt Number is required.");
    if (!isoDate) errors.push("Receipt Date is missing or unrecognised (use YYYY-MM-DD).");

    const amount = Number(amountRaw);
    if (!amountRaw || Number.isNaN(amount) || amount <= 0) errors.push("Amount must be a positive number.");

    const mode = modeRaw as ReceiptMode;
    if (!MODES.has(mode)) errors.push(`Payment Mode must be one of cash / cheque / upi / neft.`);

    const cust = customerByCode.get(customerCode.toLowerCase());
    if (!customerCode) errors.push("Customer Code is required.");
    else if (!cust) errors.push(`Customer Code "${customerCode}" was not found.`);

    if (receiptNo) {
      const lower = receiptNo.toLowerCase();
      if (existingReceiptNos.has(lower)) errors.push(`Receipt Number "${receiptNo}" already exists.`);
      else if (seenInFile.has(lower)) errors.push(`Receipt Number "${receiptNo}" is repeated in this file.`);
      else seenInFile.add(lower);
    }

    results.push({
      row: i + 1,
      raw: { receipt_no: receiptNo, receipt_date: isoDate ?? cell("receipt_date"), customer_code: customerCode, amount: amountRaw, mode: modeRaw, reference },
      data:
        errors.length === 0 && isoDate && cust
          ? {
              receipt_no: receiptNo,
              receipt_date: isoDate,
              customer_id: cust.id,
              customer_code: customerCode,
              amount,
              mode,
              reference: reference || null,
            }
          : null,
      errors,
    });
  }

  return { results, validCount: results.filter((r) => r.data !== null).length };
}
