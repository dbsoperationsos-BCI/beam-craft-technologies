import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BULK_ENTRY_FIELDS,
  MAX_BULK_ENTRIES,
  bulkEntryProblem,
  bulkEntryRecord,
  bulkEntryRecords,
  emptyBulkEntryRow,
  isBlankBulkEntryRow,
  missingBulkEntryFields,
} from "../src/lib/interviewBulkEntry.mjs";
import { CANDIDATE_STATUSES, DEFAULT_CANDIDATE_STATUS, ONBOARDED_STATUS, INTERVIEW_MODES, candidateModeStyles, candidateStatusCounts, candidatesForStatus, candidateStatusStyles, candidateTableFields, candidateDefaultHiddenColumns, candidateFormSections, candidateScheduleSections, candidateFormValues, emptyCandidateValues, ALL_CANDIDATE_STATUSES } from "../src/constants/interviewConfig.js";

/*
 * Bulk Entry on the Interview screen: several candidates typed in one sitting.
 *
 * The CRM's Bulk Entry for candidates rather than leads, and the two things that decide whether it
 * is usable do not show up until somebody has typed twenty names: that a row nobody filled in is
 * dropped rather than posted, and that a batch carries no status - so the register files every row
 * into the first stage instead of claiming somebody has already spoken to them.
 */

const HERE = import.meta.dirname;
const interviewFile = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const DIALOG = interviewFile("components", "hrm", "InterviewBulkEntryDialog.js");
const PAGE = interviewFile("components", "hrm", "InterviewPage.js");
const ADD = interviewFile("components", "hrm", "InterviewAddApplicationDialog.js");
const RECORD = interviewFile("components", "hrm", "InterviewCandidatePopup.js");
/*
 * The record form's apparatus - its four custom controls, its eleven option lists and the payload
 * shaping that keeps an update from blanking columns the form does not draw - moved out of the panel
 * the popup replaced into a module of its own. The rules below still hold; they are just read from
 * where they now live rather than from the screen that draws them.
 */
const RECORD_FORM = interviewFile("components", "hrm", "candidateRecordForm.js");
const INVITES = interviewFile("components", "hrm", "InterviewApplicationInviteDialog.js");
const { applicationFormSections, applicationInitialValues, missingApplicationFields, requiredApplicationFields, totalExperienceFrom, EXPERIENCE_LEVELS, MAX_ATTACHMENTS, MAX_PORTFOLIO_LINKS, NOTICE_PERIODS } = await import("../src/constants/interviewApplicationConfig.js");

const row = (over = {}) => ({ ...emptyBulkEntryRow({ today: "2026-09-18" }), name: "Anu Priya", phone: "+91 9876500000", position: "Photographer", ...over });

test("a batch asks the few things that make a candidate findable, and requires three of them", () => {
  /*
   * A name and a number make a candidate findable and a position makes the row worth filing. The
   * rest are optional on purpose: a batch is very often typed before anybody has decided who is
   * screening them, and requiring an answer would mean inventing one.
   */
  assert.deepEqual(BULK_ENTRY_FIELDS.filter((field) => field.required).map((field) => field.key), ["name", "phone", "position"]);
  assert.deepEqual(missingBulkEntryFields({}), ["Candidate Name", "Phone", "Position"]);
  assert.deepEqual(missingBulkEntryFields(row()), []);
});

test("the trailing blank row is not a candidate, however many dates the form put in it", () => {
  /*
   * The dialog always keeps one empty row at the end to type into. Judged on what the person
   * answers rather than on what the form answered for them: without that, the blank row would count
   * as a candidate the moment it appeared - posted as a nameless row, and never removable, because
   * the dialog would keep adding another one behind it.
   */
  const blank = emptyBulkEntryRow({ today: "2026-09-18" });
  assert.equal(blank.nextFollowUpDate, "2026-09-18");
  assert.equal(isBlankBulkEntryRow(blank), true);
  assert.equal(isBlankBulkEntryRow(row()), false);
  assert.deepEqual(bulkEntryRecords([row(), blank], { today: "2026-09-18" }).map((record) => record.name), ["Anu Priya"]);
});

test("a batch states no status at all, so the register files every row into the first stage", () => {
  /*
   * Twenty names typed off a walk-in day are people nobody has spoken to yet. Leaving the status out
   * rather than sending the first stage by name is what keeps this from drifting: the server decides
   * which stage is first (`prepareValues`), and only one place should hold that answer.
   */
  const record = bulkEntryRecord(row(), { today: "2026-09-18" });
  assert.equal("status" in record, false);
  assert.equal(record.appliedDate, "2026-09-18");
  assert.equal(record.name, "Anu Priya");
  // And the first stage is what the screen shows such a candidate under.
  assert.equal(CANDIDATE_STATUSES[0], DEFAULT_CANDIDATE_STATUS);
});

test("nobody is assigned a batch, because there is nobody to assign it to", () => {
  /*
   * The studio has one HR. A picker with one name in it is a question with one answer, asked thirty
   * times, so Bulk Entry does not ask it and neither does Add Application. A linked sheet's rules
   * can still name an interviewer; nothing a person types here can.
   */
  assert.equal(BULK_ENTRY_FIELDS.some((field) => field.key === "interviewerEmployeeId"), false);
  assert.equal("interviewerEmployeeId" in bulkEntryRecord(row(), { today: "2026-09-18" }), false);
  /*
   * Asked as the thing a picker would actually be rather than as a bare substring - the word is in
   * the comment that explains why it is gone, and a test that reads prose as a control is a test
   * that fails on a comment.
   */
  for (const [name, file] of [["Bulk Entry", DIALOG], ["Add Application", ADD], ["the record form", RECORD_FORM]]) {
    assert.equal(file.includes("options.interviewers"), false, `${name} should not draw an interviewer picker`);
  }
  assert.equal(ADD.includes('label="Assign To"'), false, "Add Application should not draw an Assign To picker");
  assert.equal(ADD.includes("interviewerEmployeeId"), false, "Add Application should not post an interviewer");
  /*
   * The **record** still does not ask, and neither does anything that writes a candidate down as
   * they arrive. Schedule Interview is the one screen that does, and only because a Google Meet has
   * to have somebody in it: the invite goes to the interviewer's work address, so somebody named as
   * taking the round and not invited to it is the mistake that picker exists to prevent.
   */
  const recordAsks = candidateFormSections.flatMap((section) => section.fields).map((field) => field.name);
  assert.equal(recordAsks.includes("interviewerEmployeeId"), false, "the record should not ask for an interviewer");
  const schedulesAsk = candidateScheduleSections.flatMap((section) => section.fields).map((field) => field.name);
  assert.ok(schedulesAsk.includes("interviewerEmployeeId"), "Schedule Interview should ask who is taking the round");
});

test("a problem names the row it belongs to, and an empty batch says so", () => {
  // Named per row rather than counted: "2 answers missing" on a form of eight rows is a message
  // somebody has to go and search, and the rows are numbered on screen for exactly this.
  assert.equal(bulkEntryProblem([emptyBulkEntryRow({ today: "2026-09-18" })]), "Fill in at least one candidate before adding.");
  assert.equal(bulkEntryProblem([row(), row({ phone: "", position: "" })]), "Candidate 2: Phone, Position");
  assert.equal(bulkEntryProblem([row(), row()]), "");
});

test("the dialog keeps the CRM's own arrangement rather than inventing one", () => {
  // A reader who has used the CRM's Bulk Entry should not have to work out where they are here.
  assert.match(DIALOG, /size="wide"/);
  assert.match(DIALOG, /Candidate Details/);
  assert.match(DIALOG, /withTrailingBlank/);
  // The cap is said on screen when it is reached, because that is the one thing the form cannot
  // show by itself: no new blank row appears, which otherwise reads as the form having broken.
  assert.ok(DIALOG.includes("MAX_BULK_ENTRIES"));
  assert.equal(MAX_BULK_ENTRIES, 50);
  // The trailing blank carries no remove button - a control that does nothing when pressed.
  assert.match(DIALOG, /!isBlankBulkEntryRow\(row\)/);
});

test("the action bar is the primary button and one ⋮ holding the other three ways in", () => {
  /*
   * The Employee Repository's own arrangement: the primary keeps the position the eye goes to, and
   * the quiet trigger sits at the right-hand end where every other header in the application puts
   * it - rather than four buttons wide.
   */
  // `[\s\S]*?` rather than `[^>]*`: the button carries an arrow function, and `=>` holds a `>`.
  assert.match(PAGE, /variant="primary"[\s\S]*?>Add Application</);
  for (const entry of ["Bulk Entry", "Import", "View All Invites"]) {
    assert.match(PAGE, new RegExp(`label: "${entry}"`), `${entry} is not in the header's ⋮`);
  }
  // Every one of them is behind the screen's own write, so nothing opens onto a refusal - a reader
  // gets the Table / Board switch alone.
  assert.match(PAGE, /actions=\{!canWrite \? <TableBoardSwitch value=\{layout\} onChange=\{changeLayout\} \/> :/);
});

test("Add Application is a dialog on Add Lead's own shape, not a full-screen form", () => {
  /*
   * It was a four-section `SchemaFormPanel`. A reader who adds leads should not have to work out
   * where they are here, so it is the CRM's own card: the dimmed page, the grey card, the white
   * heading bar, the panel on it, and Cancel / Confirm at the foot.
   */
  assert.equal(ADD.includes("SchemaFormPanel"), false, "Add Application should be a dialog rather than the full-screen form panel");
  assert.match(ADD, /fixed inset-0 z-\[100\][\s\S]*?bg-slate-950\/40/);
  assert.match(ADD, /rounded-\[2rem\] bg-\[#f3f3f3\]/);
  /*
   * **One panel**, and the card keeps the width it had.
   *
   * There were two, and the second existed to hold the status pills. With the stage no longer asked
   * for, Follow-up Details was a heading over a date and a note - and two headings said the dialog
   * asked two kinds of question when it asks one: this is an application being written down, and the
   * day to chase them is part of writing it down.
   */
  /*
   * Asked as the heading a panel would actually draw rather than as a bare substring - the words are
   * in the comment that explains why the second panel is gone, and a test that reads prose as markup
   * is a test that fails on a comment.
   */
  const headings = [...ADD.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1].trim());
  assert.deepEqual(headings, ["Application Details"], "there should be one panel heading on the card");
  assert.equal(ADD.split("</section>").length - 1, 1, "there should be one panel on the card");
  assert.equal(ADD.includes("lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"), false, "the panel should not be a column beside another");
  assert.match(ADD, /max-w-\[1180px\]/);
  assert.match(ADD, /"Confirm"/);
  // Closing asks before discarding, but only once something has been typed - warning on the status
  // and the date the dialog filled in would prompt somebody who just changed their mind.
  assert.match(ADD, /hasEntries/);
  assert.match(ADD, /AUTO_FILLED = new Set\(\["status", "nextFollowUpDate"\]\)/);
});

test("Add Application asks the eight it needs and none of what the record holds", () => {
  /*
   * The whole of the complaint this answers: an application arrives as a name, a number and the job
   * they are after, and everything else is either not known yet or is the candidate's own to type.
   */
  for (const label of ["Candidate Name", "Contact", "Position Applied For", "Email", "Experience", "Source", "Next Follow-up Date", "Remarks"]) {
    assert.ok(ADD.includes(`"${label}"`) || ADD.includes(`label="${label}"`) || ADD.includes(`>${label}<`), `Add Application should ask for ${label}`);
  }
  /*
   * **Two** are required, and Position Applied For is not one of them.
   *
   * A name and a number are what make a candidate findable and reachable, and nothing can be done
   * about somebody the register cannot ring. The job they are after is genuinely often not known at
   * the moment the application is written down - a walk-in, a number passed on by a friend of the
   * studio, a CV in the inbox with no covering note - and refusing the row for it meant either a
   * guess typed into the field or the candidate not being written down at all. The candidate's own
   * screening form still asks them, which is where the real answer comes from.
   */
  assert.match(ADD, /const REQUIRED = \[\["name", "Candidate Name"\], \["phone", "Contact"\]\];/);
  assert.equal(/"position", "Position Applied For"\]\]/.test(ADD), false, "the position is no longer refused for being blank");

  /*
   * Everything here belongs to the record rather than to the moment an application arrives. Each is
   * still editable - the panel a row opens holds all of them - and each must stay off this dialog,
   * which is the thing that will drift if nobody is watching.
   */
  const RECORD_ONLY = [
    "employmentType", "gender", "dateOfBirth", "address", "currentCompany", "currentDesignation",
    "currentCtc", "expectedCtc", "noticePeriod", "availableFrom", "highestQualification", "skills",
    "languagesKnown", "portfolioUrl", "resumeUrl", "interviewDate", "interviewTime", "interviewMode",
    "meetLink", "department", "branch", "city", "state", "referredBy", "lastFollowUpDate",
  ];
  /*
   * Asked as the field the form would actually hold rather than as a bare substring: "address" is
   * inside "email address", and a test that reads prose as a field is a test that fails on a
   * comment. A field on this dialog is read and written exactly these two ways.
   */
  for (const field of RECORD_ONLY) {
    assert.equal(ADD.includes(`update("${field}"`), false, `${field} belongs to the record, not to Add Application`);
    assert.equal(ADD.includes(`form.${field}`), false, `${field} belongs to the record, not to Add Application`);
  }
  // And each of them is still editable, on the panel that draws every column from the shared list.
  assert.match(RECORD, /candidateFormSections/);
});

