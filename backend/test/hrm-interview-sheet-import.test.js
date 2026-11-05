const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveColumnMapping,
  buildExistingIndexes,
  mapRowToCandidate,
  validateCandidateRecord,
  classifyAgainstExisting,
} = require("../src/modules/hrm/interview/sheetImport");
const { normalizeCandidateStatus, formatCandidateCode, parseCandidateCode, CANDIDATE_STATUSES } = require("../src/modules/hrm/interview/candidates");
const { buildAssignmentMatcher } = require("../src/modules/sales/crm-leads/leadAssignmentRules");

/*
 * How a linked sheet's row becomes an interview candidate.
 *
 * Only the decision is tested - no database, no Google. The importer is the CRM's read for a
 * candidate rather than a lead, and the things that have to hold are the same: a heading matches
 * however the sheet spells it, a row already here is an edit rather than a second person, and the
 * assignment rules fill a blank interviewer without ever overruling a name somebody typed.
 */

const HEADERS = ["Timestamp", "Full Name", "Mobile No", "Email Address", "Position Applied For", "Experience", "Current Location", "Status", "Interviewer", "Source"];
const LINK = { id: "link-1", spreadsheetId: "sheet-1", gid: "0", targetedTab: "Responses", sheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1", systemTableId: "interview-table" };
const codes = () => { let n = 0; return { next: () => formatCandidateCode(++n) }; };
const row = (over = []) => ["10-Sep-26 10:57 am", "Anu Priya", "9876500000", "Anu@Example.com", "Photographer", "3 years", "Erode", "on hold", "", "Naukri", ...over];

test("the sheet's own headings are read into the candidate's fields, however they are spelt", () => {
  const mapping = resolveColumnMapping(HEADERS);
  assert.equal(mapping.fields.name.sourceHeader, "Full Name");
  assert.equal(mapping.fields.phone.sourceHeader, "Mobile No");
  assert.equal(mapping.fields.email.sourceHeader, "Email Address");
  assert.equal(mapping.fields.position.sourceHeader, "Position Applied For");
  /*
   * "Current Location" is its own column now, and no longer folded onto City.
   *
   * It had nowhere else to go while the register held only a city, so a sheet naming both a hometown
   * and a current location had one of them silently overwrite the other in that one column. The
   * screening form asks Native Place and Current Location, the register keeps both, and each heading
   * goes to the field it actually names.
   */
  assert.equal(mapping.fields.currentLocation.sourceHeader, "Current Location");
  assert.equal(mapping.fields.city, undefined, "a current location is no longer read as a city");
  assert.equal(mapping.fields.appliedDate.sourceHeader, "Timestamp");
  assert.deepEqual(mapping.unmappedHeaders, []);
  assert.deepEqual(mapping.missingRequiredFields, []);
});

test("a heading nothing reads is reported rather than dropped, and a sheet with no name column says so", () => {
  const mapping = resolveColumnMapping(["Page Name", "Phone"]);
  assert.deepEqual(mapping.unmappedHeaders, ["Page Name"]);
  assert.deepEqual(mapping.missingRequiredFields, ["name"]);
});

test("a form's Timestamp is read as the applied day and the clock time beside it", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const { record } = mapRowToCandidate(row(), mapping, LINK, 2, codes());
  assert.equal(record.candidate.appliedDate, "2026-09-10");
  assert.equal(record.candidate.addedTime, "10:57 am");
  // The status is folded onto the module's own spelling, and the source is the sheet's own answer.
  assert.equal(record.candidate.status, "On Hold");
  assert.equal(record.candidate.source, "Naukri");
  assert.equal(record.candidate.email, "Anu@Example.com");
  assert.match(record.candidate.candidateCode, /^DBS-INTV-\d{6}$/);
  assert.equal(record.details.sourceRowId, "sheet-1:0:row:2");
});

