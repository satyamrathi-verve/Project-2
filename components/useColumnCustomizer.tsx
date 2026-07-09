"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconSliders, IconRotateCcw, IconSearch, IconX, IconAlertTriangle } from "@/components/ui";

export interface ColumnDef<K extends string> {
  key: K;
  label: string;
}

/**
 * Shared "customize visible columns" system (Zoho Books style): a searchable
 * checkbox list in a modal, changes apply on Save, choices persist per
 * screen in localStorage. Originally built for Receipt Entry; factored out
 * here so every list screen reuses the exact same behaviour instead of
 * re-implementing it. Column order itself is fixed (the order `defs` are
 * given in) — this only controls show/hide, matching what actually shipped
 * on Receipt Entry.
 *
 * A screen either renders <ColumnSettingsTrigger> (the compact icon-button +
 * mini menu, as Receipt Entry does) or wires openCustomizeModal/requestReset
 * into its own menu (as Customer Master's "More Actions" menu does) — either
 * way, render the returned `overlay` once at the end of the page so the
 * modal/confirm dialog aren't clipped by a table's overflow container.
 */
export function useColumnCustomizer<K extends string>(defs: ColumnDef<K>[], storageKey: string) {
  const DEFAULT = Object.fromEntries(defs.map((d) => [d.key, true])) as Record<K, boolean>;

  const [visibleCols, setVisibleCols] = useState<Record<K, boolean>>(DEFAULT);
  const [modalOpen, setModalOpen] = useState(false);
  const [draftCols, setDraftCols] = useState<Record<K, boolean>>(DEFAULT);
  const [colSearch, setColSearch] = useState("");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Restore saved column preferences after mount (so SSR markup matches).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<K, boolean>>;
        setVisibleCols((d) => ({ ...d, ...saved }));
      }
    } catch {
      /* ignore bad/blocked storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!modalOpen && !confirmResetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModalOpen(false);
        setConfirmResetOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, confirmResetOpen]);

  const draftCount = defs.filter((d) => draftCols[d.key]).length;
  const filteredDefs = defs.filter((d) => d.label.toLowerCase().includes(colSearch.trim().toLowerCase()));
  const orderedKeys = defs.filter((d) => visibleCols[d.key]).map((d) => d.key);

  function openCustomizeModal() {
    setDraftCols(visibleCols);
    setColSearch("");
    setModalOpen(true);
  }

  function toggleDraft(key: K) {
    setDraftCols((d) => ({ ...d, [key]: !d[key] }));
  }

  function saveColumns() {
    if (draftCount === 0) return;
    setVisibleCols(draftCols);
    try {
      localStorage.setItem(storageKey, JSON.stringify(draftCols));
    } catch {
      /* ignore */
    }
    setModalOpen(false);
  }

  function requestReset() {
    setConfirmResetOpen(true);
  }

  function confirmReset() {
    setVisibleCols(DEFAULT);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setConfirmResetOpen(false);
  }

  const overlay: ReactNode = (
    <>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setModalOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Customize Columns"
            className="relative flex w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/50"
          >
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <IconSliders className="h-4 w-4 flex-none text-slate-500 dark:text-slate-400" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Customize Columns</h3>
              <span className="ml-auto whitespace-nowrap text-sm font-medium text-slate-500 dark:text-slate-400">
                {draftCount} of {defs.length} Selected
              </span>
              <button
                onClick={() => setModalOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  autoFocus
                  value={colSearch}
                  onChange={(e) => setColSearch(e.target.value)}
                  placeholder="Search"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
                />
              </div>
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto px-3 pb-3">
              {filteredDefs.length === 0 ? (
                <p className="px-2.5 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  No columns match &ldquo;{colSearch}&rdquo;
                </p>
              ) : (
                filteredDefs.map((c) => (
                  <label
                    key={c.key}
                    className="mb-1 flex cursor-pointer items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors last:mb-0 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={draftCols[c.key]}
                      onChange={() => toggleDraft(c.key)}
                      className="h-4 w-4 rounded border-slate-300 accent-brand dark:border-slate-600"
                    />
                    {c.label}
                  </label>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              <button
                onClick={saveColumns}
                disabled={draftCount === 0}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              {draftCount === 0 && (
                <span className="ml-1 text-xs font-medium text-red-500 dark:text-red-400">Select at least one column</span>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setConfirmResetOpen(false)} />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Reset column settings"
            className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <IconAlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Reset column settings?</h4>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  This restores every column to visible, in the default order, on this device.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmResetOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmReset}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { visibleCols, orderedKeys, openCustomizeModal, requestReset, overlay };
}

/**
 * Compact icon-button + mini dropdown (Customize Columns / Reset Columns) —
 * the exact trigger Receipt Entry uses inside its table header. Screens with
 * their own "More Actions" menu (e.g. Customer Master) can skip this and
 * call openCustomizeModal/requestReset directly from their own menu instead.
 */
export function ColumnSettingsTrigger({ onCustomize, onReset }: { onCustomize: () => void; onReset: () => void }) {
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!menuAt) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAt]);

  return (
    <>
      <button
        type="button"
        aria-label="Table settings"
        title="Table settings"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt((open) => (open ? null : { top: r.bottom + 6, left: r.left }));
        }}
        className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
      >
        <IconSliders className="h-4 w-4" />
      </button>

      {menuAt && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuAt(null)}>
          <div
            style={{ top: menuAt.top, left: menuAt.left }}
            onClick={(e) => e.stopPropagation()}
            className="fixed w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40"
          >
            <button
              onClick={() => {
                setMenuAt(null);
                onCustomize();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-brand hover:text-white dark:text-slate-200 dark:hover:bg-brand"
            >
              <IconSliders className="h-4 w-4 flex-none" />
              Customize Columns
            </button>
            <button
              onClick={() => {
                setMenuAt(null);
                onReset();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60"
            >
              <IconRotateCcw className="h-4 w-4 flex-none" />
              Reset Columns
            </button>
          </div>
        </div>
      )}
    </>
  );
}
