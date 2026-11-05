/**
 * The rules every form marks its wrong boxes by, kept apart from React so `node --test` can read
 * them. `components/shared/useFormErrors.js` is the hook a form actually holds.
 *
 * One convention for the whole application: a refused save puts a red message under each box that
 * is missing or wrong, and the top of the form says only how many there are - "Check the 3 fields
 * marked in red." - because the details are already where the eye goes to fix them. A banner listing
 * "Fill in Candidate Name, Candidate Email, ..." made the reader match names to boxes by hand.
 */

import { fieldError } from "../constants/fieldValidation.js";
import { isCompletePhoneNumber } from "./phoneNumber.js";

/** Whether a problems object names anything: `{ email: "Enter ..." , phone: "" }` → true. */
export function hasErrors(errors) {
  return Object.values(errors || {}).some(Boolean);
}

/** The same object without the empty entries, so "no problem" is never stored as a key. */
export function onlyErrors(problems) {
  return Object.fromEntries(Object.entries(problems || {}).filter(([, message]) => Boolean(message)));
}

/** The one line the top of a refused form shows, or "" when nothing is wrong. */
export function markedFieldsMessage(count) {
  if (!count) return "";
  return count === 1 ? "Check the field marked in red." : `Check the ${count} fields marked in red.`;
}

/**
 * The server's own field problems, keyed the way the form keys its boxes.
 *
 * Fifteen-odd routes refuse a bad body with `{ message: "Validation failed", errors: zod.flatten() }`,
 * which `apiRequest` keeps on `error.data`. `fieldErrors` there is keyed by the wire name; `keyMap`
 * renames the ones a form calls something else (`{ contactNumber: "phone" }`). The first message per
 * field is the one shown. `{}` for any failure that is not field-shaped.
 */
export function serverFieldErrors(error, keyMap = {}) {
  const fieldErrors = error?.data?.errors?.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return {};
  const found = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const message = Array.isArray(messages) ? messages.find(Boolean) : messages;
    if (message) found[keyMap[key] || key] = String(message);
  }
  return found;
}

/** Nothing typed: `""`, spaces, `null`. */
export const isBlankText = (value) => String(value ?? "").trim() === "";

/** `missing` for a blank box, the app's email format message for a malformed one, "" when fine. */
export function emailProblem(value, missing) {
  if (isBlankText(value)) return missing || "";
  return fieldError("email", String(value).trim());
}

/**
 * The same for a `PhoneField` value (`+91 9876543210`). A box holding only its country code is
 * blank; digits that do not make a whole number for that code are "Enter the full phone number."
 */
export function phoneProblem(value, missing) {
  const digits = String(value ?? "").replace(/^\s*\+\d{1,4}\s*/, "").trim();
  if (!digits) return missing || "";
  return isCompletePhoneNumber(value) ? "" : "Enter the full phone number.";
}
