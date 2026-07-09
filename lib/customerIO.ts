import * as XLSX from "xlsx";
import type { Customer } from "@/lib/types";

/*
  Import/export helpers for Customer Master's "More Actions" menu. Pure data
  in/out — no Supabase calls here, no UI. The page decides what to do with
  the parsed rows (e.g. insert them) and how to source the customer list to
  export.
*/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- sample file --------------------------------------------------------

const SAMPLE_HEADERS = [
  "Customer Code",
  "Customer Name",
  "Contact Person",
  "Email",
  "Phone",
  "Credit Limit",
  "Credit Days",
  "Opening Balance",
];

export function downloadSampleFile() {
  const sample = [
    SAMPLE_HEADERS,
    ["CUST001", "ABC Technologies Pvt Ltd", "Rajesh Sharma", "rajesh@abc.com", "+91 9876543210", 500000, 30, 0],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws["!cols"] = SAMPLE_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Customers");
  XLSX.writeFile(wb, "Customer_Master_Sample.xlsx");
}

// ---- import ---------------------------------------------------------------

export interface ImportRow {
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  credit_limit: number;
  credit_days: number;
  opening_balance: number;
}

export interface ImportRowResult {
  row: number; // spreadsheet row number (header is row 1)
  data: ImportRow | null; // null if this row failed validation
  errors: string[];
}

type ImportField = keyof ImportRow;

// Loosely match header names ("Customer Code" / "code" / "Cust. Code") so
// the sample file and reasonable variations both work.
const HEADER_ALIASES: Record<string, ImportField> = {
  customercode: "code",
  custcode: "code",
  code: "code",
  customername: "name",
  name: "name",
  contactperson: "contact_person",
  contact: "contact_person",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  creditlimit: "credit_limit",
  creditdays: "credit_days",
  openingbalance: "opening_balance",
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function readSpreadsheetRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
}

/**
 * Parses an uploaded .xlsx or .csv file into validated customer rows.
 * `existingCodes` should be every customer code already in Supabase
 * (lower-cased) so duplicates are flagged before import, not after a DB error.
 */
export async function parseImportFile(
  file: File,
  existingCodes: Set<string>
): Promise<{ results: ImportRowResult[]; validCount: number }> {
  const rows = await readSpreadsheetRows(file);
  if (rows.length === 0) return { results: [], validCount: 0 };

  const header = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const mapped = HEADER_ALIASES[h];
    if (mapped && colIndex[mapped] === undefined) colIndex[mapped] = i;
  });

  const seenInFile = new Set<string>();
  const results: ImportRowResult[] = [];

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || raw.every((c) => c === undefined || c === "")) continue; // skip blank rows

    const cell = (key: ImportField) => {
      const idx = colIndex[key];
      return idx === undefined ? "" : String(raw[idx] ?? "").trim();
    };

    const errors: string[] = [];
    const code = cell("code");
    const name = cell("name");
    const email = cell("email");

    if (!code) errors.push("Customer Code is required.");
    if (!name) errors.push("Customer Name is required.");
    if (email && !EMAIL_RE.test(email)) errors.push("Email is not a valid address.");

    const creditLimit = Number(cell("credit_limit")) || 0;
    const creditDays = Number(cell("credit_days")) || 0;
    const openingBalance = Number(cell("opening_balance")) || 0;
    if (creditLimit < 0) errors.push("Credit Limit cannot be negative.");
    if (creditDays < 0) errors.push("Credit Days cannot be negative.");
    if (openingBalance < 0) errors.push("Opening Balance cannot be negative.");

    if (code) {
      const codeLower = code.toLowerCase();
      if (existingCodes.has(codeLower)) errors.push(`Customer Code "${code}" already exists.`);
      else if (seenInFile.has(codeLower)) errors.push(`Customer Code "${code}" is repeated in this file.`);
      else seenInFile.add(codeLower);
    }

    results.push({
      row: i + 1,
      data:
        errors.length === 0
          ? {
              code,
              name,
              contact_person: cell("contact_person") || null,
              email: email || null,
              phone: cell("phone") || null,
              credit_limit: creditLimit,
              credit_days: creditDays,
              opening_balance: openingBalance,
            }
          : null,
      errors,
    });
  }

  return { results, validCount: results.filter((r) => r.data !== null).length };
}

// ---- export -----------------------------------------------------------------

export type ExportColKey =
  | "code"
  | "name"
  | "contact_person"
  | "email"
  | "phone"
  | "credit_limit"
  | "credit_days"
  | "opening_balance";

export const EXPORT_COLUMN_LABELS: Record<ExportColKey, string> = {
  code: "Customer Code",
  name: "Customer Name",
  contact_person: "Contact Person",
  email: "Email",
  phone: "Phone",
  credit_limit: "Credit Limit",
  credit_days: "Credit Days",
  opening_balance: "Opening Balance",
};

function exportValue(c: Customer, key: ExportColKey): string | number {
  switch (key) {
    case "code":
      return c.code;
    case "name":
      return c.name;
    case "contact_person":
      return c.contact_person ?? "";
    case "email":
      return c.email ?? "";
    case "phone":
      return c.phone ?? "";
    case "credit_limit":
      return c.credit_limit ?? 0;
    case "credit_days":
      return c.credit_days ?? 0;
    case "opening_balance":
      return c.opening_balance ?? 0;
  }
}

function toRows(customers: Customer[], cols: ExportColKey[]): (string | number)[][] {
  return customers.map((c) => cols.map((k) => exportValue(c, k)));
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can race the browser's download manager.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCustomersCsv(customers: Customer[], cols: ExportColKey[], filename: string) {
  const header = cols.map((k) => EXPORT_COLUMN_LABELS[k]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...toRows(customers, cols)].map((r) => r.map(esc).join(",")).join("\n");
  downloadBlob(filename, csv, "text/csv;charset=utf-8;");
}

export function exportCustomersXlsx(customers: Customer[], cols: ExportColKey[], filename: string) {
  const header = cols.map((k) => EXPORT_COLUMN_LABELS[k]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...toRows(customers, cols)]);
  ws["!cols"] = header.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Customers");
  XLSX.writeFile(wb, filename);
}
