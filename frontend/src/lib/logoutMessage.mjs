/**
 * What the Logout box, and the box after a logout, say about the day the logout leaves.
 *
 * Keyed on the day's status as the server reads it - `GET /attendance/logout-preview` before the
 * logout, and the logout's own answer after it - so the words can never disagree with what the
 * register will show. A day that is fine to leave (On time, Late, Permitted - an approved permission
 * covering the early departure) has no outcome: the logout is simply successful.
 */
const OUTCOMES = {
  Absent: { status: "Absent", className: "bg-red-50 text-red-700" },
  "Half day": { status: "Half day", className: "bg-amber-50 text-amber-800" },
  "Early exit": { status: "Early exit", className: "bg-amber-50 text-amber-800" },
};

export function logoutOutcome(status) {
  const outcome = OUTCOMES[status];
  if (!outcome) return null;
  return {
    ...outcome,
    before: `If you log out now, your attendance will be marked as ${outcome.status}.`,
    after: `Your attendance will be marked as ${outcome.status}.`,
  };
}