test("the record panel is the other half of the split: editing only, and everything on it", () => {
  // Adding is the dialog, so nothing here creates a candidate - which is what stops the two forms
  // becoming two ways to do one thing that then disagree about what an application asks.
  assert.equal(RECORD.includes("createCandidate"), false, "the record panel should not create candidates");
  assert.match(RECORD, /updateCandidate/);
  // Opened by the row menu and a double-click, so it cannot rely on the control that opened it.
  assert.match(RECORD, /canWrite = true/);
  assert.match(PAGE, /setEditCandidate\(candidate\)/);
  assert.match(PAGE, /setAddOpen\(true\)/);
});

test("the tab row follows one candidate from arriving to an answer, with the two stops last", () => {
  /*
   * Pinned in order, because the order is the meaning: the five tabs before On Hold and Rejected
   * are the ones somebody works every morning, and a stop sorted into the middle of them is a tab
   * that collects rows nobody looks at again.
   */
  assert.deepEqual(CANDIDATE_STATUSES, [
    "Yet to Connect",
    /*
     * **Follow Up** sits straight after the stage it answers. A candidate nobody has spoken to gets
     * one of two things done to them - the screening form, or a call - and only the first of those
     * was a stage; the second was a remark, or nothing. So the register could not tell "nobody has
     * tried this person" from "we have called three times and they have not answered", which are the
     * two rows that need completely different work.
     */
    "Follow Up",
    "Form Submission Pending",
    "Form Submitted",
    "Interview Scheduled",
    "Selected",
    // An offer made and an offer taken are different answers, and the gap between them is where a
    // register that stopped at Selected could say nothing at all.
    "Onboarded",
    "On Hold",
    "Rejected",
  ]);
  assert.equal(CANDIDATE_STATUSES.indexOf(ONBOARDED_STATUS), CANDIDATE_STATUSES.indexOf("Selected") + 1);
  assert.equal(CANDIDATE_STATUSES.at(-1), "Rejected", "Rejected belongs after every stage a candidate can move on from");
  // Shortlisted, Interviewed and Joined are the three that are not tabs. Interviewed in particular,
  // which was asked for by name: the interview date already records that a meeting happened.
  for (const gone of ["Interviewed", "Shortlisted", "Joined"]) {
    assert.equal(CANDIDATE_STATUSES.includes(gone), false, `${gone} should not be a tab`);
  }
});

test("an arriving application is filed at Yet to Connect, and the dialog does not ask", () => {
  /*
   * It offered five stages, and four of them cannot be true of an application being written down as
   * it arrives: Form Submission Pending means a form has gone out, Form Submitted means it has come
   * back, and Selected and On Hold are decisions about somebody nobody has met. A row filed under
   * one of those by a mis-click on the pills reads afterwards as a step somebody took, and sits in a
   * tab being worked for something that never happened.
   *
   * An arriving application **is** at Yet to Connect - nobody has spoken to them, which is the whole
   * definition of that stage - so there is nothing to choose between.
   */
  assert.equal(ADD.includes("InterviewStatusPills"), false, "Add Application should not offer a stage");
  assert.equal(ADD.includes("statusOptions"), false, "there should be no list of stages to draw");
  // Still **sent**, rather than left to whatever the server defaults to: the register is filled by
  // five different writers, and a form that posts no stage is a form whose rows depend on them.
  assert.match(ADD, /status: DEFAULT_CANDIDATE_STATUS,/);
  assert.equal(CANDIDATE_STATUSES[0], DEFAULT_CANDIDATE_STATUS);
  // And closing still does not warn about it: the dialog filled it in, so it is not something typed.
  assert.match(ADD, /AUTO_FILLED = new Set\(\["status", "nextFollowUpDate"\]\)/);
  // Every stage keeps its colour, because the register still draws all of them.
  for (const status of CANDIDATE_STATUSES) {
    assert.ok(candidateStatusStyles[status], `${status} should have a colour of its own`);
  }
});

test("no screen asks for a stage that an act already sets", () => {
  /*
   * There is no Status picker on Schedule Interview any more, and that is the change: the stage of a
   * candidate with a round in the diary **is** "Interview Scheduled", so asking somebody to say so
   * after they have booked it asks them to restate what they have just done - and every time it was
   * missed, the stage disagreed with the register's own interview date.
   *
   * Every stage now has the act that sets it. The form flow moves a candidate to Form Submission
   * Pending and Form Submitted; scheduling moves them to Interview Scheduled; the onboarding invite
   * moves them to Onboarded; and the three that are **decisions** rather than consequences -
   * Selected, On Hold, Rejected - are taken in `InterviewDecisionDialog`, which asks the question
   * this dialog cannot: why.
   */
  const asked = candidateScheduleSections.flatMap((section) => section.fields).map((field) => field.name);
  assert.equal(asked.includes("status"), false, "Schedule Interview should not ask for a stage it sets itself");
  const DECISION = interviewFile("components", "hrm", "InterviewDecisionDialog.js");
  for (const status of ["SELECTED_STATUS", "ON_HOLD_STATUS", "REJECTED_STATUS"]) {
    assert.ok(DECISION.includes(status), `${status} should still be a decision somebody can take`);
  }
  // Nor does Add Application, for the same reason read from the other end: an arriving application
  // *is* at Yet to Connect, so there is nothing to choose between. The list it used to filter is
  // gone with the pills rather than left behind as an export nothing reads.
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.equal(CONFIG.includes("export const addApplicationStatuses"), false);
});

