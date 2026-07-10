"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseReceiptImportFile, downloadReceiptSample, type ReceiptImportRowResult } from "@/lib/receiptIO";
import { IconX } from "@/components/ui";

/*
  Import receipts from an .xlsx / .csv file (Receipt Number, Receipt Date,
  Customer Code, Amount, Payment Mode, Reference). Parses + validates every row,
  shows a preview, then inserts the valid rows into the `receipts` table as
  unallocated receipts. Customer is matched by code; duplicates and bad rows are
  flagged before any write.
*/
export function ImportReceiptsModal({
  customerByCode,
  existingReceiptNos,
  onClose,
  onImported,
}: {
  customerByCode: Map<string, { id: string; name: string }>;
  existingReceiptNos: Set<string>;
  onClose: () => void;
  onImported: (inserted: number) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<ReceiptImportRowResult[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ inserted: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validCount = results?.filter((r) => r.data !== null).length ?? 0;

  async function handleFile(file: File) {
    setParseError(null);
    setDone(null);
    setFileName(file.name);
    try {
      const { results } = await parseReceiptImportFile(file, existingReceiptNos, customerByCode);
      setResults(results);
      if (results.length === 0) setParseError("No data rows found in this file.");
    } catch (e) {
      setResults(null);
      setParseError(e instanceof Error ? e.message : "Could not read this file.");
    }
  }

  async function handleImport() {
    if (!supabase || !results) return;
    const payload = results
      .filter((r) => r.data !== null)
      .map((r) => ({
        receipt_no: r.data!.receipt_no,
        receipt_date: r.data!.receipt_date,
        customer_id: r.data!.customer_id,
        amount: r.data!.amount,
        mode: r.data!.mode,
        reference: r.data!.reference,
      }));
    if (payload.length === 0) return;
    setImporting(true);
    setParseError(null);
    const { error } = await supabase.from("receipts").insert(payload);
    setImporting(false);
    if (error) {
      setParseError(`Import failed: ${error.message}`);
      return;
    }
    setDone({ inserted: payload.length });
    onImported(payload.length);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} />
      <div className="animate-pop-in relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Import Receipts</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Upload a .xlsx or .csv file. Customer is matched by code.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {done ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">✓ Imported {done.inserted} receipt{done.inserted === 1 ? "" : "s"}</p>
              <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">They now appear in the list, ready to be allocated.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <button
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand/5 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
                >
                  Choose file
                </button>
                {fileName && <span className="truncate text-sm text-slate-500 dark:text-slate-400">{fileName}</span>}
                <button onClick={downloadReceiptSample} className="ml-auto text-sm font-medium text-brand hover:underline dark:text-blue-400">
                  Download sample template
                </button>
              </div>

              {parseError && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{parseError}</p>}

              {results && results.length > 0 && (
                <>
                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{validCount} valid</span>
                    {results.length - validCount > 0 && (
                      <span className="font-semibold text-red-600 dark:text-red-400"> · {results.length - validCount} with errors</span>
                    )}{" "}
                    of {results.length} rows. Only valid rows are imported.
                  </p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/70">
                          <tr className="text-left text-slate-500 dark:text-slate-400">
                            {["#", "Receipt", "Date", "Customer", "Amount", "Mode", "Status"].map((h) => (
                              <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((r) => {
                            const name = customerByCode.get(r.raw.customer_code.toLowerCase())?.name;
                            return (
                              <tr key={r.row} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-1.5 text-slate-400">{r.row}</td>
                                <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-100">{r.raw.receipt_no || "—"}</td>
                                <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{r.raw.receipt_date || "—"}</td>
                                <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
                                  {r.raw.customer_code || "—"}
                                  {name && <span className="text-slate-400 dark:text-slate-500"> · {name}</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.raw.amount || "—"}</td>
                                <td className="px-3 py-1.5 uppercase text-slate-600 dark:text-slate-300">{r.raw.mode || "—"}</td>
                                <td className="px-3 py-1.5">
                                  {r.data ? (
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                                      Valid
                                    </span>
                                  ) : (
                                    <span title={r.errors.join(" ")} className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                                      {r.errors[0] ?? "Invalid"}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importing ? "Importing…" : `Import ${validCount || ""} receipt${validCount === 1 ? "" : "s"}`.trim()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
