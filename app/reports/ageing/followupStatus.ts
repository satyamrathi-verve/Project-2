/*
  Follow-up Status widget — calculation only, kept apart from the card's JSX.

  Due Today / Overdue / Upcoming / Not Scheduled all describe a *next
  follow-up date* per customer or invoice — and that has nowhere to live in
  the existing schema:
    - reminder_log only records reminders that were already sent (sent_at),
      never what's scheduled next.
    - The Collections Workspace's own follow-up entries (see lib/collections.ts
      FollowUpEntry.nextFollowUpDate) are kept in that page's local React
      state only, and are explicitly NOT written to Supabase — so they don't
      exist here, on a different page, after a refresh either.

  So there is currently no persisted, queryable source for this widget to
  read, and per the "never alter tables" rule this report can't add one.
  computeFollowUpStatus() returns "Not Available" (null) for every count.

  --- Where to connect real data later --------------------------------------
  If a follow-up/next-action date ever becomes available (e.g. a future
  `follow_ups` table, or a shared store the Collections Workspace writes to),
  replace the body below with real bucketing against today's date:
    dueToday     = count where nextFollowUpDate === today
    overdue      = count where nextFollowUpDate < today
    upcoming     = count where nextFollowUpDate > today
    notScheduled = count of customers/invoices with no nextFollowUpDate at all
  The card component reads whatever this function returns, so no UI change
  would be needed — only this function's body.
*/

export interface FollowUpStatusCounts {
  dueToday: number | null;
  overdue: number | null;
  upcoming: number | null;
  notScheduled: number | null;
}

export function computeFollowUpStatus(): FollowUpStatusCounts {
  return { dueToday: null, overdue: null, upcoming: null, notScheduled: null };
}