test("a double-click opens the candidate popup, and closing it asks once there is something to lose", () => {
  /*
   * **This reverses a rule, deliberately, and the reason the old one existed still stands.**
   *
   * A double-click used to open a read-only panel, because a double-click is easy to trigger by
   * accident - a slow second click on a row somebody meant to select - and that is a poor gesture for
   * putting a live form on screen. The studio asked for the CRM's own arrangement instead: one popup
   * where a candidate is read, corrected, noted and moved, reached by the double-click and by the ⋮.
   *
   * So the hazard is answered by a different means rather than ignored. An accidental open closes on
   * one press; one with typing in it asks first, through the same `useUnsavedGuard` Add Lead uses. The
   * comparison is against the record as it arrived, so a field typed into and back out of is not an
   * unsaved change and does not nag.
   */
  assert.match(PAGE, /onRowDoubleClick=\{openCandidatePopup\}/);
  const POPUP = interviewFile("components", "hrm", "InterviewCandidatePopup.js");
  assert.match(POPUP, /useUnsavedGuard\(dirty, \{/);
  /*
   * Against the record as last **written** rather than as handed in, because the popup now stays open
   * across a save - scheduling and sending the screening form both save and leave it up. Compared
   * against the prop, everything already written still counted as unsaved and Discard asked about
   * changes that were safely on the server.
   */
  assert.match(POPUP, /JSON\.stringify\(values\) !== JSON\.stringify\(candidateFormValues\(record\)\)/);
  // Every way out goes through it - the backdrop, the header's close, and the footer's Discard.
  assert.equal(POPUP.split("requestClose").length - 1 >= 4, true, "every way out must be guarded");
  assert.match(PAGE, /<RecordViewPanel/);
  assert.match(PAGE, /sections=\{candidateInfoSections\}/);
  // View in the menu opens that same record, exactly as the repository's View does, and is enabled.
  assert.match(PAGE, /\{ label: "View", onSelect: \(\) => setViewCandidate\(candidate\) \}/);
  assert.equal(/label: "View", disabled: true/.test(PAGE), false, "View should be enabled");
  // A single click still opens the info panel beside the table, which is the quick read.
  assert.match(PAGE, /onRowClick=\{openInfoPanel\}/);
  // And a deleted candidate does not stay on screen in full.
  assert.match(PAGE, /setViewCandidate\(\(current\) => current\?\.id === pendingDelete\.id \? null : current\);/);
});

test("the row menu's entries are named plainly, with no trailing ellipsis", () => {
  // Every one of them opens something, so an ellipsis on three of four said nothing the fourth did
  // not, and read as a difference between them where there is none.
  //
  // "Edit" is `reviewing ? "Review" : "Edit"` - the same entry, asking the question the row is
  // actually asking - so it is checked as the words rather than as a whole literal.
  assert.match(PAGE, /reviewing \? "Review" : "Edit"/);
  for (const label of ["Copy Link", "Delete"]) {
    assert.match(PAGE, new RegExp(`label: "${label}"`), `${label} should be the label`);
    assert.equal(PAGE.includes(`label: "${label}..."`), false, `${label} should carry no ellipsis`);
  }
});

test("the form a candidate is sent is called the Screening Form throughout", () => {
  /*
   * Sending one is a row menu entry no more - see `interview-review.test.mjs` for the popup's own
   * footer button that went with it - but the choice between **Send Screening Form** and **Resend**
   * still reads on `formSubmitted` in `STATUS_ACTS`, which the **Form Submission Pending** pill now
   * fires directly. The names are still the module's own - what changed is which control holds them.
   */
  assert.match(RECORD, /\[FORM_PENDING_STATUS\]: \{ handler: \(props\) => \(props\.formSubmitted \? props\.onResendApplicationForm : props\.onSendApplicationForm\) \}/);
  for (const file of [PAGE, RECORD, ADD]) assert.equal(/Send Application Form/.test(file), false);
});

test("Remarks carries no placeholder", () => {
  // The heading says what the box is for; a sentence of example text inside an empty box is one
  // more thing to read past.
  assert.match(ADD, /<h4 className="text-sm font-semibold text-slate-600">Remarks(?:<HelpTip text="[^"]*" \/>)?<\/h4>[\s\S]{0,400}?<TextAreaField[\s\S]{0,300}?\/>/);
  const remarks = ADD.slice(ADD.indexOf(">Remarks<"));
  const area = remarks.slice(remarks.indexOf("<TextAreaField"));
  const control = area.slice(0, area.indexOf("/>"));
  assert.equal(control.includes("placeholder"), false, "the Remarks box should have no placeholder");
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /name: "remarks", label: "Remarks", type: "textarea", props: \{ rows: 6 \}/);
});

test("where an application came from is the studio's list, not an array in the code", () => {
  /*
   * It was the same eleven values written out in `hrm/interview/candidates.js` and again in
   * `constants/interviewConfig.js`, which is two faults rather than one: a studio that started
   * advertising somewhere new - on Meta, say - could not say so, and the two copies could disagree
   * about what the picker offered. It is `interview_source` now, maintained in Settings → Fields →
   * Interview → Sources and seeded by `prisma/seeds/interview-sources.seed.js`.
   *
   * The fallback matters as much as the list: a hardcoded array behind `options.sources` would be
   * the hardcoding back, one read failure away from being what the studio is offered. Source is an
   * optional combobox on all three screens, so an empty list degrades to a box somebody types into.
   */
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.equal(CONFIG.includes("CANDIDATE_SOURCES"), false, "the source list should not be an array in the config");
  for (const [name, file] of [["Add Application", ADD], ["Bulk Entry", DIALOG], ["the record form", RECORD_FORM]]) {
    assert.equal(file.includes("CANDIDATE_SOURCES"), false, `${name} should not fall back to a hardcoded source list`);
    assert.match(file, /options\.sources \|\| \[\]/, `${name} should read the studio's own source list`);
  }
  // And the list is offered for editing under the Interview screen, or the studio maintains nothing.
  const LISTS = interviewFile("constants", "moduleFieldLists.js");
  assert.match(LISTS, /value: "interview-sources"[\s\S]*?screens: \["interview"\]/);
});

test("a stage the list does not name still shows the candidate, under All", () => {
  /*
   * A recruiter's spreadsheet has its own vocabulary, and the importer keeps a word it does not
   * recognise rather than filing the candidate somewhere the studio did not choose. Such a
   * candidate must still be reachable, and All is where they are.
   */
  const rows = [{ status: "Yet to Connect" }, { status: "Shortlisted" }, { status: "Interviewed" }];
  assert.equal(candidatesForStatus(rows, ALL_CANDIDATE_STATUSES).length, 3);
  assert.equal(candidatesForStatus(rows, "Yet to Connect").length, 1);
  const counts = candidateStatusCounts(rows);
  assert.equal(counts[ALL_CANDIDATE_STATUSES], 3);
  assert.equal(counts["Yet to Connect"], 1);
  // Counted under its own word too, which is what makes such a row findable by filtering the column.
  assert.equal(counts.Shortlisted, 1);
});

test("the table opens on the studio's own hiring sheet, in the sheet's order", () => {
  /*
   * The register replaces a Meta lead export read in a spreadsheet, so it opens showing what that
   * sheet shows, left to right in the sheet's own order: the day it came in, which ad brought it,
   * what the candidate answered, then who they are. Somebody moving off the spreadsheet is not
   * relearning their own register.
   *
   * `Sl. No.` is not in this list and should not be - no table carries a row number.
   */
  const hidden = new Set(candidateDefaultHiddenColumns);
  const visible = candidateTableFields.filter(([key]) => !hidden.has(key));
  assert.deepEqual(visible.slice(0, 16).map(([, header]) => header), [
    "Date",
    "Campaign Name",
    "Adset Name",
    "Ad Name",
    "Years of Experience",
    "Current Salary",
    // The floor beside the ask: they are read together or the pair says nothing.
    "Least Expected Salary",
    "Expected Salary",
    "Languages Known",
    "When Can You Join",
    "Name",
    "Phone Number",
    "Gender",
    "City",
    "Resume",
    "Portfolio Link",
  ]);
  // The two follow-up dates read together or not at all, so they open side by side.
  const followUps = visible.map(([key]) => key);
  assert.equal(followUps.indexOf("nextFollowUpDate") - followUps.indexOf("lastFollowUpDate"), 1);
  assert.equal(candidateTableFields.some(([key]) => key === "serial"), false, "no table carries a Sl. No.");
  // Applied On is gone as a header: it is the Date column, one column and the studio's word for it.
  assert.equal(candidateTableFields.some(([, header]) => header === "Applied On"), false);
  assert.equal(candidateTableFields.some(([, header]) => header === "Interview Date"), false, "renamed to Interview Scheduled On");
  assert.ok(candidateTableFields.some(([key, header]) => key === "interviewDate" && header === "Interview Scheduled On"));
  // Nothing is listed twice, and nothing is hidden that the table does not have.
  const keys = candidateTableFields.map(([key]) => key);
  assert.deepEqual(keys.filter((key, index) => keys.indexOf(key) !== index), []);
  assert.deepEqual(candidateDefaultHiddenColumns.filter((key) => !keys.includes(key)), []);
});

test("the résumé column offers the file rather than printing the URL that reaches it", () => {
  // A résumé is a PDF as often as an image, so the cell is a link and not a thumbnail. The candidate
  // uploads it on the screening form, which is the only thing that fills this column in.
  // "Resume", plainly: the accented spelling was the one thing on this register nobody could type.
  for (const [key, label] of [["resumeUrl", "Resume"], ["portfolioUrl", "Portfolio Link"]]) {
    assert.deepEqual(candidateTableFields.find(([field]) => field === key).slice(0, 3), [key, label, "link"]);
    assert.equal(candidateDefaultHiddenColumns.includes(key), false, `${label} should open with the table`);
  }
  const CELLS = fs.readFileSync(path.join(HERE, "..", "src", "components", "data-table", "tableCells.js"), "utf8");
  assert.match(CELLS, /if \(type === "link"\)/);
  // A new tab, and never as a referrer-carrying opener: the target is a storage bucket.
  assert.match(CELLS, /rel="noopener noreferrer"/);
  // The row's own click must not fire as well, or opening a résumé also opens the info panel.
  assert.match(CELLS, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("the three ad columns are asked for everywhere a candidate can arrive from a sheet", () => {
  // A column the table shows but the importer cannot map, or the record cannot correct, is a column
  // that stays empty. All three paths are pinned here so none is added without the others.
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  const IMPORTS = interviewFile("constants", "importColumns.js");
  for (const [key, label] of [["campaignName", "Campaign Name"], ["adsetName", "Adset Name"], ["adName", "Ad Name"]]) {
    assert.ok(candidateTableFields.some(([field, header]) => field === key && header === label), `${label} should be a column`);
    assert.match(CONFIG, new RegExp(`\\{ name: "${key}", label: "${label}", type: "text"(, helperText: "[^"]*")? \\}`), `${label} should be on the record`);
    assert.match(IMPORTS, new RegExp(`column\\("${key}", "${label}"\\)`), `${label} should be a CSV column`);
    assert.match(CONFIG, new RegExp(`\\["${key}", "${label}"\\]`), `${label} should be on the info panel`);
  }
});

/** The row menu's two branches, sliced out of the page so each can be read on its own. */
/*
 * The row menu's three branches, sliced out of the page so each can be read on its own: a Selected
 * candidate, one waiting on their screening form, and everybody else.
 */
const ONBOARDED_START = "...(onboardedStage ? [";
const SELECTED_START = "] : selectedStage ? [";
const WAITING_START = "] : waiting ? [";
const onboardedBranch = () => PAGE.slice(PAGE.indexOf(ONBOARDED_START), PAGE.indexOf(SELECTED_START));
const PLAIN_START = "// Every other stage: the plain menu";
const selectedBranch = () => PAGE.slice(PAGE.indexOf(SELECTED_START), PAGE.indexOf(WAITING_START));
const waitingBranch = () => PAGE.slice(PAGE.indexOf(WAITING_START), PAGE.indexOf(PLAIN_START));
const plainBranch = () => PAGE.slice(PAGE.indexOf(PLAIN_START), PAGE.lastIndexOf('label: "Delete", tone: "danger"'));

test("a candidate waiting on their form has a menu of the things there are to do about waiting", () => {
  /*
   * At Form Submission Pending the row is one thing: somebody the studio is waiting on. So the
   * entries are the things there are to do about waiting - read them, hand them the link again,
   * correct what the form was raised on, turn them down, or call the form off. Edit and Delete are
   * not among them, because neither is what this row is for.
   */
  assert.match(PAGE, /const waiting = candidate\.status === FORM_PENDING_STATUS;/);
  const waiting = waitingBranch();
  for (const label of ["Copy Link", "Edit Invite", "Cancel Form"]) {
    assert.ok(waiting.includes(`label: "${label}"`), `${label} should be offered while waiting`);
  }
  // Reject reaches this branch as the shared entry; the test below pins it into both.
  assert.ok(waiting.includes("...(rejectable ? [rejectItem] : [])"), "Reject should be offered while waiting");
  assert.equal(waiting.includes('label: "Delete"'), false, "Delete is not what a waiting row is for");
  assert.equal(waiting.includes('label: "Edit",'), false, "the record's own Edit is not on a waiting row");
  // View is first and **enabled**, opening the record read-only - see the double-click test.
  assert.match(PAGE, /\{ label: "View", onSelect: \(\) => setViewCandidate\(candidate\) \}/);
  assert.equal(/label: "View", disabled: true/.test(PAGE), false, "View should be enabled");
});

test("Reject is offered at every stage but Rejected itself", () => {
  /*
   * A candidate is turned down after the form is read, after the interview, off On Hold weeks later,
   * after being offered the job, or after the onboarding invite has gone - not only while a form is
   * out. So the entry is built once and spread into **all four** branches of the menu, which is
   * what keeps it on every tab.
   *
   * The exception is a row already Rejected, where the entry would move the stage to where it
   * already is and offer an Undo back to itself.
   */
  assert.match(PAGE, /const rejectable = candidate\.status !== REJECTED_STATUS;/);
  assert.match(PAGE, /const rejectItem = \{/);
  assert.ok(waitingBranch().includes("...(rejectable ? [rejectItem] : [])"), "Reject belongs on a waiting row");
  assert.ok(plainBranch().includes("...(rejectable ? [rejectItem] : [])"), "Reject belongs on every other row");
  // Exactly the two branches - a third spread would be a menu nobody has argued for.
  assert.equal(PAGE.split("...(rejectable ? [rejectItem] : [])").length - 1, 4);
});

test("Put On Hold sits beside Reject, at every stage but On Hold itself", () => {
  /*
   * On Hold and Rejected are the two places a candidate stops, and only one of them could be
   * reached from a row: somebody the studio wanted to keep but could not place yet had to be
   * opened, edited and saved to say so, while turning the same person down was one press. That made
   * the easier answer the harsher one, which is the wrong way round in a register worked through
   * every morning.
   *
   * So the entry is built once and spread into **both** branches, exactly as Reject is - which is
   * what keeps it on every tab - and it reads **first** of the pair, the gentler answer before the
   * harsher one.
   */
  assert.match(PAGE, /const holdable = candidate\.status !== ON_HOLD_STATUS;/);
  assert.match(PAGE, /const holdItem = \{/);
  assert.match(PAGE, /label: "Put On Hold",/);
  for (const [name, branch] of [["a waiting row", waitingBranch()], ["every other row", plainBranch()]]) {
    assert.ok(branch.includes("...(holdable ? [holdItem] : [])"), `Put On Hold belongs on ${name}`);
    // Above Reject in both, so the pair reads the same way round wherever it is met.
    assert.ok(
      branch.indexOf("...(holdable ? [holdItem] : [])") < branch.indexOf("...(rejectable ? [rejectItem] : [])"),
      `Put On Hold should read before Reject on ${name}`,
    );
  }
  // Exactly the two branches - a third spread would be a menu nobody has argued for.
  assert.equal(PAGE.split("...(holdable ? [holdItem] : [])").length - 1, 2);
  /*
   * And it is asked the same way Reject is - whatever that way currently is.
   *
   * It began as an immediate move with an Undo; it is now one of the three **decisions**, each
   * opening a dialog that asks for the reason and appends it to the candidate's record, because a
   * stage changed by a single click recorded nothing about why. The pairing is the thing worth
   * pinning rather than the mechanism: Put On Hold and Reject are the two stopping stages and they
   * must always be asked alike, so that whichever one a rename or a rework moves, it moves both.
   */
  const asks = (label) => new RegExp(`label: "${label}", onSelect: \\(\\) => ([^\\n]+?)\\(`).exec(PAGE)?.[1];
  assert.ok(asks("Put On Hold"), "Put On Hold no longer names how it is asked");
  assert.equal(asks("Put On Hold"), asks("Reject"), "the two stopping stages are asked in different ways");
  // Both name the stage they move to, so neither can be wired to the other's.
  assert.match(PAGE, /label: "Put On Hold",[^\n]*ON_HOLD_STATUS/);
  assert.match(PAGE, /label: "Reject",[^\n]*REJECTED_STATUS/);
  // A rejected candidate is deliberately still offered it - reconsidering somebody is a thing the
  // studio does, and the only row it is withheld from is one already On Hold.
  assert.equal(/holdable = [^\n]*REJECTED_STATUS/.test(PAGE), false, "a rejected candidate can still be put on hold");
});

test("Edit is offered at every stage, from one line of the menu", () => {
  /*
   * It used to be withheld at two stages: a row waiting on its screening form, and one at Yet to
   * Connect that "held nothing anybody had learned yet". Both readings were wrong about what Edit
   * is for. A number arrives mistyped from a sheet, a name comes through in capitals, a position is
   * filed against the wrong department - those are corrections to what *arrived*, and they are most
   * needed exactly where nobody has touched the record yet. Withholding it there made the one stage
   * with the most unchecked data the one stage that could not be put right.
   */
  assert.doesNotMatch(PAGE, /const untouched =/, "the Yet to Connect gate on Edit is back");
  assert.doesNotMatch(PAGE, /const editable =/, "Edit is gated by stage again");
  /*
   * **One** Edit for the whole menu, sitting beside View - the two things somebody does to the
   * candidate rather than to their hiring. It was written into three branches separately, which is
   * how it ended up second on one stage and fourth on another; the record's form is now opened from
   * exactly one line.
   */
  assert.equal(PAGE.split("setEditCandidate(candidate)").length - 1, 1);
  assert.match(PAGE, /\{ label: "View", onSelect: \(\) => setViewCandidate\(candidate\) \},\n[\s\S]{0,1400}?\n\s+editItem,/);
  // Withheld in the two cases it always has been, and no others.
  for (const branch of [selectedBranch(), onboardedBranch(), plainBranch(), waitingBranch()]) {
    assert.equal(branch.includes('label: "Edit",'), false, "Edit is hoisted, not repeated per stage");
  }
  // View is not gated with it - an untouched candidate is still read in full.
  assert.match(PAGE, /\{ label: "View", onSelect: \(\) => setViewCandidate\(candidate\) \},/);
});

test("the three decisions ask why, and Cancel Form still asks first", () => {
  /*
   * Selected, On Hold and Rejected were a single click that changed the stage and recorded nothing
   * about why - so weeks later nobody could say why a candidate was parked, and "we already spoke
   * to them and said no" was a thing the register could not tell you. Each now opens a dialog
   * asking for a remark.
   *
   * That replaces the **Undo** they used to carry, and deliberately: Undo stood in for deliberation
   * while there was no question to ask. There is one now, and a dialog somebody opened and typed a
   * reason into is already the deliberate act.
   */
  // Follow Up joined them, and is the one that is not a decision about the person: it says this is
  // worth another try, on this day - so it is the only one that asks for a date as well as a reason.
  assert.match(PAGE, /setDecision\(\{ candidate, status: FOLLOW_UP_STATUS \}\)/);
  assert.match(PAGE, /setDecision\(\{ candidate, status: SELECTED_STATUS \}\)/);
  assert.match(PAGE, /setDecision\(\{ candidate, status: ON_HOLD_STATUS \}\)/);
  assert.match(PAGE, /setDecision\(\{ candidate, status: REJECTED_STATUS \}\)/);
  assert.match(PAGE, /<InterviewDecisionDialog/);
  // The undo machinery is gone with the entries that used it, rather than left dead behind them.
  assert.equal(/const moveStatus = /.test(PAGE), false);
  assert.equal(/showUndo/.test(PAGE), false);

  // Cancel Form is still the red one behind a confirmation: a cancelled link cannot be revived,
  // because the token is stored hashed.
  assert.match(PAGE, /label: "Cancel Form", tone: "danger"/);
  assert.match(PAGE, /pendingCancelInvite && <ConfirmDialog/);
  assert.match(PAGE, /confirmLabel="Cancel Form"/);

  /*
   * The reason is **appended** to the candidate's decisions, not written over the last: somebody
   * held in March and rejected in May has two reasons and neither explains the other. It is also
   * apart from `remarks`, which stays HR's running note on the person.
   */
  const DECISION = interviewFile("components", "hrm", "InterviewDecisionDialog.js");
  assert.match(DECISION, /setCandidateStatus\(\s*\n\s*candidate\.id,\s*\n\s*status,\s*\n\s*note\.trim\(\) \|\| undefined,/);
  const SERVICE = interviewFile("services", "hrm", "interview.service.js");
  // A blank note is left out entirely rather than sent empty, so no empty entry is recorded.
  // A blank note is still left out entirely rather than sent empty, so no empty entry is recorded.
  assert.match(SERVICE, /\.\.\.\(note \? \{ note \} : \{\}\)/);
  const CONTROLLER = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "controller.js"), "utf8");
  assert.match(CONTROLLER, /values\.statusNotes = \[\.\.\.held, \{\s*\n\s*status,\s*\n\s*note,\s*\n\s*at: new Date\(\)\.toISOString\(\),/);
});

test("a stage is moved through the status route, not the full update", () => {
  /*
   * `PUT /candidates/:id` validates the whole record and is deliberately not partial, so a body
   * carrying only a stage is refused for a missing name and one carrying a name blanks every other
   * column. The row menu holds a table row rather than a form, so it moves the stage on its own.
   */
  const SERVICE = interviewFile("services", "hrm", "interview.service.js");
  assert.match(SERVICE, /export function setCandidateStatus/);
  assert.match(SERVICE, /candidates\/\$\{encodeURIComponent\(id\)\}\/status/);
  assert.match(SERVICE, /method: "PATCH"/);
  /*
   * Called from the decision dialog now rather than from the page: the three stages that route
   * through it are the only ones a person moves by hand, and it carries the reason with the stage.
   */
  const DECISION = interviewFile("components", "hrm", "InterviewDecisionDialog.js");
  assert.match(DECISION, /await setCandidateStatus\(\s*\n\s*candidate\.id,\s*\n\s*status,\s*\n\s*note\.trim\(\) \|\| undefined,/);
  /*
   * And the date is sent by **Follow Up alone**. `undefined` for the other three, so a rejection
   * cannot blank a follow-up date nobody meant to touch; `null` where Follow Up is saved with the
   * box cleared, which is a different answer and has to stay tellable from the first.
   */
  assert.match(DECISION, /decision\.asksDate \? \(nextFollowUpDate \|\| null\) : undefined,/);
});

test("a row at any other stage keeps the plain menu", () => {
  // Anchored on the hoisted Edit, which every stage now gets - it was `...(editable ? ...)` while
  // the stage decided whether a record could be corrected at all.
  const plainBranch = PAGE.slice(PAGE.indexOf("\n      editItem,"));
  assert.match(PAGE, /const editItem = \{ label: reviewing \? "Review" : "Edit", onSelect: \(\) => openCandidatePopup\(candidate\) \}/);
  assert.ok(plainBranch.includes('label: "Copy Link"'));
  assert.ok(plainBranch.includes('label: "Delete", tone: "danger"'));
  /*
   * And the menu stays one list of plain words: no rules between the entries and no second lines,
   * the way the Employee Repository's is. That is also the shape that cannot go wrong - OptionsMenu
   * draws a separator *instead of* the item carrying the flag, so `separator: true` on Copy Link
   * once drew a line where Copy Link should have been.
   */
  assert.equal(PAGE.includes("separator: true"), false, "the row menu draws no rules");
  assert.equal(/detail: /.test(PAGE), false, "no second line under an entry");
});

test("somebody who has answered is never asked again from the row", () => {
  /*
   * The wart this fixed: a submitted form is not *live*, so the row fell through to the state that
   * had never been asked and offered **Send Screening Form** - to the one candidate who had already
   * filled it in. Sending one at all is gone from the row now - it is the **Form Submission
   * Pending** pill's errand, in the popup Edit already opens - so there is no state left for a
   * submitted form to fall through to: `form?.live` is the only question the plain menu asks.
   */
  assert.match(PAGE, /submitted: invite\.status === "Submitted"/);
  assert.equal(PAGE.includes("form?.submitted"), false, "there is no submitted-specific fallback left to ask for");
});

test("only a form the candidate can still open counts as one that is out", () => {
  // Raised or opened, and not past its expiry; the latest form per candidate decides, because
  // somebody asked twice is answered by their most recent one.
  assert.match(PAGE, /invite\.status === "Created" \|\| invite\.status === "Verified"/);
  assert.match(PAGE, /new Date\(invite\.expiresAt\)\.getTime\(\) > invitesReadAt/);
  assert.match(PAGE, /new Date\(invite\.createdAt\) > new Date\(held\.createdAt\)/);
  /*
   * And the clock is read when the forms are fetched, not during a render: reading it while
   * rendering is impure, which the React Compiler refuses outright, and the statuses in hand are
   * that read's anyway.
   */
  assert.equal(/const now = Date\.now\(\);/.test(PAGE), false, "the clock must not be read during render");
  assert.match(PAGE, /setInvitesReadAt\(Date\.now\(\)\);/);
  // Every path that changes a form re-reads them, or a row keeps offering the wrong entry.
  assert.match(PAGE, /onInviteCreated=\{\(\) => \{ void load\(\); void loadInvites\(\); \}\}/);
  assert.match(PAGE, /onInviteChanged=\{\(\) => \{ void load\(\); void loadInvites\(\); \}\}/);
});

test("View All Invites lists the forms and can hand over a link without raising a second one", () => {
  // The repository's list screen: full size, its own header action to raise one, one row per
  // candidate with earlier attempts folded under it.
  assert.match(PAGE, /label: "View All Invites", onSelect: \(\) => setInviteDialog\(\{ mode: "list" \}\)/);
  assert.match(INVITES, /size=\{isList \? "full" : "md"\}/);
  assert.match(INVITES, /height=\{isList \? "tall" : "auto"\}/);
  /*
   * Copy Link on a live row, which the list could not do before: the only route to the link was to
   * raise a *second* form, whose success screen carries one. That is the wrong answer to "they
   * never got the email".
   */
  assert.match(INVITES, /const copyAction = \(invite\) => \(invite\.applicationUrl \?/);
  assert.match(INVITES, />Copy Link<\/button>/);
  const liveRow = INVITES.slice(INVITES.indexOf('if (invite.status === "Created" || invite.status === "Verified")'));
  assert.match(liveRow.slice(0, 400), /\{copyAction\(invite\)\}[\s\S]*?\{editAction\(invite\)\}/);
  // Through the shared helper, not `navigator.clipboard` directly: the async API is refused over
  // plain http, which is how a studio on the VPS reaches this screen.
  assert.match(INVITES, /copyToClipboard\(invite\?\.applicationUrl/);
  assert.equal(PAGE.includes("navigator.clipboard"), false, "the page should copy through the shared helper");
  // Correcting a form, cancelling one and sending it again all live here, which is why the row
  // menu does not carry them.
  assert.match(INVITES, />Edit<\/button>/);
  assert.match(INVITES, />Send Again<\/button>/);
  assert.match(INVITES, /Cancelling\.\.\." : "Cancel"/);
});


test("the candidate's own form asks for a number with the phone control, not a text box", () => {
  /*
   * It was a plain box on this form and nowhere else in the application, which is how somebody
   * typing "9876 500 000 (whatsapp)" produced a number the register could not match them by. The
   * shared control gives a country picker, digits only, a numeric keypad and the national length
   * of the code chosen, and emits the `+91 9876543210` shape the register stores.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  for (const name of ["contactNumber", "whatsappNumber"]) {
    assert.equal(fields.find((field) => field.name === name)?.type, "phone", `${name} should use the phone control`);
  }
  // Which is the control the shared schema form draws for that type, and the one every other form
  // in the module already uses.
  const FIELDS = interviewFile("components", "schema-form", "SchemaFormFields.js");
  assert.match(FIELDS, /if \(type === "phone"\) return <PhoneField/);
  const PHONE = interviewFile("components", "shared", "PhoneField.js");
  assert.match(PHONE, /inputMode="numeric"/);
  assert.match(PHONE, /replace\(\/\\D\/g, ""\)/);
});

test("the candidate is not asked which department they would be in", () => {
  /*
   * It was asked as "where you would be working, if you know", which a candidate cannot answer
   * about a studio they have not joined - so it came back blank, guessed, or naming a team that
   * does not exist. Which department a hire lands in is the studio's answer, set on the record.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  assert.equal(fields.some((field) => field.name === "department"), false);
  assert.equal("department" in applicationInitialValues, false);
  // Still on the record, which is where it is answered.
  assert.match(interviewFile("constants", "interviewConfig.js"), /\{ name: "department", label: "Department", type: "combobox"/);
});

test("when they can join is a yes-or-no, and only a No is asked for a date", () => {
  /*
   * The bare date picker on The Role is gone: it made a candidate guess a day before anybody had
   * spoken to them, and the guess then sat on the register as a commitment. The question under it
   * is a yes or no - most people either can start now or cannot - and only the second group has a
   * date in mind at all.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  const role = applicationFormSections.find((section) => section.id === "position");
  assert.equal(role.fields.some((field) => field.name === "availableFrom"), false, "not asked on The Role");

  const joiner = fields.find((field) => field.name === "immediateJoiner");
  assert.equal(joiner?.type, "radio", "a toggle has no unanswered state, so it would open the date box unasked");
  assert.equal(joiner?.required, true);
  // Asked of everybody: a fresher between semesters has this answer as surely as somebody serving notice.
  assert.equal(joiner?.when, undefined);

  const date = fields.find((field) => field.name === "availableFrom");
  assert.equal(typeof date?.when, "function");
  assert.equal(date.when({ immediateJoiner: "No" }), true);
  assert.equal(date.when({ immediateJoiner: "Yes" }), false);
  assert.equal(date.when({}), false, "an unanswered question asks nothing further");
  // A joining date cannot be in the past.
  assert.equal(date.props?.restriction, "past");
  /*
   * Half a row, not the full width. Yes and No are two small controls, and a bar the width of the
   * form around them is mostly empty space that pushes everything after it down a row - so the next
   * field sits beside it instead: the joining date on a No, the salary floor on a Yes.
   */
  assert.equal(joiner?.colSpan, undefined, "the radio takes one column so fields flow to its right");
  assert.equal(date?.colSpan, undefined);
  /*
   * And it is drawn to the size of the boxes beside it. The shared radio is built for a group
   * standing on its own - a `text-sm` legend and a 44px control - which among a grid of text fields
   * read a size too large.
   */
  assert.match(joiner?.props?.className || "", /text-\[11px\] font-semibold/);
  assert.match(joiner?.props?.controlClassName || "", /!min-h-9/);

  /*
   * The grid stays tidy by **order**, not by holding cells open - a held-open cell is a hole in the
   * form. Fields flow into two columns in order, so a lone field leaves the next one in the other
   * column and knocks every pair below it out of step.
   *
   * Two rules, pinned here because the layout silently depends on both: Total Experience is drawn
   * for everybody so the question heading the section always has a partner, and the salary pair
   * sits above the joining question so the one remaining optional field falls beside the question
   * that summons it rather than between a pair.
   */
  const order = fields.map((field) => field.name);
  assert.equal(fields.find((field) => field.name === "totalExperience")?.when, undefined, "drawn for everybody, or the section below it falls out of step");
  assert.ok(order.indexOf("expectedCtc") < order.indexOf("immediateJoiner"), "the salary pair sits above the joining question");
  assert.equal(order.indexOf("availableFrom"), order.indexOf("immediateJoiner") + 1, "the date follows its question");
  assert.equal(order.indexOf("expectedCtc"), order.indexOf("minExpectedCtc") + 1, "the two salaries are adjacent");
  // No field holds a cell open any more: that traded a misaligned row for an empty one.
  assert.equal(fields.some((field) => field.reserve), false);


  /*
   * Neither is a new column. `availableFrom` is free text precisely because the answer is as often
   * a word as a day, so Yes is stored as "Immediate" and No stores the date.
   */
  const FORM = interviewFile("components", "interview", "PublicApplicationForm.js");
  assert.match(FORM, /if \(immediateJoiner === JOINS_IMMEDIATELY\) values\.availableFrom = IMMEDIATE_JOIN;/);
  // Unanswered sends nothing rather than blanking what HR or a sheet put there.
  assert.match(FORM, /else if \(immediateJoiner !== JOINS_LATER\) values\.availableFrom = "";/);
  // And the answer is read back off that same column when the link is opened again.
  assert.match(FORM, /immediateJoiner: \/immediate\/i\.test/);
  /*
   * The prefill still may not carry a key the form has stopped asking about: the register's row
   * holds columns this form no longer has, and spread whole they were posted straight back.
   */
  assert.match(FORM, /\.filter\(\(\[key\]\) => key in applicationInitialValues\)/);
});

test("the candidate is asked what they would least accept, and for up to three links", () => {
  const fields = applicationFormSections.flatMap((section) => section.fields);
  /*
   * Two salary answers, and not the same question: Expected Salary is the opening ask, Least
   * Expected Salary is the floor that decides whether a conversation is worth having at all. Both
   * are asked of everybody, freshers included - a fresher has no *current* salary but has both.
   */
  const floor = fields.find((field) => field.name === "minExpectedCtc");
  assert.equal(floor?.label, "Least Expected Salary");
  assert.equal(floor?.when, undefined, "a fresher has a floor too");
  const names = fields.map((field) => field.name);
  assert.ok(names.indexOf("minExpectedCtc") < names.indexOf("expectedCtc"), "the floor is asked first, because it is what gets read");

  /*
   * One box to begin with, a plus to add the next, up to three - a photographer applies with a
   * portfolio, an Instagram and a Drive folder, and a single box sent the other two to Remarks.
   */
  assert.equal(names.includes("portfolioUrl"), false, "the single box is replaced by the list");
  const links = fields.find((field) => field.name === "portfolioLinks");
  assert.equal(links?.type, "custom");
  assert.equal(links?.label, "Portfolio / Links");
  assert.equal(MAX_PORTFOLIO_LINKS, 3);
  // The list starts as one empty box rather than none, so there is something to type into.
  assert.deepEqual(applicationInitialValues.portfolioLinks, [""]);

  const FORM = interviewFile("components", "interview", "PublicApplicationForm.js");
  // Drawn by the shared list control, capped at the same number the server holds.
  assert.match(FORM, /<RepeatableTextList/);
  assert.match(FORM, /max=\{MAX_PORTFOLIO_LINKS\}/);
  // The empty boxes are dropped at submit rather than as they are typed.
  assert.match(FORM, /\.filter\(Boolean\)\n\s*\.slice\(0, MAX_PORTFOLIO_LINKS\);/);

  // One box with no furniture round it: the details field's card is right for a qualification and
  // far too much for a URL, so this is its own control rather than that one bent to fit.
  const LIST = fs.readFileSync(path.join(HERE, "..", "src", "components", "shared", "RepeatableTextList.js"), "utf8");
  assert.match(LIST, /const rows = stored\.length \? stored : \[""\];/);
  assert.match(LIST, /const canAdd = !disabled && rows\.length < max;/);
  // No disabled plus on the last row: a control that exists only to refuse is not drawn.
  assert.match(LIST, /canAdd && index === rows\.length - 1/);
});

test("a candidate can attach more than the résumé, and the files go to R2 as they are", () => {
  /*
   * One file was the whole of the form's appetite, so a certificate, an experience letter or a
   * scanned portfolio went into the portfolio link as a Drive folder or was emailed separately and
   * lost from the record. The résumé keeps its own field - it is the one file every candidate has,
   * and the register shows it as its own column - and these are the rest.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  const names = fields.map((field) => field.name);
  const attachments = fields.find((field) => field.name === "attachments");
  assert.equal(attachments?.type, "file");
  assert.equal(attachments?.label, "Other Attachments");
  assert.equal(attachments?.props?.maxFiles, MAX_ATTACHMENTS);
  // Beside the résumé, not somewhere else in the form.
  assert.equal(names.indexOf("attachments"), names.indexOf("resume") + 1);
  // The same accepted types: an attachment is the same kind of thing as a résumé.
  assert.equal(attachments?.props?.accept, fields.find((field) => field.name === "resume")?.props?.accept);
  assert.deepEqual(applicationInitialValues.attachments, []);

  /*
   * Stored the way the résumé is: uploaded to R2 by the shared helper, before the transaction opens
   * so a slow upload never holds one, and kept as `{ name, url }`. **Not** compressed - the 5 MB
   * per-file cap is the guard, because re-encoding a PDF or a scanned certificate damages the one
   * thing it is being read for; browser-side resampling is what the image fields do.
   */
  const INVITES = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "invites.js"), "utf8");
  assert.match(INVITES, /storeDocuments\(data\.attachments\.slice\(0, MAX_ATTACHMENTS\), \{ folder: ATTACHMENT_FOLDER, trustUrls: false \}\)/);
  assert.match(INVITES, /attachments: z\.array\(documentSchema\)\.max\(MAX_ATTACHMENTS\)/);
  // Only written when something was attached, so a re-submission adding none keeps what is there.
  assert.match(INVITES, /\.\.\.\(attachments\?\.length \? \{ attachments \} : \{\}\),/);
  // And read back as rows rather than as the stored string.
  const SERVICE = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "service.js"), "utf8");
  assert.match(SERVICE, /attachments: parseJson\(candidate\.attachments, \[\]\)/);
  /*
   * And **written**, not only read. The column was the one this module read back without ever
   * writing: every attachment was uploaded to R2, handed to `prepareValues`, and dropped, so a
   * submission's files existed in the bucket and on no record.
   */
  assert.match(SERVICE, /if \(has\("attachments"\)\) data\.attachments = listJson\(values\.attachments\);/);
  /*
   * Uploaded as a file, never taken as a link. `storeDocument` returns any `http(s)` url untouched,
   * which is right for an authenticated edit echoing back its own files and wrong on a public form,
   * where it would let whoever holds the link choose what the studio's Résumé link points at.
   */
  assert.match(INVITES, /trustUrls: false/);
  const STORAGE = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "services", "documentStorage.js"), "utf8");
  assert.match(STORAGE, /if \(options\.trustUrls === false\) return null;/);
  // The declared type is an allowlist, and the stored extension comes from it rather than from the
  // candidate's own file name - so the public bucket cannot be told a file is HTML or SVG.
  assert.match(STORAGE, /const allowedExtension = extensionsByMimeType\[mimeType\];/);
  assert.match(STORAGE, /extension: allowedExtension/);

  // HR reads them on the record, by the name the candidate's own file carried.
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /\["attachments", "Other Attachments", "attachments"\]/);
  const PAGE = interviewFile("components", "hrm", "InterviewPage.js");
  // Both places a candidate is read take the formatters, or the list reads one way beside the
  // table and another in the record a row opens.
  assert.equal(PAGE.split("formatters={interviewInfoFormatters}").length - 1, 2);
});

test("the form ends with two answerable questions rather than one shapeless box", () => {
  /*
   * "Anything you would like us to know" is a question with no shape, and it came back the three
   * ways a shapeless question does: empty, holding a covering letter, or repeating a phone number
   * asked for three fields above. Nobody could read a column of those and learn anything, because
   * no two answered the same thing.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  const names = fields.map((field) => field.name);
  assert.equal(names.includes("remarks"), false, "the shapeless box is gone from the form");
  assert.equal("remarks" in applicationInitialValues, false);
  assert.equal(fields.find((field) => field.name === "howYouKnowUs")?.label, "How do you know us?");
  const about = fields.find((field) => field.name === "aboutUs");
  assert.equal(about?.label, "Anything about us?");
  assert.equal(about?.type, "textarea");
  assert.equal(about?.colSpan, 2);
  // Referred By and How do you know us? share a row, then the textarea takes the next whole one.
  assert.equal(names.indexOf("howYouKnowUs"), names.indexOf("referredBy") + 1);
  assert.equal(names.indexOf("aboutUs"), names.indexOf("howYouKnowUs") + 1);

  /*
   * **Not** the register's `source` column. That one is the studio's own answer to where a row came
   * from - set by a linked sheet's rules, filtered on in the register - so a candidate writing into
   * it would overwrite what the import established, which is the fault the form avoided by no
   * longer sending `department`.
   */
  assert.equal(names.includes("source"), false, "the studio's own source column is not asked of the candidate");
  const INVITES = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "invites.js"), "utf8");
  assert.match(INVITES, /howYouKnowUs: shortText\(1000\)/);
  assert.match(INVITES, /aboutUs: shortText\(5000\)/);
  /*
   * And `remarks` is out of the submission's schema as well as off the form. `prepareValues` runs
   * partially, so a key arriving empty would be written - and remarks is HR's own note, which a
   * candidate reopening their link must not be able to overwrite.
   */
  const submitSchema = INVITES.slice(INVITES.indexOf("const submitSchema"), INVITES.indexOf("async function submitApplication"));
  assert.equal(/^\s*remarks:/m.test(submitSchema), false, "a candidate cannot write over HR's note");

  // HR reads both on the record, under their own heading rather than mixed into Remarks.
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /title: "In Their Words"/);
  assert.match(CONFIG, /\{ name: "howYouKnowUs", label: "How do you know us\?", type: "text"(, helperText: "[^"]*")? \}/);
  // Available in the table, but not what the register opens on - the treatment Remarks gets.
  assert.ok(candidateDefaultHiddenColumns.includes("howYouKnowUs"));
  assert.ok(candidateDefaultHiddenColumns.includes("aboutUs"));
  assert.ok(candidateTableFields.some(([key]) => key === "aboutUs"));
});

test("the record reads back the application the candidate filled in", () => {
  /*
   * The two had drifted into different forms of the same interview: the application asked for
   * education as rows and the record as a one-line box, the application banded the notice period
   * and the record took free text, the application collected three links and the record showed one.
   * Half of what was submitted could not be seen here at all, let alone corrected.
   */
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  const record = candidateFormSections;
  // The application's sections, in its order, and **only** those: the record is the candidate's
  // application read back, and nothing the studio decided about them.
  assert.deepEqual(record.map((section) => section.title), ["The Role", "About You", "Experience & Expectations", "Anything Else"]);

  const recordNames = record.flatMap((section) => section.fields).map((field) => field.name);
  /*
   * Everything the candidate submits is on the record. These four are the ones that were stored and
   * shown on no screen: the two entry lists, the extra links and the attachments.
   */
  for (const name of ["educationEntries", "experienceEntries", "portfolioLinks", "attachments"]) {
    assert.ok(recordNames.includes(name), `${name} should be readable on the record`);
  }
  // The single Portfolio Link box and the duplicate Highest Qualification are gone with them.
  assert.equal(recordNames.includes("portfolioUrl"), false);
  assert.equal(recordNames.includes("highestQualification"), false);
  // But still a value the form carries, or the save would blank what a sheet put there.
  assert.ok("highestQualification" in emptyCandidateValues());

  /*
   * Where a control differs it is because the record has to survive what the application never
   * sees: a value a sheet or a CSV put there. A closed list would show it back as empty and then
   * save the blank over it, so both are comboboxes offering the form's own answers.
   */
  const fieldNamed = (name) => record.flatMap((section) => section.fields).find((field) => field.name === name);
  assert.equal(fieldNamed("noticePeriod")?.type, "combobox");
  assert.equal(fieldNamed("availableFrom")?.type, "combobox");

  /*
   * And the save no longer destroys a joining answer. `availableFrom` is free text holding
   * "Immediate", a day, or a sheet's "15 days"; it was read through `dateValue`, which returns ""
   * for anything but `YYYY-MM-DD`, so opening such a candidate showed an empty box and saving wrote
   * that blank over their answer - this form writes every key it is given.
   */
  assert.match(CONFIG, /availableFrom: candidate\?\.availableFrom \?\? "",/);
  assert.equal(/availableFrom: dateValue/.test(CONFIG), false, "a joining answer must not be read as a date");
  // A candidate written before the list existed reads as exactly one link, the way the application
  // form's own prefill reads them, so both screens show that candidate the same single box.
  assert.match(CONFIG, /portfolioLinks: candidate\?\.portfolioLinks\?\.length/);

  // The record draws the lists with the application's own controls rather than its own copies.
  const PANEL = interviewFile("components", "hrm", "candidateRecordForm.js");
  assert.match(RECORD_FORM, /<RepeatableTextList/);
  assert.match(PANEL, /<RepeatableDetailsField/);
  assert.match(PANEL, /renderers: candidateRenderers/);
  // Attachments are read, not edited, and never sent: the update endpoint does not take the key.
  assert.match(PANEL, /attachments: undefined,/);
  const CONTROLLER = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "controller.js"), "utf8");
  assert.match(CONTROLLER, /portfolioLinks: z\.array/);
  // The résumé is a document to open as well as an address to correct - a résumé is read, not
  // proof-read, and this record is also where a bad imported link is put right.
  assert.equal(fieldNamed("resumeUrl")?.type, "custom");
  assert.match(PANEL, /resumeUrl: \(\{ values, onChange, field \}\)/);
  assert.match(PANEL, /interviewInfoFormatters\.attachments\(values\.resumeUrl/);
});

test("the studio's decision about a candidate is asked apart from their record", () => {
  /*
   * Screening was the record's last section, which made one screen two jobs: reading back what
   * somebody submitted, and deciding what to do about them. Different errands, different moments -
   * and the stage, the one field anybody opens a candidate to change, sat below four sections of
   * the candidate's own answers.
   */
  const screeningNames = candidateScheduleSections.flatMap((section) => section.fields).map((field) => field.name);
  /*
   * **No `lastFollowUpDate`.** It asked HR to tell the register something the register already knew,
   * and it had to be remembered: the column means "the day somebody last worked this candidate", so
   * one nobody updated said the opposite of the truth. The server stamps it from the save itself
   * now. Next Follow-up stays, because it points the other way - a decision only a person can make.
   */
  /*
   * **No `status`.** The stage of a candidate with a round in the diary *is* "Interview Scheduled",
   * so a picker asking somebody to say so after they have booked it asks them to restate what they
   * have just done - and every time it was missed, the register's stage disagreed with the
   * register's own interview date. The server moves the stage from the act itself now, and records
   * why; the three stages that *are* decisions are taken in their own dialog, which asks why.
   */
  /*
   * **No `meetLink`, at any mode.** For a Google Meet round it cannot be a box - the link does not
   * exist until Google issues it as part of the calendar event the save is about to create. For In
   * Person and Phone there is nothing to ask for either: somebody walking into the studio has no
   * link, and a phone call is a number the record already holds, so the box stood empty on every
   * round of both modes and the one thing it could collect was a link pasted onto a round that is
   * not a video call.
   */
  assert.deepEqual(screeningNames, [
    "interviewDate", "interviewTime", "interviewMode", "durationMinutes", "interviewerEmployeeId",
    "attendees", "nextFollowUpDate", "remarks",
  ]);
  const recordNames = candidateFormSections.flatMap((section) => section.fields).map((field) => field.name);
  for (const name of screeningNames) assert.equal(recordNames.includes(name), false, `${name} belongs to Schedule Interview, not the record`);

  // Booking a round is the popup's own **Interview Scheduled** pill now, not a row menu entry - see
  // `interview-review.test.mjs` and `interview-candidate-popup.test.mjs` for that move. **Edit
  // Schedule** stays on the row for correcting one already booked, which no pill can do.
  const PAGE = interviewFile("components", "hrm", "InterviewPage.js");
  assert.equal(PAGE.includes('label: scheduled ? "Schedule Next Round" : "Schedule Interview",'), false);
  assert.equal(PAGE.includes("scheduleItem"), false, "scheduling is a pill away, not a menu item");
  assert.match(PAGE, /const editScheduleItem = scheduled/);
  assert.match(PAGE, /<InterviewScheduleDialog/);

  /*
   * The **record panel** sends the whole candidate, because `PUT /candidates/:id` is not partial -
   * it writes every column it is given a key for - so a body carrying only an interview date would
   * blank the name, the salary and everything else.
   *
   * Schedule Interview no longer does, and no longer can: it posts to `/candidates/:id/schedule`,
   * which is partial and writes only the round, the stage and the follow-up. That is what lets the
   * dialog stop carrying thirty fields it never draws in order not to erase them.
   */
  const DIALOG = interviewFile("components", "hrm", "InterviewScheduleDialog.js");
  assert.match(DIALOG, /scheduleInterview\(candidate\.id, \{/);
  assert.equal(DIALOG.includes("candidateFormValues"), false, "the schedule dialog no longer sends the whole record");
  assert.equal(DIALOG.includes("updateCandidate"), false, "scheduling goes through its own route, not the full update");
  const PANEL = interviewFile("components", "hrm", "candidateRecordForm.js");
  assert.match(RECORD_FORM, /status: values\.status \|\| candidate\?\.status \|\| DEFAULT_CANDIDATE_STATUS,/);
});

test("the three interview modes read apart, and a Meet is joined from the row", () => {
  /*
   * The mode decides what somebody has to do about the appointment - In Person is a day blocked out
   * and a room, Google Meet is a link to open, Phone is a number to ring - so the three carry
   * colours the way the stage beside them does, and read apart down the column at a glance.
   */
  assert.deepEqual(Object.keys(candidateModeStyles).sort(), ["Google Meet", "In Person", "Phone"]);
  assert.equal(new Set(Object.values(candidateModeStyles)).size, 3, "three modes, three colours");
  // Clear of the stage colours: the two columns sit near each other, and a shared colour would
  // invite the reading that they mean the same thing.
  const stageColours = new Set(Object.values(candidateStatusStyles));
  for (const colour of Object.values(candidateModeStyles)) {
    assert.equal(stageColours.has(colour), false, `${colour} is already a stage colour`);
  }
  // Every mode the register offers has one, or a picker could set a stage with no colour behind it.
  for (const mode of INTERVIEW_MODES) assert.ok(candidateModeStyles[mode], `${mode} needs a colour`);

  // Drawn as a dot and the word, through the same `status` cell the stage uses.
  const mode = candidateTableFields.find(([key]) => key === "interviewMode");
  assert.equal(mode?.[2], "status");
  // Both maps reach that cell: it keys off the value, and no stage is spelled like a mode.
  const PAGE = interviewFile("components", "hrm", "InterviewPage.js");
  assert.match(PAGE, /statusStyles: \{ \.\.\.candidateStatusStyles, \.\.\.candidateModeStyles \}/);

  /*
   * And the link is on the row, because a Meet interview is the one thing on this register anybody
   * acts on without opening a candidate first. A `link` cell opens a **new tab** and stops the
   * row's own click, so following it never navigates the register away.
   */
  const meet = candidateTableFields.find(([key]) => key === "meetLink");
  assert.equal(meet?.[2], "link");
  const CELLS = interviewFile("components", "data-table", "tableCells.js");
  assert.match(CELLS, /rel="noopener noreferrer"/);
  assert.match(CELLS, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  // Neither is hidden: a colour nobody has turned on gives no reading, and the link is the thing
  // somebody presses.
  assert.equal(candidateDefaultHiddenColumns.includes("interviewMode"), false);
  assert.equal(candidateDefaultHiddenColumns.includes("meetLink"), false);

  // On the record it is a control too, not 40 characters of URL to select and paste.
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /\["meetLink", "Meet Link", "meetLink"\]/);
  const FORMATTERS = interviewFile("components", "hrm", "interviewInfoFormatters.js");
  assert.match(FORMATTERS, /target="_blank"[\s\S]{0,80}?rel="noopener noreferrer"/);
});

test("a Selected candidate's row offers taking them on, and nothing about deciding again", () => {
  /*
   * Every other stage is somewhere in a conversation; this one is finished. The only things left to
   * do about the person are to take them on, read them, correct them, change the answer or remove
   * them. Taking them on is the popup's own **Onboarded** pill now, in the Edit every stage already
   * has - a row-menu entry beside it would be a second way to ask for the one thing, which is why
   * the branch itself carries only the answer changing again and removing them.
   */
  const branch = selectedBranch();
  assert.ok(branch.includes("rejectItem"), "the answer can still be changed");
  assert.ok(branch.includes('label: "Delete", tone: "danger"'));
  assert.equal(branch.includes("onboardingItem"), false, "taking them on is the popup's pill now, not a row menu entry");
  for (const gone of ["Send Onboarding Invite", "Send Screening Form", "Copy Link", "Schedule", "Mark Selected", "Put On Hold"]) {
    assert.equal(branch.includes(gone), false, `${gone} is not what a Selected row is for`);
  }

  /*
   * It opens the **Employee Repository's own** invite dialog rather than a second one of this
   * module's: an onboarding invite is the repository's record and always has been, and two screens
   * raising the same invite would be two places to fix when it changes.
   */
  assert.match(PAGE, /import OnboardingInviteDialog from "@\/components\/employees\/OnboardingInviteDialog"/);
  // Prefilled from the candidate: the four questions it asks are four the register has held since
  // the application arrived, and retyping them is how a number gets a digit wrong between screens.
  assert.match(PAGE, /candidateName: onboarding\.name \|\| "",/);
  assert.match(PAGE, /intendedDesignation: onboarding\.position \|\| "",/);
  const DIALOG = interviewFile("components", "employees", "OnboardingInviteDialog.js");
  // The prefill applies to a new invite only - one opened to be corrected shows itself.
  assert.match(DIALOG, /initialEditInvite \? formFromInvite\(initialEditInvite\) : \{ \.\.\.initialForm\(\), \.\.\.\(prefill \|\| \{\}\) \}/);

  /*
   * And the invite existing is what moves them: the stage goes to Onboarded with a note saying so,
   * rather than appearing to have changed on its own.
   */
  assert.match(PAGE, /setCandidateStatus\(moved\.id, ONBOARDED_STATUS, "Onboarding invite sent\."\)/);
  // The invite was raised whatever happens next, so a failure here reports the stage rather than
  // the invite - telling somebody the invite failed would have them send a second one.
  assert.match(PAGE, /The invite was sent, but the candidate could not be moved/);
});

test("a row is only offered the answers its stage can actually give", () => {
  /*
   * The menu was every entry the module has, on every row, whatever stage it was at - so a
   * candidate nobody had spoken to could be marked Selected, and one whose screening form had not
   * come back could have a round booked against answers nobody had read.
   *
   * **Mark Selected** is offered at every stage a row can act from, including **Yet to Connect**.
   * It used to appear only from Interview Scheduled onward, on the reasoning that nobody had been
   * spoken to before then - but somebody is taken on off a referral, or off a conversation that
   * never became a booked round, and the register has to be able to say so without walking them
   * through stages nobody used. Every stage moves through the same Why dialog as Reject and On
   * Hold, so a selection made early still records why it was made.
   *
   * The one row that does not get it is one already Selected, which is the rule Reject and On Hold
   * each keep - and the one stage that does not is **Form Submission Pending**, whose whole menu is
   * about the form that has not come back; that is asserted further down.
   */
  assert.match(PAGE, /const selectable = candidate\.status !== SELECTED_STATUS;/);
  assert.doesNotMatch(PAGE, /beforeAnyone/, "the stage gate on Mark Selected is back");

  /*
   * **Booking the first round** is a row-menu entry nowhere at all now - it is the popup's own
   * **Interview Scheduled** pill, reached through Edit. **Booking a next one**, and **correcting**
   * one already booked, stay menu entries - a pill cannot ask either, since the candidate does not
   * change stage for a second round and there is no stage to say "correct this". Both are still
   * withheld from the waiting row, for the same reason a first round is: nothing is booked, or
   * corrected, against a form that has not come back.
   */
  const waiting = waitingBranch();
  assert.equal(waiting.includes("scheduleNextItem"), false, "not while the studio is waiting on the form");
  assert.equal(waiting.includes("selectItem"), false, "nobody is selected off a form that has not arrived");
  // What is left is the waiting itself, and the two stops that are always available.
  assert.ok(waiting.includes("holdItem"));
  assert.ok(waiting.includes("rejectItem"));
  assert.ok(waiting.includes('label: "Cancel Form"'));

  // The plain menu carries both real menu decisions: a next round, and the correction beside it.
  const plain = plainBranch();
  assert.ok(plain.includes("scheduleNextItem"), "a next round is still a menu item, not a pill");
  assert.ok(plain.includes("selectItem"));
});

test("an Onboarded row is about the invite that took them on", () => {
  /*
   * Once the invite has gone out the row is about **that invite**: where its link is, correcting
   * what it was raised on, calling it off. What it deliberately stops offering is everything about
   * deciding - there is no next round to schedule after somebody has been taken on, no stage to
   * mark them at, and nothing to put on hold.
   */
  const branch = onboardedBranch();
  for (const label of ["Copy Link", "Edit Invite", "Cancel Invite", "Delete"]) {
    assert.ok(branch.includes(`label: "${label}"`), `${label} belongs on an Onboarded row`);
  }
  // Edit is there too, hoisted beside View for every stage rather than repeated here.
  assert.match(PAGE, /\n\s+editItem,/);
  // Reject stays: a studio can still be told no after the invite has gone.
  assert.ok(branch.includes("rejectItem"));
  for (const gone of ["Schedule", "Mark Selected", "Put On Hold", "Send Screening Form", "Send Onboarding Invite"]) {
    assert.equal(branch.includes(gone), false, `${gone} is not what an Onboarded row is for`);
  }
  // Calling a link off cannot be undone - the token is stored hashed - so it is the red one and
  // asks first, exactly as cancelling a screening form does.
  assert.ok(branch.includes('label: "Cancel Invite", tone: "danger"'));
  assert.match(PAGE, /title="Cancel this onboarding invite\?"/);
  // The three invite entries go together when there is nothing live to act on - a candidate moved
  // to this stage by hand, or by a sheet - rather than sitting there refusing.
  assert.match(PAGE, /const liveOnboarding = Boolean\(onboardingInvite\)/);

  /*
   * The invite is found by **email first, then phone**: the two records have no id between them -
   * an onboarding invite is the Employee Repository's, raised from here but never owned by here -
   * so the match is on what a person is identified by rather than on a key neither side stores.
   */
  assert.match(PAGE, /const candidateOnboardingInvites = useMemo/);
  assert.match(PAGE, /if \(email && byEmail\.has\(email\)\) return byEmail\.get\(email\);/);

  /*
   * And creating an invite leaves the dialog **open**. Its next screen is the hand-over - the link,
   * and the studio's wording from Settings → Employee Invite Template to paste into WhatsApp -
   * which closing it here threw away the moment it appeared, leaving somebody holding an invite
   * they had no way to send.
   */
  assert.match(PAGE, /The reader closes it\./);
  assert.equal(/onInviteCreated=\{\(\) => \{\s*const moved = onboarding;\s*setOnboarding\(null\);/.test(PAGE), false);
  // Correcting an invite does not move the stage a second time.
  assert.match(PAGE, /if \(onboarding\.editInvite\) \{ void loadOnboardingInvites\(\); return; \}/);
  // A correction keeps the invite's own link, which is the whole reason it is not a second invite.
  assert.match(PAGE, /initialEditInvite=\{onboarding\.editInvite \|\| null\}/);
});

test("the interview time is picked, and a written one is converted rather than lost", () => {
  /*
   * It was a text box asking for "e.g. 10:30 am", which is a clock face typed out: nothing could
   * sort on it, and "10.30", "10:30AM" and "half ten" were all the same appointment.
   */
  const time = candidateScheduleSections.flatMap((section) => section.fields).find((field) => field.name === "interviewTime");
  assert.equal(time?.type, "time");
  assert.equal(time?.placeholder, undefined, "a clock face needs no example");

  /*
   * Drawn with `TimeField`, the shared control **every** time in the application uses - the meeting
   * dialogs, the attendance request, this. One kind of time box across the studio's screens is
   * worth more than a picker built only for this one.
   */
  const SCHEMA = fs.readFileSync(path.join(HERE, "..", "src", "components", "schema-form", "SchemaFormFields.js"), "utf8");
  assert.match(SCHEMA, /if \(type === "time"\) return <TimeField/);

  /*
   * A native time input renders only `HH:MM`, so what a linked sheet or a CSV wrote is converted on
   * the way in - including the one case the "+12" rule gets backwards, where 12am is midnight and
   * 12pm is noon.
   */
  const at = (value) => candidateFormValues({ interviewTime: value }).interviewTime;
  assert.equal(at("10:30 am"), "10:30");
  assert.equal(at(" 7.45 pm "), "19:45");
  assert.equal(at("9 am"), "09:00");
  assert.equal(at("12:00 am"), "00:00");
  assert.equal(at("12:15 pm"), "12:15");
  assert.equal(at("23:45"), "23:45");
  assert.equal(at(""), "");
  /*
   * And anything no rule reads is returned **as it stands**, never blanked. The input cannot show
   * it, but it stays in the form's state, so a save carries it back instead of writing an empty
   * over it - which is exactly the fault `availableFrom` had.
   */
  assert.equal(at("half past ten"), "half past ten");
  assert.equal(at("25:00"), "25:00");
});

test("a second conversation is a round, not a correction of the first", () => {
  /*
   * The register held a single interview, so a studio that sees somebody twice had nowhere to put
   * the second: scheduling it overwrote the first, and with it the only record that the candidate
   * had already been in. Nobody could say whether a Thursday conversation was a first meeting or a
   * third.
   */
  const PAGE = interviewFile("components", "hrm", "InterviewPage.js");
  // Booking the *first* round is the popup's own Interview Scheduled pill now, and it asks the same
  // question there for whichever mode the act itself needs - `alreadySeen` reads the same
  // `interviewRound` the row menu's own `scheduled` does.
  assert.match(PAGE, /const alreadySeen = Number\(target\?\.interviewRound\) > 0;/);
  assert.match(PAGE, /mode: alreadySeen \? SCHEDULE_MODES\.next : SCHEDULE_MODES\.first/);
  // A *next* round stays a menu entry - no pill can ask for one, since the candidate does not
  // change stage for a second round - and Edit Schedule beside it is the correction, appearing
  // only where there is something to correct or a round to add to.
  assert.match(PAGE, /const scheduled = Number\(candidate\.interviewRound\) > 0;/);
  assert.match(PAGE, /const scheduleNextItem = scheduled/);
  assert.match(PAGE, /label: "Schedule Next Round"/);
  assert.match(PAGE, /const editScheduleItem = scheduled/);
  assert.match(PAGE, /label: "Edit Schedule"/);
  assert.equal(PAGE.split("editScheduleItem ? [editScheduleItem] : []").length - 1, 1, "beside the scheduling it corrects");

  /*
   * Which round they are on is **derived** from the rounds, not stored beside them: a count and the
   * list behind it would drift apart the first time anybody corrected a round by hand. A candidate
   * scheduled before the column existed has their one interview in the flat columns, and that is
   * round one.
   */
  const SERVICE = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "service.js"), "utf8");
  assert.match(SERVICE, /function roundCount\(candidate, rounds\)/);
  assert.match(SERVICE, /interviewRound: roundCount\(candidate, interviewRounds\)/);
  /*
   * And the four flat columns follow the **latest** round, which is what keeps the register's own
   * table, the linked sheets and the CSV importer reading the one interview they always have.
   */
  assert.match(SERVICE, /const latest = rounds\[rounds\.length - 1\];/);
  assert.match(SERVICE, /data\.interviewDate = dateText\(latest\.interviewDate\);/);

  const DIALOG = interviewFile("components", "hrm", "InterviewScheduleDialog.js");
  /*
   * Editing rewrites the round in place; a next round is appended - **on the server**, which is
   * where it moved when scheduling became one act. It has to be there: the same call also books the
   * Google Meet and moves the stage, and the round it writes has to carry the event id Google just
   * gave back. A browser that built the array would be handing it over already out of date.
   */
  const CONTROLLER = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "controller.js"), "utf8");
  assert.match(CONTROLLER, /\[\.\.\.rounds\.slice\(0, -1\), round\]/);
  assert.match(CONTROLLER, /\[\.\.\.rounds, round\]/);
  // The dialog still knows which errand it is on, because that is what its title and its starting
  // values are, and it is what it tells the server.
  assert.match(DIALOG, /const editing = mode === SCHEDULE_MODES\.edit;/);
  // A next round opens empty: the last one's details are a conversation that already happened, and
  // leaving them in the boxes invites a second round booked for the first one's date.
  assert.match(DIALOG, /interviewDate: "", interviewTime: "", interviewMode: ""/);
  /*
   * And a round has to say **when**. Opening empty means Save on an untouched form would otherwise
   * append a round saying nothing - advancing the count, and, because the flat columns follow the
   * latest round, erasing the interview already in the diary.
   */
  assert.match(DIALOG, /Choose the day this round is on\./);
  // The server will not write those columns from an empty round either - both ends, since a round
  // can also arrive from a caller that is not this dialog.
  assert.match(SERVICE, /const says = latest && \[latest\.interviewDate, latest\.interviewTime, latest\.interviewMode, latest\.meetLink\]/);

  /*
   * An onboarding invite answers to **`HRM / Employee Management`**, not to this page's own
   * permission: gating it on Interview write showed a recruiter an entry the server refuses.
   */
  assert.match(PAGE, /useModuleAccess\("HRM", "Employee Management"\)/);
  assert.match(PAGE, /const mayInvite = onboardingAccess\.canWrite;/);
  assert.match(PAGE, /if \(!onboardingAccess\.canRead\) return;/);
  // And "live" names the two statuses the server will actually act on, so Cancel Invite is not
  // offered on a Submitted or Expired invite that `cancelInvite` refuses with a 400.
  assert.match(PAGE, /\["Created", "Verified"\]\.includes\(onboardingInvite\.status\)/);

  // Shown on the register, read as the round it makes rather than as a bare count.
  const round = candidateTableFields.find(([key]) => key === "interviewRound");
  assert.equal(round?.[2], "round");
  assert.equal(candidateDefaultHiddenColumns.includes("interviewRound"), false);
  const CELLS = interviewFile("components", "data-table", "tableCells.js");
  // One rule, so the word, what a filter matches and what the CSV carries are the same answer.
  assert.match(CELLS, /if \(type === "round"\) return Number\(value\) > 0 \? `Round \$\{value\}` : "—";/);
  // And it sorts as the number it is, not as "Round 10" beside "Round 2".
  assert.match(CELLS, /type === "number" \|\| type === "amount" \|\| type === "round"/);
});

test("the position applied for is asked everywhere and refused nowhere", () => {
  /*
   * One rule, in the three places it is enforced, because a field the form marks required and the
   * validator does not - or the other way round - is a red asterisk over a save that goes through, or
   * a save refused for a field with no mark on it.
   */
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /\{ name: "position", label: "Position Applied For", type: "combobox", options: "positions"/);
  assert.equal(/name: "position"[^}]*required: true/.test(CONFIG), false, "the record's own field is not required");
  assert.equal(/found\.position = /.test(RECORD_FORM), false, "the validator must not refuse a blank position");
});

test("the record asks fresher-or-experienced the way the form does, already answered", () => {
  /*
   * The same dropdown, and the same branch behind it - but read back off the record rather than
   * asked again: rows mean experienced, the word "fresher" in the Experience column means fresher,
   * and anything else leaves it unanswered, which is the honest reading of a column that says a
   * span and nothing about rows.
   */
  const fields = candidateFormSections.flatMap((section) => section.fields);
  const level = fields.find((field) => field.name === "experienceLevel");
  assert.equal(level?.type, "select");
  assert.equal(level?.props?.sorted, false);
  const CONFIG = interviewFile("constants", "interviewConfig.js");
  assert.match(CONFIG, /experienceLevel: candidate\?\.experienceEntries\?\.length/);
  assert.equal(candidateFormValues({ experienceEntries: [{ companyName: "X" }] }).experienceLevel, "Experienced");
  assert.equal(candidateFormValues({ experience: "Fresher" }).experienceLevel, "Fresher");
  assert.equal(candidateFormValues({ experience: "2-3 yrs" }).experienceLevel, "", "a span says nothing about rows");

  // And the four that presuppose a job are hidden for a fresher, as on the form.
  for (const name of ["experienceEntries", "currentCompany", "currentDesignation", "currentCtc", "noticePeriod"]) {
    const field = fields.find((entry) => entry.name === name);
    assert.equal(typeof field?.when, "function", `${name} should follow the answer`);
    assert.equal(field.when({ experienceLevel: "Fresher" }), false);
    assert.equal(field.when({ experienceLevel: "Experienced" }), true);
  }
  /*
   * Hidden, never blanked. The save writes Experience the way the form does - Fresher, or what the
   * rows add up to - but keeps the column's own text where there are no rows, so a sheet's
   * "2-3 yrs" is not destroyed by a screen that simply had nothing to put in its place.
   */
  const PANEL = interviewFile("components", "hrm", "candidateRecordForm.js");
  assert.match(RECORD_FORM, /summed \|\| candidate\?\.experience \|\| ""/);
  assert.match(PANEL, /experienceLevel: undefined,/);
});

test("notice period is a band, not a box somebody types a month into five ways", () => {
  /*
   * "1 month", "30 days", "one month notice", "30days" and "1 mnth" are one answer typed five ways,
   * and nothing could sort or filter them. The bands are what the studio acts on.
   */
  assert.deepEqual(NOTICE_PERIODS, ["Immediate", "Under 15 days", "Under 30 days", "Under 45 days", "60 days or more"]);
  const notice = applicationFormSections.flatMap((section) => section.fields).find((field) => field.name === "noticePeriod");
  assert.equal(notice?.type, "select");
  // Ladder order, not the alphabet - "Under 15 days" would otherwise sort below "Under 45 days".
  assert.equal(notice?.props?.sorted, false);
  // Asked only of somebody who has a job to leave.
  assert.equal(notice.when({ experienceLevel: "Fresher" }), false);
  assert.equal(notice.when({ experienceLevel: "Experienced" }), true);
});

test("education is asked under About You, where every candidate has an answer", () => {
  /*
   * It is the one part of a CV every candidate has - a fresher most of all, for whom it is the
   * whole application - and it used to sit at the very bottom, below salary and notice-period
   * questions that do not apply to them.
   */
  const aboutYou = applicationFormSections.find((section) => section.id === "about-you");
  const qualifications = aboutYou?.fields.find((field) => field.name === "qualifications");
  assert.equal(qualifications?.type, "custom", "the education list belongs to About You");
  assert.equal(qualifications?.colSpan, 2);
  // Asked of everybody: no `when` gates it, unlike the work history.
  assert.equal(qualifications?.when, undefined);
  // The work history stays with the question that branches on it, in the section after.
  const experience = applicationFormSections.find((section) => section.id === "experience");
  const names = experience.fields.map((field) => field.name);
  assert.ok(names.indexOf("experiences") > names.indexOf("experienceLevel"), "the rows follow the question");
  // No section of its own left to keep in step - both lists are fields of the sections they sit in.
  const FORM = interviewFile("components", "interview", "PublicApplicationForm.js");
  assert.equal(/Education & Work History/.test(FORM), false);
  assert.equal(/LISTS_SECTION/.test(FORM), false);
});

test("a fresher is not asked the four questions that presuppose a job", () => {
  /*
   * A fresher has no current company, no designation, no current salary and no notice to serve, so
   * each was a box to read, understand does not apply, and leave empty. Expected Salary stays for
   * everybody: a fresher has no current salary but does have an expectation, and it is one of the
   * few answers that decides whether a conversation is worth having.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  for (const name of ["currentCompany", "currentDesignation", "currentCtc", "noticePeriod"]) {
    const field = fields.find((entry) => entry.name === name);
    assert.equal(typeof field?.when, "function", `${name} should be asked only of somebody experienced`);
    assert.equal(field.when({ experienceLevel: "Experienced" }), true);
    assert.equal(field.when({ experienceLevel: "Fresher" }), false);
  }
  assert.equal(fields.find((entry) => entry.name === "expectedCtc")?.when, undefined, "Expected Salary is asked of everybody");
  // The placeholder that admitted the problem - "Leave empty if you are not working" - is gone
  // with the box it apologised for: the field is absent now rather than asked and waived.
  assert.equal(fields.find((entry) => entry.name === "currentCompany")?.props?.placeholder, undefined);
  /*
   * And nothing withheld is ever demanded: the required check reads the same `when`, so a fresher
   * is never refused for a question that was not on their screen.
   */
  assert.deepEqual(missingApplicationFields({
    position: "Editor", firstName: "Anu", contactNumber: "+91 9876543210", emailId: "a@b.com",
    experienceLevel: "Fresher", immediateJoiner: "Yes",
  }), []);
});

test("the candidate says fresher or experienced, and is asked before the work history", () => {
  /*
   * It replaces a **Total Experience** box, which asked for a number the candidate then stated
   * again row by row in Experience Details - two answers to one question, free to disagree, with
   * nothing to say which the studio should believe. **Highest Qualification** went the same way: a
   * box beside a Qualifications list that already asks for every qualification with its own marks.
   */
  const fields = applicationFormSections.flatMap((section) => section.fields);
  const names = fields.map((field) => field.name);
  assert.equal(names.includes("experience"), false, "Total Experience should not be asked for");
  assert.equal(names.includes("highestQualification"), false, "Highest Qualification should not be asked for");
  const level = fields.find((field) => field.name === "experienceLevel");
  assert.equal(level?.required, true, "the answer gates the work history, so it is required");
  assert.deepEqual(EXPERIENCE_LEVELS, ["Fresher", "Experienced"]);
  // Asked in a section that renders before the lists, which are drawn after every section.
  const sectionIds = applicationFormSections.map((section) => section.id);
  assert.ok(sectionIds.includes("experience"));
  // And it is a required field the existing check already covers, `when` and all.
  assert.ok(requiredApplicationFields.some(([name]) => name === "experienceLevel"));
});

test("Total Experience is added up from the rows, not typed", () => {
  // The rows are the answer, so the total is read off them: a box somebody could type into would
  // be a second answer to a question already answered.
  assert.equal(totalExperienceFrom([{ years: "2" }, { years: "1.5" }]), "3.5 years");
  assert.equal(totalExperienceFrom([{ years: "1" }]), "1 year");
  // A row with a company and no span says somebody worked there, not that they worked no time -
  // so it adds nothing, and "" leaves HR to ask rather than putting 0 on the record.
  assert.equal(totalExperienceFrom([{ companyName: "Studio X" }]), "");
  assert.equal(totalExperienceFrom([{ years: "0" }]), "");
  assert.equal(totalExperienceFrom([]), "");
  assert.equal(totalExperienceFrom(), "");
  // Drawn read-only beside the rows, and sent as the register's Experience.
  const FORM = interviewFile("components", "interview", "PublicApplicationForm.js");
  assert.match(FORM, /const totalExperience = totalExperienceFrom\(form\.experiences\);/);
  assert.match(FORM, /readOnly/);
  assert.match(FORM, /values\.experience = experienced \? totalExperience : FRESHER;/);
  // A field of the section like any other, so it sits with the rows it sums rather than in a
  // block of JSX built around it; its renderer reads the rows straight out of the answers.
  const totalField = applicationFormSections
    .flatMap((section) => section.fields)
    .find((field) => field.name === "totalExperience");
  assert.equal(totalField?.type, "custom");
  assert.match(FORM, /totalExperience: \(\{ values, field \}\) => <TextField/);
  /*
   * Beside the question, not under the rows: the grid is two columns from `md` up, so the total
   * sits against "Are you a fresher or experienced?" - "Experienced" and "4.5 years" are one
   * sentence. Under the full-width list it was a lone half-width box reading as a question somebody
   * had forgotten to answer.
   */
  const order = applicationFormSections.flatMap((section) => section.fields).map((field) => field.name);
  assert.equal(order.indexOf("totalExperience"), order.indexOf("experienceLevel") + 1, "beside the question it summarises");
  assert.ok(order.indexOf("totalExperience") < order.indexOf("experiences"), "above the rows it sums");
  assert.equal(totalField?.colSpan, undefined, "half a row, so it shares one with the question");
  // A fresher sees it too, reading back the word the register will record rather than a sum.
  assert.match(FORM, /values\.experienceLevel === EXPERIENCED \? \(totalExperienceFrom\(values\.experiences\) \|\| ""\)/);
  assert.match(FORM, /totalExperienceFrom\(values\.experiences\)/);
  // Never submitted: it is the rows read back, and `experience` is what the register keeps.
  assert.match(FORM, /delete values\.totalExperience;/);
});

test("a fresher is not shown a work history to leave empty, and sends none", () => {
  const FORM = interviewFile("components", "interview", "PublicApplicationForm.js");
  assert.match(FORM, /const experienced = form\.experienceLevel === EXPERIENCED;/);
  // The list and the total are drawn only for somebody who has any - through the schema's own
  // `when`, which is the same rule `missingApplicationFields` reads, so a question that is not on
  // screen can never be one the submit refuses for.
  for (const name of ["experiences"]) {
    const field = applicationFormSections.flatMap((section) => section.fields).find((entry) => entry.name === name);
    assert.equal(typeof field?.when, "function", `${name} should be asked only of somebody experienced`);
    assert.equal(field.when({ experienceLevel: "Experienced" }), true);
    assert.equal(field.when({ experienceLevel: "Fresher" }), false);
    assert.equal(field.when({}), false, "an unanswered question shows the fresher's shorter form");
  }
  // Whatever was typed before they answered Fresher is not sent.
  assert.match(FORM, /payload\.experiences = experienced \? filledDetailRows\("experiences", experiences\) : \[\];/);
  // Nor checked: a row left behind by somebody who changed their mind is not a problem to solve.
  assert.match(FORM, /LISTS\.filter\(\(name\) => name !== "experiences" \|\| experienced\)/);
  // But somebody who says they are experienced has to say where, or they arrive on the register
  // as experienced with nothing to show for it.
  assert.match(FORM, /experienced && !filledDetailRows\("experiences", form\.experiences\)\.length/);
  // `experienceLevel` is this form's branch, not a column: it is taken out of the payload.
  assert.match(FORM, /const \{ qualifications, experiences, resume, attachments, experienceLevel, immediateJoiner, portfolioLinks: _links, \.\.\.values \} = form;/);
});
