import { isVisible, visibleFields } from "./schemaVisibility.mjs";
import { markedFieldsMessage } from "../../lib/formErrors.mjs";

/**
 * ── Which required fields a form has not been given, and where each one is ───────────────────
 *
 * Answered from the schema the panel is already drawing, so no form has to keep a second list of
 * what it asks for. A list like that is the thing that goes stale: a field added to a section and
 * not to the validator is a required field nobody is ever asked for, and one removed from the
 * section but left in the validator refuses a form over a box that is not on screen.
 *
 * Only what is **on screen** counts. `visibleFields` and `isVisible` are the same rules the panel
 * renders by, so a field behind a `when` that does not apply - a shipment address on a status form
 * that is not a shipment - is not missing, it is not being asked.
 */

/**
 * Whether an answer counts as given.
 *
 * `false` is empty, which is the whole point of a required tick or switch: an agreement nobody
 * agreed to. `0` is not - a quantity of zero is an answer somebody typed, and treating it as blank
 * is the classic way a form refuses a number that is right there on screen.
 */
export function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "boolean") return value === false;
  return false;
}

/*
 * A field the panel does not draw is a field it cannot judge.
 *
 * `custom` is whatever the caller renders, and its value need not live under its own name in
 * `values` at all - a renderer can be a heading, a preview, a table, or three inputs writing three
 * other keys. Marking one of those "Required" because `values[name]` is undefined would refuse a
 * form over a field that is complete, which is worse than the gap this closes. A caller that wants
 * a custom field checked marks it itself and passes the mark down in `errors`.
 */
const JUDGEABLE = (field) => field.type !== "custom";

/** Every field the panel is currently drawing, paired with the section it sits in. */
function fieldsWithSection(sections, leadFields, values, context) {
  const found = visibleFields(leadFields, values, context).map((field) => [field, null]);
  for (const section of sections || []) {
    // A bare `[id, title]` link points at a section drawn somewhere else, and a section whose body
    // is a `render` has no field list to read - neither has anything to check here.
    if (Array.isArray(section) || !section.fields) continue;
    if (!isVisible(section, values, context)) continue;
    for (const field of visibleFields(section.fields, values, context)) found.push([field, section.id]);
  }
  return found;
}

/**
 * The required fields with nothing in them.
 *
 * Returns `{ marks, firstSectionId, labels }` - the marks to redden the fields with, the section to
 * scroll to, and the field names in the order they appear, for a message that says which. `marks`
 * is keyed by field name so it merges straight into the `errors` the panel already passes down.
 *
 * The order is the order on screen, so "the first problem" is the first one somebody reading down
 * the form would reach rather than whichever key an object happened to yield first.
 */
export default function requiredProblems(sections, leadFields, values, context) {
  const marks = {};
  const labels = [];
  let firstSectionId;
  let foundOne = false;

  for (const [field, sectionId] of fieldsWithSection(sections, leadFields, values, context)) {
    // Resolved the way the panel draws it: a `required` that depends on the answers (or on the record
    // the form is about) must be asked the same question here, or the check would refuse a field the
    // panel never marked.
    const required = typeof field.required === "function" ? field.required(values, context) : field.required;
    if (!required || !JUDGEABLE(field)) continue;
    if (!isBlank(values?.[field.name])) continue;

    marks[field.name] = "Required";
    // A label can depend on the answers so far, the same way the panel draws it.
    const label = typeof field.label === "function" ? field.label(values, context) : field.label;
    labels.push(label || field.name);
    // The first one on screen, not the first section that has one: a lead field belongs to no
    // section, and scrolling to the top is the right answer for it.
    if (!foundOne) { firstSectionId = sectionId; foundOne = true; }
  }

  return { marks, firstSectionId, labels, hasProblems: labels.length > 0 };
}

/**
 * "Check the 3 fields marked in red." - the line above a refused form, the app's one convention
 * (`lib/formErrors.mjs`). Each field already says "Required" under itself, so naming them again
 * at the top only made the reader match names to boxes.
 */
export function describeMissing(labels) {
  return markedFieldsMessage(labels.length);
}
