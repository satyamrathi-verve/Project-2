import { InvoiceForm } from "@/components/InvoiceForm";

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  return <InvoiceForm invoiceId={params.id} />;
}