test("a row with no source says where it came from, and a row with no date is filed under today", () => {
  const mapping = resolveColumnMapping(["Name", "Phone"]);
  const { record } = mapRowToCandidate(["Kumar", "9876511111"], mapping, LINK, 5, codes());
  assert.equal(record.candidate.source, "Google sheet integration");
  assert.match(record.candidate.appliedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(record.candidate.status, "Yet to Connect");
});

test("an assignment rule fills a blank interviewer, and never overrules one the sheet names", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const rules = [{ id: "r1", priority: 0, columnHeader: "Source", matchValue: "naukri", targets: [{ employeeId: 7, employeeName: "Divya R", percent: 100, assignedCount: 0, position: 0 }] }];
  const link = { ...LINK, assignmentMatcher: buildAssignmentMatcher(HEADERS, rules) };

  const blank = mapRowToCandidate(row(), mapping, link, 2, codes());
  assert.equal(blank.record.candidate.interviewer, "Divya R");
  assert.equal(blank.assignment.rule.columnHeader, "Source");

  const named = mapRowToCandidate(["10-Sep-26", "Raj", "9876522222", "", "", "", "", "", "Kishore M", "Naukri"], mapping, link, 3, codes());
  assert.equal(named.record.candidate.interviewer, "Kishore M");
  assert.equal(named.assignment, null);
});

test("a candidate already in the register keeps their code and their interviewer on a re-sync", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const existing = buildExistingIndexes([{ candidateCode: "DBS-INTV-000042", name: "Anu Priya", phone: "9876500000", email: "", interviewer: "Kishore M", status: "Interview Scheduled", spreadsheetId: "sheet-1", gid: "0", targetTab: "Responses", sourceRowId: "sheet-1:0:row:2", sourceRowNumber: 2 }]);
  const { record } = mapRowToCandidate(row(), mapping, LINK, 2, codes(), existing);
  assert.equal(record.candidate.candidateCode, "DBS-INTV-000042");
  // The manager's assignment on the screen is not taken back by the sheet.
  assert.equal(record.candidate.interviewer, "Kishore M");
  // The sheet's own status column is believed, as it is for a lead.
  assert.equal(record.candidate.status, "On Hold");
  assert.equal(classifyAgainstExisting(record, existing).classification, "EXISTING");
});

test("the same phone twice in one sheet is a duplicate, and the same phone already here is an edit", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const indexes = buildExistingIndexes([{ candidateCode: "DBS-INTV-000001", name: "Anu", phone: "+91 98765 00000", email: "", sourceRowId: "other:row:9", sourceRowNumber: 9, spreadsheetId: "other", gid: "", targetTab: "" }]);
  const seen = new Map();
  const first = mapRowToCandidate(row(), mapping, LINK, 2, codes(), buildExistingIndexes([]));
  const second = mapRowToCandidate(row(), mapping, LINK, 3, codes(), buildExistingIndexes([]));
  assert.equal(classifyAgainstExisting(first.record, indexes, seen).classification, "EXISTING");
  assert.equal(classifyAgainstExisting(second.record, indexes, seen).classification, "DUPLICATE_IN_SHEET");
});

test("a row without a name, with a bad email or with a date that is not one is refused, and says why", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const { record } = mapRowToCandidate(["next week", "", "9876500000", "not-an-email", "", "", "", "", "", ""], mapping, LINK, 2, codes());
  const { valid, issues } = validateCandidateRecord(record);
  assert.equal(valid, false);
  assert.deepEqual(issues.map((issue) => issue.field).sort(), ["appliedDate", "email", "name"]);
});

test("a status is folded onto the list, and a word the list has no name for is kept as typed", () => {
  assert.equal(normalizeCandidateStatus("ON HOLD"), "On Hold");
  assert.equal(normalizeCandidateStatus("form sent"), "Form Submission Pending");
  assert.equal(normalizeCandidateStatus("interview scheduled"), "Interview Scheduled");
  assert.equal(normalizeCandidateStatus("HIRED"), "Selected");
  assert.equal(normalizeCandidateStatus("not selected"), "Rejected");
  assert.equal(normalizeCandidateStatus("Second Round"), "Second Round");
  assert.equal(normalizeCandidateStatus(""), "");
  for (const status of CANDIDATE_STATUSES) assert.equal(normalizeCandidateStatus(status.toLowerCase()), status);
});

test("the old names are folded onto the stages that replaced them", () => {
  // Rows written before the stages were renamed, and a recruiter's own spreadsheet vocabulary.
  assert.equal(normalizeCandidateStatus("New"), "Yet to Connect");
  assert.equal(normalizeCandidateStatus("Screening"), "Form Submission Pending");
  assert.equal(normalizeCandidateStatus("Form Sent"), "Form Submission Pending");
  assert.equal(normalizeCandidateStatus("Application Received"), "Form Submitted");
});

