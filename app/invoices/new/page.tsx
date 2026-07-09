"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

/*
  Placeholder for screen 6 (Invoice Punch/Edit). Screen 4 just needs somewhere
  for "New Invoice" to link to; the real create/edit form gets built next.
*/
export default function NewInvoicePage() {
  return (
    <>
      <PageHeader title="New Invoice" />
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <p>The invoice punch/edit form (screen 6) isn&apos;t built yet.</p>
        <Link href="/invoices" className="mt-3 inline-block text-brand hover:underline">
          ← Back to invoices
        </Link>
      </div>
    </>
  );
}
