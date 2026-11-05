/**
 * Import Leads: several leads typed in one sitting, onto one vertical.
 *
 * Add Lead asks one client everything its vertical knows how to ask - two dozen fields, a shoot
 * table and a remarks box - which is right for the lead somebody is about to work and wrong for
 * twenty names off an event, a walk-in list or a phone call with a planner. This asks the few
 * things that make a lead findable and assignable, and asks them again for the next client.
 *
 * ── One vertical for the batch ──
 *
 * Chosen once, at the top, the way Add Lead asks it - and it opens on the board being read, so
 * standing on Qua Qua and importing gives Qua Qua leads without a press. A batch typed in one
 * sitting is almost always of one kind: a day's names off one event, one campaign, one call with a
 * planner. Asking it per row was answering a question nobody had, thirty times.
 *
 * It also decides what the rows are asked, which is the second reason it belongs at the top rather
 * than in the row: one vertical means one set of columns, so the rows line up and a column can be
 * read down. A batch of two kinds is two imports, which is a press, and the price of that is far
 * lower than a form that cannot be read across.
 *
 * ── What each vertical asks ──
 *
 * The same six questions, plus one for Qua Qua. Every vertical takes a Description, because the
 * useful thing about a name typed off a call is very often a sentence rather than a field - what
 * they asked for, when they are free, who sent them - and a vertical without somewhere to put it
 * means that sentence going into the name or nowhere.
 *
 * Qua Qua's extra is the baby's date of birth or the mother's expected date - what its shoots are
 * scheduled from and what the Newborns and Birthdays tabs read. It is asked and not demanded: a
 * batch is very often typed off names nobody has spoken to yet, and refusing the row until somebody
 * supplies a date buys an invented one - worse than an empty one, since those two tabs plan shoots
 * off it - or no lead at all. It is filled in from the lead popup once it is known.
 *
 * Here rather than in the dialog so the rule can be held to account by `node --test`, and so the one
 * place that decides what a vertical asks is a place a test can read.
 */

import { normalizeVertical } from "./crmOptions.js";
import { normalizeRemarkEntries } from "./crmRemarks.mjs";

/*
 * The fields, in the order they are asked.
 *
 * `type` is what the dialog draws: `text` a box, `phone` the country-and-number pair, `branch` and
 * `crm` the two pickers whose options the dialog supplies, `date` a calendar, `textarea` a note.
 *
 * `required` is the same line Add Lead draws for these fields, and no further: a name, a number and
 * a branch make a lead findable and filable, and that is the whole of it. Assign To, Next Follow-up
 * Date and Qua Qua's date are deliberately optional - a batch is very often typed before anybody has
 * decided who is taking it or asked the mother for a date, and requiring an answer would mean
 * inventing one.
 */
const NAME = { key: "name", label: "Enquire Name", type: "text", required: true };
const CONTACT = { key: "phone", label: "Contact", type: "phone", required: true };
const BRANCH = { key: "assignedBranch", label: "Assigned Branch", type: "branch", required: true };
const ASSIGN_TO = { key: "crm", label: "Assign To", type: "crm" };
const FOLLOW_UP = { key: "nextFollowUpDate", label: "Next Follow-up Date", type: "date" };
const DESCRIPTION = { key: "remarks", label: "Description", type: "textarea" };
const DOB_EDOD = { key: "dateOfBirthOrEdod", label: "Date of Birth (or) EDOD", type: "date" };

export const BULK_IMPORT_FIELDS = {
  "Dum Dum": [NAME, CONTACT, BRANCH, ASSIGN_TO, FOLLOW_UP, DESCRIPTION],
  "Qua Qua": [NAME, CONTACT, BRANCH, DOB_EDOD, ASSIGN_TO, FOLLOW_UP, DESCRIPTION],
  Corp: [NAME, CONTACT, BRANCH, ASSIGN_TO, FOLLOW_UP, DESCRIPTION],
};

export const BULK_IMPORT_VERTICALS = Object.keys(BULK_IMPORT_FIELDS);

/** The vertical a batch is on. Anything unrecognised reads as Dum Dum, as it does everywhere else. */
export const bulkImportVertical = (vertical) => normalizeVertical(vertical) || "Dum Dum";

/** What this vertical asks. */
export function bulkImportFields(vertical) {
  return BULK_IMPORT_FIELDS[bulkImportVertical(vertical)];
}

/*
 * The fields this form answers for the person rather than asking them.
 *
 * They do not count towards whether a row has been *touched*: a row carrying nothing but a date the
 * form put there is a row nobody has filled in, and the trailing blank the dialog keeps at the end
 * would otherwise be posted as a nameless lead the moment it was created. See `isBlankBulkImportRow`.
 */
const PREFILLED_KEYS = ["nextFollowUpDate"];

/**
 * A blank row.
 *
 * Every key the three verticals between them use is present and empty, rather than only the chosen
 * vertical's. Switching the batch from Qua Qua to Corp keeps whatever was typed into the fields the
 * two share - the names, the numbers, the branches - and `bulkImportRecord` drops the rest on the
 * way out, so nothing switched away from is ever saved and nothing is lost by switching back.
 *
 * `today` fills the Next Follow-up Date, on all three verticals. A lead being written down is one
 * somebody is about to work, and the next call is almost always the same day it was taken; left
 * blank it was a field answered by hand on every row, and the rows nobody answered it on are the
 * leads that appear on no Pending Followups tab and are chased by nobody. Passed in rather than read
 * here, so the caller decides which day it is - and so this stays a function a test can pin.
 */
export function emptyBulkImportRow({ today = "" } = {}) {
  return {
    name: "",
    phone: "",
    assignedBranch: "",
    crm: "",
    nextFollowUpDate: today,
    dateOfBirthOrEdod: "",
    remarks: "",
  };
}