test("the stages are in the order the tab row shows them, with the two stops last", () => {
  /*
   * Pinned in order, because the order is the meaning: the five before On Hold and Rejected are the
   * stages somebody works every morning, and a stop sorted into the middle of them collects rows
   * nobody looks at again. Rejected is last of all, after every stage a candidate can move on from.
   */
  assert.deepEqual(CANDIDATE_STATUSES, [
    "Yet to Connect", "Follow Up", "Form Submission Pending", "Form Submitted", "Interview Scheduled", "Selected", "Onboarded", "On Hold", "Rejected",
  ]);
  /*
   * **Follow Up** sits straight after the stage it answers. A candidate nobody has spoken to gets
   * one of two things done to them - the screening form, or a call - and only the first was a stage;
   * the second was a remark, or nothing, so the register could not tell "nobody has tried this
   * person" from "we have called three times and they have not answered".
   */
  assert.equal(CANDIDATE_STATUSES.indexOf("Follow Up"), CANDIDATE_STATUSES.indexOf("Yet to Connect") + 1);
  assert.equal(normalizeCandidateStatus("Follow-up"), "Follow Up");
  assert.equal(normalizeCandidateStatus("No Response"), "Follow Up");
  // Onboarded sits after Selected: an offer made and an offer taken are different answers, and the
  // gap between them is where a register that stopped at Selected could say nothing.
  assert.equal(CANDIDATE_STATUSES.indexOf("Onboarded"), CANDIDATE_STATUSES.indexOf("Selected") + 1);
  assert.equal(normalizeCandidateStatus("onboarded"), "Onboarded");
  // "Joined" is still left as typed - see the map's own note on the three words it will not fold.
  assert.equal(normalizeCandidateStatus("Joined"), "Joined");
  assert.equal(CANDIDATE_STATUSES.at(-1), "Rejected");
});

test("a stage the list does not name is kept as typed rather than filed somewhere nobody chose", () => {
  /*
   * Shortlisted, Interviewed and Joined are not stages here, and neither may be folded onto one
   * that is: reading "Interviewed" as Form Submitted moves a candidate backwards, and reading it as
   * Selected answers a question nobody has answered. Each keeps its word and shows under All.
   *
   * "Declined" is the same refusal for a different reason - a candidate who turned the job down and
   * one the studio turned down are not the same row, and guessing which a spreadsheet meant is the
   * one mistake this map must not make.
   */
  for (const kept of ["Shortlisted", "Interviewed", "Joined", "Declined", "Second Round"]) {
    assert.equal(normalizeCandidateStatus(kept), kept, `${kept} should arrive as typed`);
    assert.equal(CANDIDATE_STATUSES.includes(kept), false, `${kept} should not be a stage`);
  }
});

test("a Meta lead export's own header row is read whole, ad columns and all", () => {
  /*
   * The studio's hiring sheet is a Meta (Facebook/Instagram) lead export, and this is its header
   * row as it arrives - questions with their question marks, the ad hierarchy, and a serial column
   * the sheet numbers itself. Every heading has to land somewhere or the studio is back to reading
   * the spreadsheet: the point of the register is that it already holds what the sheet holds.
   */
  const META = ["SI.No.", "Date", "Campaign Name", "Adset Name", "Ad Name", "Years of experience", "Current Salary",
    "Expected Salary", "Languages known?", "When Can you join?", "Name", "Phone Number", "Gender", "City"];
  const mapping = resolveColumnMapping(META);
  assert.deepEqual(mapping.missingRequiredFields, []);
  // The sheet's serial column is the one heading left unread, and deliberately: the table numbers
  // its own rows, so a second serial would be a column that disagrees with the one beside it.
  assert.deepEqual(mapping.unmappedHeaders, ["SI.No."]);
  assert.equal(mapping.fields.campaignName.sourceHeader, "Campaign Name");
  assert.equal(mapping.fields.adsetName.sourceHeader, "Adset Name");
  assert.equal(mapping.fields.adName.sourceHeader, "Ad Name");
  assert.equal(mapping.fields.experience.sourceHeader, "Years of experience");
  assert.equal(mapping.fields.currentCtc.sourceHeader, "Current Salary");
  assert.equal(mapping.fields.expectedCtc.sourceHeader, "Expected Salary");
  assert.equal(mapping.fields.languagesKnown.sourceHeader, "Languages known?");
  assert.equal(mapping.fields.availableFrom.sourceHeader, "When Can you join?");
  assert.equal(mapping.fields.appliedDate.sourceHeader, "Date");
  assert.equal(mapping.fields.phone.sourceHeader, "Phone Number");

  const row = ["1", "10-Sep-26 10:57 am", "Photographer Hiring Sep", "Erode 22-35", "Reel - Studio Tour", "3 years",
    "25000", "35000", "Tamil, English", "Immediately", "Anu Priya", "9876500000", "Female", "Erode"];
  const { record } = mapRowToCandidate(row, mapping, LINK, 2, codes());
  assert.equal(record.candidate.campaignName, "Photographer Hiring Sep");
  assert.equal(record.candidate.adsetName, "Erode 22-35");
  assert.equal(record.candidate.adName, "Reel - Studio Tour");
  // "Immediately" is not a date and is kept as the candidate answered it, rather than guessed into
  // one or dropped - which is what a joining question on an ad form is usually answered with.
  assert.equal(record.candidate.availableFrom, "Immediately");
  assert.equal(record.candidate.currentCtc, "25000");
  assert.equal(record.candidate.languagesKnown, "Tamil, English");
});

