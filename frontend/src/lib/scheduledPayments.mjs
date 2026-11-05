/*
 * Scheduled payments on Accounts Manager: the tabs, the colours, and what the payment form's Status asks.
 * Where a payment stands is worked out by the server (`scheduled-payments/service.js`); this only
 * reads it.
 */

/**
 * The tabs scheduled payments add to Accounts Manager's status bar, after All / Received / Spent.
 * What has been received is already under Received as its cash entry, so it has no tab here.
 */
export const SCHEDULED_PAYMENT_TABS = ["Due", "Overdue", "On Hold"];

/** The house colours: green active, amber due or held, red overdue. */
export const PAYMENT_STATUS_TONES = {
  Active: "bg-emerald-50 text-emerald-700",
  Due: "bg-amber-50 text-amber-800",
  Overdue: "bg-red-50 text-red-700",
  "On Hold": "bg-amber-50 text-amber-800",
  Hold: "bg-amber-50 text-amber-800",
};

/** The project's Accounts status, from its payments alone - the project's own status never changes it. */
export function accountsStatusLabel(payment) {
  return payment?.projectAccountsStatus || null;
}

/** The form's Status choices for a payment: leave it, Clear, Partially paid, On Hold - or take it off hold. */
export function statusChoices(payment, { canRecordCash }) {
  if (!payment || payment.status === "Cleared") return [];
  return [
    { value: "AUTO", label: payment.holdAt ? "Take off hold" : payment.status },
    ...(canRecordCash && Number(payment.pending) > 0 ? [{ value: "CLEAR", label: "Clear" }, { value: "PARTIAL", label: "Partially paid" }] : []),
    ...(payment.holdAt ? [] : [{ value: "HOLD", label: "On Hold" }]),
  ];
}

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

/** What is left after a part payment of `paid`. */
export const pendingAfter = (payment, paid) => money(Math.max(0, Number(payment?.pending || 0) - Number(paid || 0)));

/**
 * What the form's Save does, or why it cannot yet: `{ action, problem }`. `value` is the Status
 * field's `{ choice, remarks, paidAmount, pendingDueDate }`; `todayKey` is today as YYYY-MM-DD.
 *   none     nothing chosen - the payment stays as it is
 *   release  take a held payment off hold
 *   hold     put it on hold, with its remarks
 *   clear    open the cash received for the whole pending amount
 *   partial  the amount paid, the pending amount, its due date - then the cash received
 * A refusal also says which box it is about (`field`: choice, remarks, paidAmount, pendingDueDate).
 */
export function paymentStatusAction(payment, value, todayKey) {
  const choice = value?.choice || "AUTO";
  if (choice === "AUTO") return { action: payment?.holdAt ? "release" : "none", problem: "" };
  if (choice === "HOLD") return String(value.remarks || "").trim() ? { action: "hold", problem: "" } : { action: "hold", problem: "Add the remarks for the hold.", field: "remarks" };
  if (choice === "CLEAR") return Number(payment?.pending) > 0 ? { action: "clear", problem: "" } : { action: "clear", problem: "There is nothing to receive yet: the project has no Signed Quotation.", field: "choice" };
  if (choice === "PARTIAL") {
    const paid = Number(value.paidAmount);
    if (!(paid > 0)) return { action: "partial", problem: "Enter the amount paid.", field: "paidAmount" };
    if (!(paid < Number(payment?.pending || 0))) return { action: "partial", problem: `The amount paid must be less than the pending ₹${payment?.pending}. Choose Clear for all of it.`, field: "paidAmount" };
    if (!value.pendingDueDate) return { action: "partial", problem: "Choose the due date for the pending amount.", field: "pendingDueDate" };
    if (value.pendingDueDate < todayKey) return { action: "partial", problem: "The pending amount's due date cannot be in the past.", field: "pendingDueDate" };
    return { action: "partial", problem: "" };
  }
  return { action: "none", problem: "" };
}

/** The tabs whose payments are shown one row per project, its payments under it: Due and Overdue. */
export const GROUPED_PAYMENT_TABS = ["Due", "Overdue"];

/**
 * One row per project, its payments under it - for Accounts Manager's Due and Overdue. A project with
 * one payment on the tab stays that payment's own row. One with several becomes a project row that
 * sums them - the earliest due date, the total amount and pending, "N payments" for the category -
 * with each payment under it (`payments`), and each keeps its own ⋮ View / Record. The project row has
 * no ⋮: it is not a payment, and recording "the project" would not say which one.
 *
 * Kept in the order the payments came, earliest due first, so a project sits where its most urgent
 * payment would.
 */
export function groupPaymentsByProject(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.projectId || row.eventId || row.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, payments]) => {
    if (payments.length === 1) return payments[0];
    const [first] = payments;
    const sum = (field) => payments.reduce((total, payment) => total + (Number(payment[field]) || 0), 0);
    const dated = payments.map((payment) => payment.dueDate).filter(Boolean).sort();
    return {
      id: `project:${key}`,
      isProjectGroup: true,
      projectId: first.projectId,
      eventId: first.eventId,
      clientName: first.clientName,
      branch: first.branch,
      projectAccountsStatus: first.projectAccountsStatus,
      status: first.status,
      category: `${payments.length} payments`,
      dueDate: dated[0] || null,
      dueRule: dated.length ? null : first.dueRule,
      amount: sum("amount"),
      pending: sum("pending"),
      payments,
    };
  });
}
