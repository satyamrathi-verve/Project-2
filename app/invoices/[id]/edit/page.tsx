"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";

/*
  Placeholder for screen 6 (Invoice Edit/Punch). The Sales Invoice List and
  Invoice View screens both link here already; the real create/edit form
  gets built next.
*/
export default function InvoiceEditPage() {
  const params = useParams<{ id: string }>();

  return (
    <>
      <PageHeader title="Edit Invoice" subtitle={`Invoice ${params.id}`} />
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <p>The invoice edit form (screen 6) isn&apos;t built yet.</p>
        <Link href={`/invoices/${params.id}`} className="mt-3 inline-block text-brand hover:underline">
          ← Back to invoice
        </Link>
      </div>
    </>
  );
}
