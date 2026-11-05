/**
 * Whether anybody has actually typed into the Add Lead form.
 *
 * Asked before the form is closed and emptied, which is what decides whether the ×, Cancel, Escape
 * and a press on the dim behind it stop to ask anything.
 *
 * The form is never empty, which is why this cannot be a comparison against a blank one: it opens
 * carrying today's date, the current time, a vertical, a status and one blank shoot row. Warning on
 * those would put a prompt in front of somebody who opened the form and changed their mind, which
 * is the fastest way to teach a studio to click through warnings without reading them.
 *
 * Here rather than in the component so the rule can be held to account by `node --test`: what counts
 * as "typed" is the whole of this decision, and it is worth being able to state it in a test.
 */

/**
 * The answers the form fills in for itself. None of them is evidence that anybody has typed.
 *
 * `addedTime` and `createdDate` are stamped when the form is built, `nextFollowUpDate` opens on
 * today, and `vertical` and `leadStatus` open on the board's own defaults - see `emptyLeadForm`.
 */
export const AUTO_FILLED_LEAD_FIELDS = new Set([
  "addedTime",
  "createdDate",
  "nextFollowUpDate",
  "vertical",
  "leadStatus",
]);

/** Whether one value - a string, a nested answer map, a row - holds anything somebody put there. */
function holdsAnything(value) {
  if (value === null || value === undefined) return false;
  // A row list: one blank shoot row is what the form opens with, so the rows are judged by their
  // own contents rather than by there being one.
  if (Array.isArray(value)) return value.some((entry) => holdsAnything(entry));
  if (typeof value === "object") return Object.values(value).some((entry) => holdsAnything(entry));
  return String(value).trim() !== "";
}

/**
 * True once anything has been entered that the form did not put there itself.
 *
 * Read at the moment the browser asks, not when the listener was attached, so a lead typed after
 * the form opened still counts.
 */
export function leadFormHasEntries(form) {
  if (!form || typeof form !== "object") return false;
  return Object.entries(form).some(([key, value]) => !AUTO_FILLED_LEAD_FIELDS.has(key) && holdsAnything(value));
}
