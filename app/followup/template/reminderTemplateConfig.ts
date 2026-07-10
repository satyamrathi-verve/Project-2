/*
  Config + pure helpers for the Reminder Template screen only. Kept separate
  from the page so the reminder-type rules, placeholder catalogue, validation,
  and text-editing math are easy to find without wading through JSX.

  Reminder Type maps 1:1 onto `reminder_templates.name` — there is no `type`
  column (and none is added: no schema changes here). Picking "Final Reminder"
  either loads the existing row named "Final Reminder" or, if none exists yet,
  starts from a sensible scaffold that gets INSERTed as a new row on Save.
  Existing rows that don't match one of these four names (e.g. the seeded
  "Default reminder") keep working exactly as before, under "Other templates".
*/

import type { BadgeTone } from "@/components/Badge";

export type ReminderTypeId = "before_due" | "first_reminder" | "second_reminder" | "final_reminder";

// Invoice Wise (the original, default behaviour) chases one invoice at a
// time with {invoice_no}/{amount}/{days_overdue}. Customer Wise rolls every
// outstanding invoice for that customer into one email built around the
// {invoice_table} placeholder instead — see customerWiseInvoiceTable.ts.
export type ReminderScope = "invoice_wise" | "customer_wise";

export interface ScopedTemplateDefaults {
  templateName: string;
  requiredTokens: string[];
  defaultSubject: string;
  defaultBody: string;
}

export interface ReminderTypeConfig {
  id: ReminderTypeId;
  templateName: string;
  label: string;
  description: string;
  accent: BadgeTone;
  requiredTokens: string[];
  defaultSubject: string;
  defaultBody: string;
  /** The same reminder stage, rolled up across every outstanding invoice for one customer. */
  customerWise: ScopedTemplateDefaults;
}

const CUSTOMER_WISE_SUBJECT = "Outstanding Invoices – Payment Follow Up";
const CUSTOMER_WISE_INTRO =
  "Our records indicate the following outstanding invoices are pending payment. Kindly arrange payment at your earliest convenience.";

export const REMINDER_TYPES: ReminderTypeConfig[] = [
  {
    id: "before_due",
    templateName: "Before Due",
    label: "Before Due",
    description: "A friendly heads-up sent a few days before the invoice falls due.",
    accent: "slate",
    requiredTokens: ["{customer}", "{invoice_no}"],
    defaultSubject: "Upcoming payment: invoice {invoice_no}",
    defaultBody:
      "Dear {customer},\n\nThis is a friendly reminder that invoice {invoice_no} for {amount} will be due shortly. No action is needed if payment is already scheduled.\n\nThank you,",
    customerWise: {
      templateName: "Before Due (Customer Wise)",
      requiredTokens: ["{customer}", "{invoice_table}"],
      defaultSubject: CUSTOMER_WISE_SUBJECT,
      defaultBody: `Dear {customer},\n\n${CUSTOMER_WISE_INTRO}\n\n{invoice_table}\n\nNo action is needed if payment is already scheduled.\n\nThank you,`,
    },
  },
  {
    id: "first_reminder",
    templateName: "First Reminder",
    label: "First Reminder",
    description: "The first nudge once an invoice has gone past its due date.",
    accent: "blue",
    requiredTokens: ["{customer}", "{invoice_no}", "{amount}"],
    defaultSubject: "Payment reminder: invoice {invoice_no}",
    defaultBody:
      "Dear {customer},\n\nOur records show invoice {invoice_no} for {amount} is now {days_overdue} days overdue. We would appreciate payment at your earliest convenience.\n\nWarm regards,",
    customerWise: {
      templateName: "First Reminder (Customer Wise)",
      requiredTokens: ["{customer}", "{invoice_table}"],
      defaultSubject: CUSTOMER_WISE_SUBJECT,
      defaultBody: `Dear {customer},\n\n${CUSTOMER_WISE_INTRO}\n\n{invoice_table}\n\nWe would appreciate payment at your earliest convenience.\n\nWarm regards,`,
    },
  },
  {
    id: "second_reminder",
    templateName: "Second Reminder",
    label: "Second Reminder",
    description: "A firmer follow-up when the first reminder went unanswered.",
    accent: "amber",
    requiredTokens: ["{customer}", "{invoice_no}", "{amount}", "{days_overdue}"],
    defaultSubject: "Second notice: invoice {invoice_no} still overdue",
    defaultBody:
      "Dear {customer},\n\nWe previously wrote to you about invoice {invoice_no} for {amount}, which is now {days_overdue} days overdue. Please arrange payment as soon as possible to avoid further action.\n\nRegards,",
    customerWise: {
      templateName: "Second Reminder (Customer Wise)",
      requiredTokens: ["{customer}", "{invoice_table}"],
      defaultSubject: CUSTOMER_WISE_SUBJECT,
      defaultBody: `Dear {customer},\n\n${CUSTOMER_WISE_INTRO}\n\n{invoice_table}\n\nPlease arrange payment as soon as possible to avoid further action.\n\nRegards,`,
    },
  },
  {
    id: "final_reminder",
    templateName: "Final Reminder",
    label: "Final Reminder",
    description: "The last notice before escalation — firm and specific.",
    accent: "rose",
    requiredTokens: ["{customer}", "{invoice_no}", "{amount}", "{days_overdue}"],
    defaultSubject: "Final notice: invoice {invoice_no} — immediate payment required",
    defaultBody:
      "Dear {customer},\n\nDespite previous reminders, invoice {invoice_no} for {amount} remains unpaid and is now {days_overdue} days overdue. Please settle this invoice immediately to avoid escalation.\n\nRegards,",
    customerWise: {
      templateName: "Final Reminder (Customer Wise)",
      requiredTokens: ["{customer}", "{invoice_table}"],
      defaultSubject: CUSTOMER_WISE_SUBJECT,
      defaultBody: `Dear {customer},\n\n${CUSTOMER_WISE_INTRO}\n\n{invoice_table}\n\nPlease settle these invoices immediately to avoid escalation.\n\nRegards,`,
    },
  },
];

