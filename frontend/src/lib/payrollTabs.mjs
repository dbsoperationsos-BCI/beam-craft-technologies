/**
 * The tabs the three payroll deduction screens are read by — Advance Salary, Recovery and Policy
 * Breach — and the one of them that is not a status.
 *
 * Each screen splits its rows by where a deduction has got to: an advance is Pending or Deducted, a
 * recovery and a policy breach Active or Completed. **Skipped** is a different question asked of the
 * same rows: which ones has somebody moved off a month on the Main Page. It was answerable only by
 * filtering the Skipped Months column by hand, which is not how anybody reads a list.
 *
 * Skipped means **deferred and still owed**, not "was skipped once". A skip is kept on the row for
 * good - that is the history the Skipped Months column reads - so a deduction that was moved in
 * November and then taken in December would otherwise sit under Skipped for ever, next to ones that
 * are genuinely being pushed month after month. Once the money is back the row is settled, and
 * Deducted (or Completed) is where it belongs.
 *
 * Until then a skipped row keeps its live status, so it is on both Pending and Skipped - the tabs are
 * questions asked of the same rows rather than buckets, and the counts are not meant to add up to All.
 */
export const SKIPPED_TAB = "Skipped";

/**
 * The statuses that mean the money is back: an advance Deducted, a recovery or policy breach run
 * Completed. A row at one of these is out of the Skipped list however many months it was moved.
 */
const SETTLED = new Set(["Deducted", "Completed"]);

/** Whether a row belongs under one tab. `All` is every row; `Skipped` reads the months and the status. */
export const matchesTab = (row, tab) => {
  if (tab === "All") return true;
  if (tab === SKIPPED_TAB) return (row?.skippedMonths || []).length > 0 && !SETTLED.has(row?.status);
  return row?.status === tab;
};

/**
 * The column a row stands under on a Board, where a card sits in one column only: Skipped while it
 * is moved and still owed (as the Skipped tab reads it), else its live status. Skipped is not a
 * status, so reading `row.status` alone left the Board's Skipped column empty for ever.
 */
export const boardStatusOf = (row) => (matchesTab(row, SKIPPED_TAB) ? SKIPPED_TAB : row?.status);

/** The rows one tab shows, and the counts every tab carries. */
export const rowsForTab = (rows, tab) => (rows || []).filter((row) => matchesTab(row, tab));
export const tabCountsFor = (rows, tabs) => Object.fromEntries((tabs || []).map((tab) => [tab, rowsForTab(rows, tab).length]));
