"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge, type BadgeTone } from "@/components/Badge";
import { inputClass, FormField } from "@/components/FormField";
import type { Invoice, Receipt, ReminderLog, ReminderTemplate } from "@/lib/types";
import {
  ageingDays,
  ageingBucket,
  fillReminderTemplate,
  formatCurrency,
  formatDate,
  invoiceOutstanding,
  todayISO,
  type CustomerAggregate,
  type FollowUpEntry,
  type PromiseToPay,
} from "@/lib/collections";

const AGEING_LABEL: Record<string, string> = {
  "not-due": "Not due",
  "0-30": "0–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

type ModalKind = "reminder" | "followup" | "ptp" | null;

interface TimelineEvent {
  date: string;
  label: string;
  tone: BadgeTone;
}

export function CustomerDrawer({
  aggregate,
  allInvoices,
  receipts,
  reminderLog,
  templates,
  followUps,
  promises,
  allocatedByInvoice,
  onClose,
  onAddFollowUp,
  onAddPromise,
  onReminderSent,
}: {
  aggregate: CustomerAggregate;
  allInvoices: Invoice[];
  receipts: Receipt[];
  reminderLog: ReminderLog[];
  templates: ReminderTemplate[];
  followUps: FollowUpEntry[];
  promises: PromiseToPay[];
  allocatedByInvoice: Map<string, number>;
  onClose: () => void;
  onAddFollowUp: (entry: FollowUpEntry) => void;
  onAddPromise: (entry: PromiseToPay) => void;
  onReminderSent: (log: ReminderLog) => void;
}) {
  const { customer } = aggregate;
  const [modal, setModal] = useState<ModalKind>(null);

  const custInvoices = allInvoices.filter((i) => i.customer_id === customer.id);
  const custReceipts = receipts.filter((r) => r.customer_id === customer.id);
  const custFollowUps = followUps
    .filter((f) => f.customerId === customer.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const custPromises = promises
    .filter((p) => p.customerId === customer.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const lastFollowUp = custFollowUps[0] ?? null;
  const latestPromise = custPromises[0] ?? null;

  const timeline: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];
    for (const inv of custInvoices) {
      events.push({ date: inv.invoice_date, label: `Invoice ${inv.invoice_no} issued (${formatCurrency(inv.total)})`, tone: "slate" });
    }
    for (const r of custReceipts) {
      events.push({ date: r.receipt_date, label: `Payment received — ${formatCurrency(r.amount)} (${r.mode.toUpperCase()})`, tone: "emerald" });
    }
    for (const log of reminderLog) {
      events.push({ date: log.sent_at.slice(0, 10), label: `Reminder email sent: "${log.subject}"`, tone: "amber" });
    }
    for (const f of custFollowUps) {
      events.push({ date: f.date, label: `${f.method} follow-up with ${f.contactedPerson} — ${f.outcome}`, tone: "blue" });
    }
    for (const p of custPromises) {
      events.push({ date: p.promiseDate, label: `Promise to Pay logged — ${formatCurrency(p.amount)} by ${p.personCommitting}`, tone: "rose" });
    }
    return events.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [custInvoices, custReceipts, reminderLog, custFollowUps, custPromises]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/30 dark:bg-black/50" />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{customer.code}</p>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">{customer.name}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 px-6 py-5">
          {/* Customer info */}
          <section>
            <SectionTitle>Customer information</SectionTitle>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="Contact person" value={customer.contact_person ?? "—"} />
              <Field label="Email" value={customer.email ?? "—"} />
              <Field label="Phone" value={customer.phone ?? "—"} />
              <Field label="Credit limit" value={formatCurrency(customer.credit_limit)} />
              <Field label="Credit days" value={`${customer.credit_days} days`} />
              <Field label="Avg. collection days" value={aggregate.avgCollectionDays !== null ? `${aggregate.avgCollectionDays} days` : "—"} />
            </dl>
          </section>

          {/* Outstanding summary */}
          <section>
            <SectionTitle>Outstanding summary</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryTile label="Total outstanding" value={formatCurrency(aggregate.outstanding)} />
              <SummaryTile label="Current (not due)" value={formatCurrency(aggregate.currentDue)} />
              <SummaryTile label="Overdue" value={formatCurrency(aggregate.overdue)} tone="rose" />
            </div>
          </section>

          {/* Actions */}
          <section className="flex flex-wrap gap-2">
            <ActionButton primary onClick={() => setModal("reminder")}>Send Reminder</ActionButton>
            <ActionButton onClick={() => setModal("followup")}>Record Follow-up</ActionButton>
            <ActionButton onClick={() => setModal("ptp")}>Record Promise to Pay</ActionButton>
            <DisabledLinkButton label="View Statement" note="Customer Statement screen not built yet" />
          </section>

          {(lastFollowUp || latestPromise) && (
            <section className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {lastFollowUp && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Last follow-up</p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{formatDate(lastFollowUp.date)} · {lastFollowUp.method}</p>
                  <p className="text-slate-500 dark:text-slate-400">Next: {formatDate(lastFollowUp.nextFollowUpDate)}</p>
                </div>
              )}
              {latestPromise && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Promise to Pay</p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{formatCurrency(latestPromise.amount)} by {formatDate(latestPromise.promiseDate)}</p>
                  <p className="text-slate-500 dark:text-slate-400">Committed by {latestPromise.personCommitting}</p>
                </div>
              )}
            </section>
          )}

          {/* Invoice summary */}
          <section>
            <SectionTitle>Invoices</SectionTitle>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-3 py-2 font-semibold">Invoice</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Due</th>
                    <th className="px-3 py-2 font-semibold text-right">Amount</th>
                    <th className="px-3 py-2 font-semibold text-right">Outstanding</th>
                    <th className="px-3 py-2 font-semibold">Ageing</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {custInvoices.map((inv) => {
                    const outstanding = invoiceOutstanding(inv, allocatedByInvoice);
                    const ageing = ageingDays(inv.due_date);
                    return (
                      <tr key={inv.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{inv.invoice_no}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatDate(inv.invoice_date)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatDate(inv.due_date)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">{formatCurrency(inv.total)}</td>
                        <td className="px-3 py-2 text-right text-slate-800 dark:text-slate-100">{formatCurrency(outstanding)}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{AGEING_LABEL[ageingBucket(ageing)]}</td>
                        <td className="px-3 py-2">
                          <InvoiceStatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-2">
                          <button disabled title="Sales Invoice View screen not built yet" className="cursor-not-allowed text-xs font-medium text-slate-300 dark:text-slate-600">
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section>
            <SectionTitle>Recent activity</SectionTitle>
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No activity yet.</p>
            ) : (
              <ol className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-800">
                {timeline.slice(0, 10).map((e, idx) => (
                  <li key={idx} className="relative text-sm">
                    <span className="absolute -left-[21px] mt-1 h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500">{formatDate(e.date)}</p>
                    <p className="text-slate-700 dark:text-slate-300">{e.label}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {modal === "reminder" && (
        <SendReminderModal
          aggregate={aggregate}
          invoices={custInvoices.filter((i) => i.status !== "paid")}
          allocatedByInvoice={allocatedByInvoice}
          templates={templates}
          onClose={() => setModal(null)}
          onSent={onReminderSent}
        />
      )}
      {modal === "followup" && (
        <FollowUpModal
          customerId={customer.id}
          onClose={() => setModal(null)}
          onSave={onAddFollowUp}
        />
      )}
      {modal === "ptp" && (
        <PromiseToPayModal
          customerId={customer.id}
          suggestedAmount={aggregate.outstanding}
          previous={latestPromise}
          onClose={() => setModal(null)}
          onSave={onAddPromise}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</p>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "rose" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
      <p className="text-xs text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-semibold ${tone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function ActionButton({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        primary ? "bg-brand text-white hover:bg-brand-dark" : "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function DisabledLinkButton({ label, note }: { label: string; note: string }) {
  return (
    <button disabled title={note} className="cursor-not-allowed rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400 dark:border-slate-800 dark:text-slate-500">
      {label}
    </button>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeTone> = { open: "slate", partial: "amber", overdue: "rose", paid: "emerald" };
  return <Badge label={status} tone={map[status] ?? "slate"} />;
}

/* ---------------- Send Reminder modal ---------------- */

function SendReminderModal({
  aggregate,
  invoices,
  allocatedByInvoice,
  templates,
  onClose,
  onSent,
}: {
  aggregate: CustomerAggregate;
  invoices: Invoice[];
  allocatedByInvoice: Map<string, number>;
  templates: ReminderTemplate[];
  onClose: () => void;
  onSent: (log: ReminderLog) => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId);
  const invoice = invoices.find((i) => i.id === invoiceId);

  const filledSubject = useMemo(() => {
    if (!template || !invoice) return "";
    return fillReminderTemplate(template.subject, {
      customer: aggregate.customer.name,
      amount: invoiceOutstanding(invoice, allocatedByInvoice),
      daysOverdue: ageingDays(invoice.due_date),
      invoiceNo: invoice.invoice_no,
    });
  }, [template, invoice, aggregate, allocatedByInvoice]);

  const [subject, setSubject] = useState(filledSubject);
  const [body, setBody] = useState("");
  const [initialised, setInitialised] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!initialised && template && invoice) {
    setSubject(filledSubject);
    setBody(
      fillReminderTemplate(template.body, {
        customer: aggregate.customer.name,
        amount: invoiceOutstanding(invoice, allocatedByInvoice),
        daysOverdue: ageingDays(invoice.due_date),
        invoiceNo: invoice.invoice_no,
      })
    );
    setInitialised(true);
  }

  async function handleSend() {
    if (!supabase || !invoice) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from("reminder_log")
      .insert({
        invoice_id: invoice.id,
        to_email: aggregate.customer.email,
        subject,
        body,
        status: "sent",
      })
      .select()
      .single();
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSent(data as ReminderLog);
    onClose();
  }

  return (
    <ModalShell title="Send Reminder" onClose={onClose}>
      {invoices.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No open invoices to remind this customer about.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Template">
              <select className={inputClass} value={templateId} onChange={(e) => { setTemplateId(e.target.value); setInitialised(false); }}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FormField>
            <FormField label="Invoice">
              <select className={inputClass} value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setInitialised(false); }}>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_no}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Subject">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label="Body">
            <textarea className={`${inputClass} min-h-[160px] font-mono text-xs`} value={body} onChange={(e) => setBody(e.target.value)} />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            This simulates sending — it writes a "sent" record to the reminder log, no real email goes out.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
            <button onClick={handleSend} disabled={sending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

/* ---------------- Record Follow-up modal ---------------- */

const METHODS: FollowUpEntry["method"][] = ["Phone", "Email", "WhatsApp", "Meeting", "Other"];

function FollowUpModal({
  customerId,
  onClose,
  onSave,
}: {
  customerId: string;
  onClose: () => void;
  onSave: (entry: FollowUpEntry) => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<FollowUpEntry["method"]>("Phone");
  const [contactedPerson, setContactedPerson] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");

  function handleSave() {
    onSave({
      id: crypto.randomUUID(),
      customerId,
      date,
      method,
      contactedPerson,
      summary,
      outcome,
      nextFollowUpDate: nextFollowUpDate || null,
      createdAt: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <ModalShell title="Record Follow-up" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Kept for this browser session only — there is no follow-up table in the database yet, so this is not saved to Supabase.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Follow-up date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Method">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as FollowUpEntry["method"])}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Person contacted">
          <input className={inputClass} value={contactedPerson} onChange={(e) => setContactedPerson(e.target.value)} />
        </FormField>
        <FormField label="Discussion summary">
          <textarea className={`${inputClass} min-h-[100px]`} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Outcome">
            <input className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Payment promised" />
          </FormField>
          <FormField label="Next follow-up date">
            <input type="date" className={inputClass} value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button onClick={handleSave} disabled={!contactedPerson || !outcome} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            Save follow-up
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ---------------- Record Promise to Pay modal ---------------- */

function PromiseToPayModal({
  customerId,
  suggestedAmount,
  previous,
  onClose,
  onSave,
}: {
  customerId: string;
  suggestedAmount: number;
  previous: PromiseToPay | null;
  onClose: () => void;
  onSave: (entry: PromiseToPay) => void;
}) {
  const [amount, setAmount] = useState(String(suggestedAmount));
  const [promiseDate, setPromiseDate] = useState(todayISO());
  const [personCommitting, setPersonCommitting] = useState("");
  const [remarks, setRemarks] = useState("");

  function handleSave() {
    onSave({
      id: crypto.randomUUID(),
      customerId,
      amount: Number(amount) || 0,
      promiseDate,
      personCommitting,
      remarks,
      createdAt: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <ModalShell title="Record Promise to Pay" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Kept for this browser session only — there is no promise-to-pay table in the database yet, so this is not saved to Supabase.
        </p>
        {previous && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50 text-xs text-slate-600 dark:text-slate-300">
            Previous commitment: {formatCurrency(previous.amount)} by {formatDate(previous.promiseDate)}, from {previous.personCommitting}
            {previous.remarks && ` — "${previous.remarks}"`}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Promise amount">
            <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField label="Promise date">
            <input type="date" className={inputClass} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Person giving commitment">
          <input className={inputClass} value={personCommitting} onChange={(e) => setPersonCommitting(e.target.value)} />
        </FormField>
        <FormField label="Remarks">
          <textarea className={`${inputClass} min-h-[80px]`} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
          <button onClick={handleSave} disabled={!personCommitting || !amount} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            Save commitment
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" />
      <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:shadow-black/50">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h4>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