test("a re-sync carries a renamed campaign through, because the sheet owns those three columns", () => {
  // A studio that renames a campaign mid-flight expects the register to say the new name: these are
  // columns only a sheet ever fills, so nothing on screen can be overruled by writing them.
  const { SHEET_WRITTEN_FIELDS } = require("../src/modules/hrm/interview/sheetSyncService");
  for (const field of ["campaignName", "adsetName", "adName"]) {
    assert.ok(SHEET_WRITTEN_FIELDS.includes(field), `${field} should be written on every pass`);
  }
});

test("a candidate code is DBS-INTV- and six digits, and reads back to its number", () => {
  assert.equal(formatCandidateCode(7), "DBS-INTV-000007");
  assert.equal(parseCandidateCode("DBS-INTV-000007"), 7);
  assert.equal(parseCandidateCode("DBS-EID-QQ-ERD-000007"), 0);
  assert.equal(parseCandidateCode(""), 0);
});

test('"When Can You Join" may be a word, because that is what the column holds', () => {
  /*
   * The studio's own screening form asks whether somebody is an immediate joiner and writes a
   * *word* into `availableFrom` when they are - the column is `VARCHAR(40)` and has always held
   * either a day or an answer like "Immediate", "15 days" or "Negotiable".
   *
   * The sheet importer validated it as a day, so a row carrying exactly what the application form
   * puts there was refused outright - and since one bad cell fails the whole row, a sheet of ten
   * candidates could import none of them.
   */
  const { validateCandidateRecord } = require("../src/modules/hrm/interview/sheetImport");
  for (const answer of ["Immediate", "Immediately", "15 days", "1 month", "Negotiable", "ASAP"]) {
    const result = validateCandidateRecord({ candidate: { name: "Asha", availableFrom: answer } });
    assert.equal(result.valid, true, `"${answer}" is refused: ${result.issues.map((i) => i.reason).join(", ")}`);
  }
  // A real date still passes, and is still folded to a day by the mapper.
  assert.equal(validateCandidateRecord({ candidate: { name: "Asha", availableFrom: "25/09/2026" } }).valid, true);
});

test("the other date columns are still refused when they are not days", () => {
  /*
   * The reason that rule exists: "next week" in Interview Date is a note in the wrong column, and
   * filing it as a day would put the candidate in no tab. Only `availableFrom` is exempt, which is
   * why the validated list is its own rather than the list the mapper normalises.
   */
  const { validateCandidateRecord, CANDIDATE_DATE_FIELDS, CANDIDATE_REQUIRED_DAY_FIELDS } = require("../src/modules/hrm/interview/sheetImport");
  for (const field of ["interviewDate", "appliedDate", "dateOfBirth", "lastFollowUpDate", "nextFollowUpDate"]) {
    const result = validateCandidateRecord({ candidate: { name: "Asha", [field]: "next week" } });
    assert.equal(result.valid, false, `${field} accepts a value that is not a day`);
  }
  // Exactly one field is exempt, and it is that one.
  assert.deepEqual(
    CANDIDATE_DATE_FIELDS.filter((field) => !CANDIDATE_REQUIRED_DAY_FIELDS.includes(field)),
    ["availableFrom"],
  );
});
