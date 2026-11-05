const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateCandidateRecord, clearUnreadableFields } = require("../src/modules/hrm/interview/sheetImport");

/*
 * A cell the importer cannot read costs that cell, not the lead.
 *
 * A sheet row used to be refused outright when any one of its fields failed to parse - and the
 * fields that fail are the ones a person answers in their own words. "feb 10 th and 11 th 2027" in
 * When is the Event Planned, "Immediate" in a joining date, a state name where a date was expected:
 * every one of those took a whole lead with it, name and number and the campaign that paid for it.
 * A studio would sync ten new enquiries and import none of them.
 *
 * So the unreadable cell is emptied and the row is kept. Every column this touches is nullable text,
 * so a blank is a value the table already holds, and the studio can see the gap and fill it in.
 *
 * "When Can You Join" is the one that stopped being a date question altogether. The studio's own
 * screening form writes a *word* there - "Immediate", "15 days", "Negotiable" - so it is free text
 * and is never judged as a day (`CANDIDATE_REQUIRED_DAY_FIELDS` in `sheetImport.js`). It is kept
 * as typed rather than emptied, which is a different answer from the rest of this file: a word
 * that column was designed to hold is not an unreadable cell.
 */

const CRM = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"), "utf8");
const SYNC = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "sheetSyncService.js"), "utf8");

test("a row with several unreadable cells still imports, with those cells blank", () => {
  const record = {
    candidate: {
      name: "", phone: "9848744752", email: "not-an-email",
      availableFrom: "Immediate", interviewDate: "next week",
      city: "Chennai", source: "Instagram", campaignName: "QQ - Vizag",
    },
  };
  const { issues } = validateCandidateRecord(record);
  const cleared = clearUnreadableFields(record, issues);

  assert.deepEqual(cleared.map((c) => c.field).sort(), ["email", "interviewDate", "name"]);
  for (const field of ["name", "email", "interviewDate"]) {
    assert.equal(record.candidate[field], null, `${field} should be blank, not the value that could not be read`);
  }
  // Everything readable is untouched - which is the whole point.
  assert.equal(record.candidate.phone, "9848744752");
  assert.equal(record.candidate.city, "Chennai");
  assert.equal(record.candidate.campaignName, "QQ - Vizag");
  /*
   * And "Immediate" is readable: When Can You Join is free text, so the word the screening form
   * put there is the answer and survives the import. Emptying it would throw away the one thing
   * that column was asked for - see this file's opening note.
   */
  assert.equal(record.candidate.availableFrom, "Immediate", "a joining answer in words must not be emptied");
});

test("a nameless row is imported too, rather than thrown away", () => {
  /*
   * The studio asked for this by name: a lead is a lead. A wholly blank spreadsheet row never
   * reaches here - `normalizeSheetRows` drops a row with nothing in any cell - so what this keeps
   * is a row that has something, just not a name.
   */
  const record = { candidate: { name: "", phone: "9840449960" } };
  const cleared = clearUnreadableFields(record, validateCandidateRecord(record).issues);
  assert.ok(cleared.some((c) => c.field === "name"));
  assert.equal(record.candidate.name, null);
  assert.equal(record.candidate.phone, "9840449960", "the one thing identifying them must survive");
});

test("`null`, never an empty string", () => {
  // On this schema `""` never means "none" - a blank has to be a blank.
  const record = { candidate: { name: "Asha", interviewDate: "whenever" } };
  clearUnreadableFields(record, validateCandidateRecord(record).issues);
  assert.strictEqual(record.candidate.interviewDate, null);
  assert.notStrictEqual(record.candidate.interviewDate, "");
});

test("the cells are emptied before the row is matched, not after", () => {
  /*
   * A phone the importer could not read is not a phone to find an existing lead by either. Blanking
   * after classification would match on a value that is about to be thrown away, so a row could be
   * called EXISTING on a number the register never ends up holding.
   */
  for (const [label, source] of [["CRM leads", CRM], ["HRM interview", SYNC]]) {
    const cleared = source.indexOf("clearUnreadableFields(");
    const classified = source.indexOf("classifyAgainstExisting(");
    assert.ok(cleared !== -1 && classified !== -1, `${label}: one of the two steps is missing`);
    assert.ok(cleared < classified, `${label}: the row is matched before its unreadable cells are emptied`);
  }
});

