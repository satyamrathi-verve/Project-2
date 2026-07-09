/* Simple page-through control shared by list screens. */
export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm">
      <span className="text-slate-500">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => onChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
