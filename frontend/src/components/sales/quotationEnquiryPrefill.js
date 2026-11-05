import { toStoredPhoneNumber } from "../../lib/phoneNumber.js";
import { verticalFieldRows } from "./quotationVerticalConfig.js";

/**
 * The Client Details a CRM lead already answers, ready to be written onto a quotation.
 *
 * The Quotation Generator asks for the same client a lead describes - `quotationVerticalConfig.js`
 * mirrors SALES -> CRM -> Add Lead field for field, deliberately - so once an Enquire ID names a
 * lead, every one of those answers is already stored and re-typing them is only a chance to type
 * them differently. This is the map from the lead's columns to the form's keys.
 *
 * Imported by relative path rather than through `@/`, and kept free of React, so the mapping can
 * be run by `node --test` - which is where its rules are actually checked, not in a browser.
 */

/*
 * The two keys whose names differ, and why. Everything else matches, because the config was
 * written against the CRM's own column names.
 *
 * `contactNumber` is the quotation's key for the client's main number, which the CRM calls
 * `phone`; `whatsappNumber` is not used for it, because the quotation states the number the
 * client enquired on. `babyContactNumber` is the quotation's rename of the CRM's own
 * `contactNumber`, so a Qua Qua lead's second number cannot overwrite the first.
 */
const RENAMED_FROM_LEAD = { contactNumber: "phone", babyContactNumber: "contactNumber" };

/** Which of the form's fields hold a phone number, so a lead's free text is stored, not shown raw. */
const PHONE_TYPES = new Set(["phone"]);

/**
 * The identification fields to apply for one lead, as `{ key: value }`.
 *
 * Scoped to the chosen vertical's own rows: a Corp lead read onto a Dum Dum quotation would
 * otherwise write a Company Name into a payload whose form has nowhere to show it, and the
 * "switch vertical?" warning counts a filled key as an answer worth losing.
 *
 * Only answers the lead actually has. A blank column is left out rather than written as "",
 * so choosing an enquiry cannot wipe a field somebody has already filled in by hand with an
 * emptiness the CRM never stated.
 */
export function identificationFromLead(lead, vertical) {
  const source = lead || {};
  const fields = (verticalFieldRows[vertical] || []).flat();
  const applied = {};
  for (const field of fields) {
    const raw = source[RENAMED_FROM_LEAD[field.key] || field.key];
    const value = PHONE_TYPES.has(field.type) ? toStoredPhoneNumber(raw) : String(raw ?? "").trim();
    if (value) applied[field.key] = value;
  }
  return applied;
}

export { RENAMED_FROM_LEAD };