test("no sheet row is refused for what one of its cells holds", () => {
  for (const [label, source] of [["CRM leads", CRM], ["HRM interview", SYNC]]) {
    assert.doesNotMatch(source, /\? "INVALID" :/, `${label}: a row is classified INVALID again`);
    assert.match(source, /skippedInvalid: 0,/, `${label}: the summary reports refused rows again`);
    // Counted and named by column instead, so the sheet can be corrected.
    assert.match(source, /clearedFields/, `${label}: the emptied cells are not reported`);
    assert.match(source, /\$\{issue\.field\}: \$\{issue\.reason\}/, `${label}: a blanked cell is not named by its column`);
  }
});

test("a nameless candidate is stored as null, never as an empty string", () => {
  /*
   * `name` was the one column that could not honour the rule. `hrm_interview_candidate.name` was
   * `VARCHAR(191) NOT NULL`, so the upsert coerced a blanked name with `data.name || ""` and the
   * row landed holding `''` - which on this schema is the one thing a blank must never be. Anything
   * asking `name IS NOT NULL`, which is the convention here, would have read those rows as named.
   *
   * The column is nullable now (20260926090000_interview_candidate_name_nullable), matching
   * `sales_crm_lead.name`, which has always been.
   */
  const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const candidate = SCHEMA.slice(SCHEMA.indexOf("model HrmInterviewCandidate {"), SCHEMA.indexOf("\n}", SCHEMA.indexOf("model HrmInterviewCandidate {")));
  assert.match(candidate, /^\s+name\s+String\?\s+@db\.VarChar\(191\)/m, "the candidate name is NOT NULL again, so a blanked name cannot be stored as one");

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260926090000_interview_candidate_name_nullable", "migration.sql"),
    "utf8",
  );
  assert.match(migration, /MODIFY COLUMN `name` VARCHAR\(191\) NULL/, "the migration does not widen the column");

  // And the write path passes it through rather than coercing it.
  assert.match(SYNC, /name: data\.name \?\? null,/, "a blanked name is coerced to an empty string again on create");
  assert.match(SYNC, /name: data\.name \?\? existing\.name,/, "an update uses `||`, so a name the sheet blanked is confused with one it did not carry");
});

test("a phone the importer cannot read is blanked, and what that costs is known", () => {
  /*
   * The dedup key is the phone, and it is blanked before the row is matched - deliberately: a phone
   * that could not be read is not a phone to find an existing lead by.
   *
   * What it costs, stated rather than left implicit: a row whose phone is malformed is matched on
   * its source id or sheet position first, so a re-sync of the same sheet row still finds itself. A
   * *first* sync against a lead somebody typed in by hand - which carries no source id or position -
   * and which shares only that malformed phone, will now be classified NEW and imported beside it.
   * Previously the row was refused outright, which lost the lead instead. Neither is ideal; this is
   * the one the studio asked for, and the phone regex is lenient enough that it should be rare.
   */
  const { validateCandidateRecord, clearUnreadableFields } = require("../src/modules/hrm/interview/sheetImport");
  const record = { candidate: { name: "Asha", phone: "call the office" } };
  const cleared = clearUnreadableFields(record, validateCandidateRecord(record).issues);
  assert.ok(cleared.some((c) => c.field === "phone"), "an unreadable phone is no longer blanked");
  assert.equal(record.candidate.phone, null);
  assert.equal(record.candidate.name, "Asha", "the rest of the row is kept, which is the point");

  // A phone that is merely formatted oddly is still readable, and still dedupes.
  const fine = { candidate: { name: "Asha", phone: "+91 98487 44752" } };
  assert.deepEqual(clearUnreadableFields(fine, validateCandidateRecord(fine).issues), []);
  assert.equal(fine.candidate.phone, "+91 98487 44752");
});