export function reminderTypeById(id: ReminderTypeId): ReminderTypeConfig {
  return REMINDER_TYPES.find((t) => t.id === id) ?? REMINDER_TYPES[0];
}

/** Picks the Invoice Wise or Customer Wise field set for a reminder type. */
export function scopedDefaults(config: ReminderTypeConfig, scope: ReminderScope): ScopedTemplateDefaults {
  return scope === "customer_wise"
    ? config.customerWise
    : {
        templateName: config.templateName,
        requiredTokens: config.requiredTokens,
        defaultSubject: config.defaultSubject,
        defaultBody: config.defaultBody,
      };
}

export const CANONICAL_NAMES = new Set(
  REMINDER_TYPES.flatMap((t) => [t.templateName, t.customerWise.templateName])
);

// ---- placeholders -----------------------------------------------------------

export interface PlaceholderDef {
  token: string;
  label: string;
  description: string;
  category: "Customer" | "Invoice" | "Financial" | "Timing";
}

export const PLACEHOLDER_CATEGORIES = ["Customer", "Invoice", "Financial", "Timing"] as const;

export const PLACEHOLDER_CATALOG: PlaceholderDef[] = [
  { token: "{customer}", label: "Customer name", description: "The customer's registered name.", category: "Customer" },
  { token: "{invoice_no}", label: "Invoice number", description: "The invoice being chased. Invoice Wise only.", category: "Invoice" },
  { token: "{amount}", label: "Outstanding amount", description: "What's still owed on the invoice. Invoice Wise only.", category: "Financial" },
  { token: "{days_overdue}", label: "Days overdue", description: "How many days past the due date. Invoice Wise only.", category: "Timing" },
  {
    token: "{invoice_table}",
    label: "Invoice table",
    description:
      "Auto-inserted table of every outstanding invoice for the customer, with the total outstanding amount and invoice count shown below it. Customer Wise only.",
    category: "Invoice",
  },
];

/** Sample values used only to render the live preview — never sent anywhere. */
export const PREVIEW_SAMPLE = {
  customer: "Sterling Textiles Pvt Ltd",
  amount: "42,500",
  daysOverdue: "15",
  invoiceNo: "INV-0007",
};

/** Required tokens (for this reminder type) missing from subject+body combined. */
export function missingRequiredTokens(requiredTokens: string[], subject: string, body: string): string[] {
  const combined = `${subject}\n${body}`;
  return requiredTokens.filter((token) => !combined.includes(token));
}

// ---- lightweight text-editing helpers (plain-text in, plain-text out) ------
//
// The stored `body` stays plain text — Auto Email Shoot and the Collections
// Workspace both call fillReminderTemplate() on it directly and render it
// with whitespace-pre-wrap, so changing its shape would ripple into those
// screens. These helpers only add **bold**/_italic_/"- bullet" characters a
// user could always have typed by hand; nothing about the stored contract
// changes, we just added toolbar shortcuts for it.

export function wrapSelection(value: string, start: number, end: number, marker: string) {
  const before = value.slice(0, start);
  const selected = value.slice(start, end) || "text";
  const after = value.slice(end);
  const next = `${before}${marker}${selected}${marker}${after}`;
  return { next, selStart: start + marker.length, selEnd: start + marker.length + selected.length };
}

export function bulletizeSelection(value: string, start: number, end: number) {
  const before = value.slice(0, start);
  const selected = value.slice(start, end) || "New point";
  const after = value.slice(end);
  const bulleted = selected
    .split("\n")
    .map((line) => (line.trim().startsWith("- ") ? line : `- ${line}`))
    .join("\n");
  const next = `${before}${bulleted}${after}`;
  return { next, selStart: start, selEnd: start + bulleted.length };
}

export function insertAtCursor(value: string, cursor: number, insertText: string) {
  const next = value.slice(0, cursor) + insertText + value.slice(cursor);
  return { next, selStart: cursor + insertText.length };
}

/** Renders the plain-text body (with its bold, italic, and bullet conventions) as safe HTML for this page's own preview only. */
export function renderFormattedHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/_(.+?)_/g, "<em>$1</em>");

  const lines = escape(text).split("\n");
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*-\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(bulletMatch[1])}</li>`);
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(line.trim() === "" ? "<br/>" : `<p>${inline(line)}</p>`);
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

// ---- attachments (simulated — no file storage exists in this schema) ------

export interface AttachmentOption {
  id: string;
  label: string;
}

export const DEFAULT_ATTACHMENT_OPTIONS: AttachmentOption[] = [
  { id: "invoice_pdf", label: "Invoice copy (PDF)" },
  { id: "statement_pdf", label: "Account statement" },
  { id: "payment_instructions", label: "Payment instructions" },
];