const filled = (value) => String(value ?? "").trim() !== "";

/** The required answers this row is still missing, as the labels the dialog marks in red. */
export function missingBulkImportFields(row = {}, vertical) {
  return bulkImportFields(vertical)
    .filter((field) => field.required && !filled(row[field.key]))
    .map((field) => field.label);
}

/**
 * Whether a row has been touched at all - a blank one is not an error, it is one nobody filled.
 *
 * Judged on what the person answers, not on what the form answered for them: `PREFILLED_KEYS` are
 * skipped, so a row holding only the Next Follow-up Date this form put there is still blank. Without
 * that, the trailing blank row the dialog keeps at the end would count as a client the moment it
 * appeared - posted as a lead with a date and no name, and never removable, because the dialog would
 * keep adding another one behind it.
 */
export function isBlankBulkImportRow(row = {}, vertical) {
  return bulkImportFields(vertical)
    .filter((field) => !PREFILLED_KEYS.includes(field.key))
    .every((field) => !filled(row[field.key]));
}

/**
 * One row as the record `POST /api/sales/crm-leads/bulk` takes.
 *
 * The same two halves Add Lead sends, and for the same reasons:
 *
 *   * No `id`. An enquiry id counts within its own vertical and branch, and only the server's
 *     counter knows where that pair has got to - so it is minted there, per record, from the
 *     vertical and branch on this record.
 *   * `groupId` / `groupName` / `groupType` say this was typed by a person rather than delivered by
 *     Callyzer or pulled from a sheet. The Source column, the group menu and the reports all read
 *     it, and a lead with none reads as having come from nowhere.
 *   * No status at all, which is what puts these leads in **Yet to connect**. That label is not a
 *     value anything stores - it is what a lead with an empty status column reads as, on the board,
 *     in the tab's own SQL and in the Status cell - so leaving the status blank is the only way to
 *     file a lead in that queue, and setting one is the only thing that takes it out again. It is
 *     also the truthful answer for a batch: twenty names typed off an event are names nobody has
 *     rung yet, and stamping them Interested said somebody had. This is where Bulk Entry parts
 *     company with Add Lead, which stamps Interested because it is one client being written up as
 *     they are worked. The three outcomes that end a conversation are not offered on the way in
 *     either way.
 *
 * Only the batch vertical's fields are carried. An answer left behind by switching the vertical
 * mid-entry belongs to a form these leads are not on, which is the same rule Add Lead applies to its
 * own custom fields.
 */
export function bulkImportRecord(row = {}, { vertical, today = "", addedTime = "" } = {}) {
  const board = bulkImportVertical(vertical);
  const fields = bulkImportFields(board);
  const value = (key) => {
    const field = fields.find((entry) => entry.key === key);
    return field ? String(row[key] ?? "").trim() : "";
  };

  const description = value("remarks");
  return {
    lead: {
      id: "",
      vertical: board,
      name: value("name"),
      phone: value("phone"),
      assignedBranch: value("assignedBranch"),
      crm: value("crm"),
      dateOfBirthOrEdod: value("dateOfBirthOrEdod"),
      /*
       * The day the batch is being typed, for every row in it.
       *
       * The dialog asks for no Enquiry Date - the studio does not want to be asked, here or on Add
       * Lead - so this is the only date these leads have, and it is the one every tab on the board
       * files them under. `today` is passed in by the caller, which mounts the dialog when it opens,
       * so it is the day the sitting actually happened rather than the day the page was built.
       * A lead that needs another date is backdated from the lead popup after it is saved.
       */
      createdDate: today,
      addedTime,
    },
    details: {
      groupId: "manual",
      groupName: "Manual entry leads",
      groupType: "manual",
      leadStatus: "",
      nextFollowUpDate: value("nextFollowUpDate"),
      /*
       * The description, as both the summary column and one remark.
       *
       * The board's Remarks column reads the flat string and the lead popup reads the entries, so a
       * note written here is written to both - which is why a bulk-entered lead was never caught by
       * the bug that hid an imported one's remark, and why it still should not be.
       *
       * Built by `normalizeRemarkEntries` rather than by hand. The shape was copied out here and
       * the copy went stale the moment the original gained a key: a description arrived as an entry
       * subtly unlike every other one on the lead. Handing it the string is also what makes the
       * empty case right - nothing, rather than a blank remark drawing an empty row in the popup.
       */
      remarks: description,
      remarkEntries: normalizeRemarkEntries(description),
    },
  };
}

/**
 * The whole batch, as records.
 *
 * Blank rows are dropped rather than refused: the dialog always keeps one empty row at the end to
 * type into, and posting it would create a nameless lead.
 */
export function bulkImportRecords(rows = [], context = {}) {
  return rows
    .filter((row) => !isBlankBulkImportRow(row, context.vertical))
    .map((row) => bulkImportRecord(row, context));
}

/**
 * What is wrong with the batch, as a sentence, or "" when nothing is.
 *
 * Named per row rather than as a count: "2 answers missing" on a form of eight rows is a message
 * somebody has to go and search, and the rows are numbered on screen for exactly this.
 */
export function bulkImportProblem(rows = [], vertical) {
  const entered = rows.filter((row) => !isBlankBulkImportRow(row, vertical));
  if (!entered.length) return "Fill in at least one client before importing.";
  const incomplete = entered
    .map((row) => ({ position: rows.indexOf(row) + 1, missing: missingBulkImportFields(row, vertical) }))
    .filter((entry) => entry.missing.length);
  if (!incomplete.length) return "";
  return incomplete
    .map((entry) => `Client ${entry.position}: ${entry.missing.join(", ")}`)
    .join(" · ");
}
