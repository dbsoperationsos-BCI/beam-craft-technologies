/**
 * Bulk Entry on the Interview screen: several candidates typed in one sitting.
 *
 * Add Application asks one candidate everything a hiring form knows how to ask - four sections of
 * it - which is right for the person somebody is about to screen and wrong for twenty names off a
 * walk-in day, a campus list or a recruiter's email. This asks the few things that make a candidate
 * findable and assignable, and asks them again for the next one.
 *
 * The CRM's `crmBulkImport.mjs` for candidates rather than leads, and it keeps that module's two
 * decisions on purpose, because they are the same decisions:
 *
 *   * **The required set is the narrow one.** A name and a number make a candidate findable, and a
 *     position makes the row worth filing. Everything else is optional: a batch is very often typed
 *     off a list nobody has read yet, and requiring an answer would mean inventing one.
 *   * **No status is chosen, so every row lands in Yet to Connect.** Twenty names typed off a
 *     walk-in day are people nobody has spoken to yet, and stamping them anything else would say
 *     somebody had. This is where Bulk Entry parts company with Add Application, which offers the
 *     stage because it is one candidate being written up as they are worked.
 *
 * Here rather than in the dialog so the rule can be held to account by `node --test`, and so the
 * one place that decides what a batch asks is a place a test can read.
 */

/*
 * The fields, in the order they are asked.
 *
 * `type` is what the dialog draws: `text` a box, `phone` the country-and-number pair, `position`
 * and `source` the two comboboxes whose options the dialog supplies, `date` a calendar, `textarea`
 * a note. The same vocabulary the CRM's bulk entry uses, so the two dialogs draw from one shape.
 */
export const BULK_ENTRY_FIELDS = [
  { key: "name", label: "Candidate Name", type: "text", required: true },
  { key: "phone", label: "Phone", type: "phone", required: true },
  { key: "position", label: "Position", type: "position", required: true },
  { key: "experience", label: "Experience", type: "text" },
  { key: "source", label: "Source", type: "source" },
  // No interviewer. The studio has one HR, so there is nobody to assign a batch to and a picker
  // with one name in it is a question with one answer, asked thirty times.
  { key: "nextFollowUpDate", label: "Next Follow-up", type: "date" },
  { key: "remarks", label: "Notes", type: "textarea" },
];

/** How many candidates one sitting takes. The same cap the CRM's Bulk Entry sets. */
export const MAX_BULK_ENTRIES = 50;

/*
 * The fields this form answers for the person rather than asking them.
 *
 * They do not count towards whether a row has been *touched*: a row carrying nothing but a date the
 * form put there is a row nobody has filled in, and the trailing blank the dialog keeps at the end
 * would otherwise be posted as a nameless candidate the moment it was created.
 */
const PREFILLED_KEYS = ["nextFollowUpDate"];

/**
 * A blank row. `today` fills the Next Follow-up Date, because a candidate being written down is one
 * somebody is about to call, and left blank it was a field answered by hand on every row - the rows
 * nobody answered it on being exactly the candidates nobody chases. Passed in rather than read
 * here, so the caller decides which day it is and this stays a function a test can pin.
 */
export function emptyBulkEntryRow({ today = "" } = {}) {
  return {
    name: "",
    phone: "",
    position: "",
    experience: "",
    source: "",
    nextFollowUpDate: today,
    remarks: "",
  };
}

const filled = (value) => String(value ?? "").trim() !== "";

/** The required answers this row is still missing, as the labels the dialog marks in red. */
export function missingBulkEntryFields(row = {}) {
  return BULK_ENTRY_FIELDS.filter((field) => field.required && !filled(row[field.key])).map((field) => field.label);
}

/**
 * Whether a row has been touched at all - a blank one is not an error, it is one nobody filled.
 *
 * Judged on what the person answers, not on what the form answered for them: see `PREFILLED_KEYS`.
 */
export function isBlankBulkEntryRow(row = {}) {
  return BULK_ENTRY_FIELDS.filter((field) => !PREFILLED_KEYS.includes(field.key)).every((field) => !filled(row[field.key]));
}

/**
 * One row as the record `POST /api/hrm/interview/candidates/bulk` takes - the same shape Add
 * Application posts, so both doors write a candidate the same way.
 *
 * **No status is sent at all**, which is what puts these candidates in Yet to Connect: the server
 * files a candidate whose status nobody stated into the first stage (`prepareValues`), so leaving
 * it out is both the honest answer for a batch and the one that cannot drift from the server's own
 * idea of which stage is first. `appliedDate` is the day the batch is being typed, which is the
 * only date these candidates have and the one every tab files them under.
 */
export function bulkEntryRecord(row = {}, { today = "" } = {}) {
  const value = (key) => String(row[key] ?? "").trim();
  return {
    name: value("name"),
    phone: value("phone"),
    position: value("position"),
    experience: value("experience"),
    source: value("source"),
    nextFollowUpDate: value("nextFollowUpDate"),
    remarks: value("remarks"),
    appliedDate: today,
  };
}

/**
 * The whole batch, as records. Blank rows are dropped rather than refused: the dialog always keeps
 * one empty row at the end to type into, and posting it would create a nameless candidate.
 */
export function bulkEntryRecords(rows = [], context = {}) {
  return rows.filter((row) => !isBlankBulkEntryRow(row)).map((row) => bulkEntryRecord(row, context));
}

/**
 * What is wrong with the batch, as a sentence, or "" when nothing is.
 *
 * Named per row rather than as a count: "2 answers missing" on a form of eight rows is a message
 * somebody has to go and search, and the rows are numbered on screen for exactly this.
 */
export function bulkEntryProblem(rows = []) {
  const entered = rows.filter((row) => !isBlankBulkEntryRow(row));
  if (!entered.length) return "Fill in at least one candidate before adding.";
  const incomplete = entered
    .map((row) => ({ position: rows.indexOf(row) + 1, missing: missingBulkEntryFields(row) }))
    .filter((entry) => entry.missing.length);
  if (!incomplete.length) return "";
  return incomplete.map((entry) => `Candidate ${entry.position}: ${entry.missing.join(", ")}`).join(" · ");
}
