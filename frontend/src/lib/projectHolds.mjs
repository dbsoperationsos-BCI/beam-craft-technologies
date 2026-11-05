import { isCompletedStatus } from "./projectStatuses.mjs";

/** The project's own hold status. */
export const HOLD_STATUS = "On Hold";

/**
 * What a project's hold badge says: the departments holding one of its shoots - "On Hold
 * (Pre-Production)", "On Hold (Production)", both - or the project's own On Hold. Null when neither
 * applies, and always for a Completed project: a shoot still held inside it shows on that shoot
 * only. `holds` comes from the server's `projectHolds.js`; a Rejected shoot is never carried up to
 * the project.
 */
export function holdLabel(status, holds = []) {
  if (isCompletedStatus(status)) return null;
  const held = (holds || []).filter(Boolean);
  if (held.length) return `${HOLD_STATUS} (${held.join(", ")})`;
  return status === HOLD_STATUS ? HOLD_STATUS : null;
}

/**
 * What a project's payments badge says: "Overdue (Accounts)" when any payment it is owed is overdue,
 * otherwise "Due (Accounts)" when any is due - never both. Null when neither, and for a Completed
 * project. `paymentsDue` comes from the server's `projectPaymentsDue`.
 */
export function paymentsDueLabel(status, paymentsDue) {
  if (isCompletedStatus(status) || !paymentsDue) return null;
  return `${paymentsDue} (Accounts)`;
}
