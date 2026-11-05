/**
 * The Feedback table's rows, one per project: a project's feedbacks share its Feedback ID
 * (DBS-FB-00001) and are versions of it (-01 New Project, -02 ... each shoot, the Overall Feedback
 * last), so a tab holding several of one project shows them as the Quotations register shows a
 * chain - the highest version as the row, with how many there are, and the rest folded under its
 * chevron, newest first.
 *
 * Grouped within the rows given - the tab's - so a project with one feedback under Issues and three
 * under Completed is one row on each, and nothing is ever counted on a tab it is not on. A row with
 * no version keeps the order it came in, after the versioned ones.
 *
 * Each group sits where its first row came, so the server's newest-first order holds. The row shown
 * carries `versionCount` and `groupedFeedback` (the others); a row folded under it carries
 * `isGroupedRow` and no count, so "4" is said once rather than on every line.
 */
const groupKey = (row) => row.projectKey || `row:${row.id}`;

export function groupFeedbackRows(rows = []) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, index });
  });
  // Highest version first; a row with no version yet keeps the order it came in.
  const rank = ({ row, index }) => (Number.isFinite(row.feedbackVersion) ? row.feedbackVersion : -1 - index);
  return [...groups.values()].map((members) => {
    const [lead, ...rest] = [...members].sort((a, b) => rank(b) - rank(a)).map(({ row }) => row);
    return {
      ...lead,
      versionCount: members.length,
      groupedFeedback: rest.map((row) => ({ ...row, isGroupedRow: true, versionCount: null })),
    };
  });
}

/** How many rows `groupFeedbackRows` makes of these - one per project - for a tab's count. */
export const countFeedbackGroups = (rows = []) => new Set(rows.map(groupKey)).size;

/** The rows folded under a project's row - for the table's `expandable.getSubRows`. */
export const groupedFeedbackOf = (row) => (row?.isGroupedRow ? [] : row?.groupedFeedback || []);
