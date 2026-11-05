import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Which fields a lead cannot be saved without.
 *
 * The rule decides two things that must never disagree: the asterisk beside a field and the refusal
 * to save. Both read `requiredLeadFields`, so this exercises that function itself rather than the
 * markup around it - the lead popup and Add Lead each ask it the same question.
 *
 * `CRMPage.js` is a React module and this suite has no renderer, so the declarations the rule is
 * made of are lifted out of the source and evaluated on their own. They depend on nothing else in
 * the file, which is what makes that honest: what runs here is the code that ships, not a copy of it
 * written into the test.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

/** One top-level declaration, from its opening line to the line that closes it. */
function declaration(opening, closing) {
  const start = PAGE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found in CRMPage.js`);
  const end = PAGE.indexOf(closing, start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return PAGE.slice(start, end + closing.length);
}

const source = [
  // `requiredLeadFields` reads the status through `normalizeLeadStatus`, so that comes along with
  // the four status labels it names - all plain strings, so lifting them changes nothing.
  declaration('const CONVERTED_AND_FOLLOWUP_STATUS =', ';'),
  declaration('const YET_TO_CONNECT_STATUS =', ';'),
  declaration('const INACTIVE_STATUS =', ';'),
  declaration('const UNASSIGNED_STATUS =', ';'),
  declaration('function normalizeLeadStatus(', '\n}'),
  declaration('const STATUSES_WITHOUT_FOLLOW_UP = [', '];'),
  declaration('const REQUIRED_LEAD_FIELDS = [', '\n];'),
  declaration('const POPUP_REQUIRED_FIELDS = {', '\n};'),
  declaration('const REJECTED_LEAD_FIELDS =', ';'),
  declaration('const UNKNOWN_CALLER_NAME =', ';'),
  declaration('const UNKNOWN_CALLER_UNASKED_FIELDS = [', '];'),
  declaration('const UNANSWERED_LEAD_STATUSES = [', '];'),
  declaration('const isUnknownCallerName =', ';'),
  declaration('function requiredLeadFields(', '\n}'),
  declaration('function isRequiredLeadField(', '\n}'),
  declaration('function missingRequiredLeadFields(', '\n}'),
].join("\n\n");

const { requiredLeadFields, isRequiredLeadField, missingRequiredLeadFields } = new Function(
  `${source}\nreturn { requiredLeadFields, isRequiredLeadField, missingRequiredLeadFields };`,
)();

const keys = (...args) => requiredLeadFields(...args).map((field) => field.key);

test("a lead is asked for the same four, whatever vertical it is on", () => {
  assert.deepEqual(keys("Interested", "Anitha"), ["name", "phone", "assignedBranch", "estimatedValue"]);
});

/*
 * ── Date of Birth (or) EDOD: where it is demanded is the whole of the rule ────────────────────
 *
 * Not on the way in. A lead very often arrives before the date does - the call ended before anybody
 * asked, the mother has no scan date yet - and refusing the save buys an invented date, which the
 * Newborns and Birthdays tabs would then schedule shoots off.
 *
 * Demanded in the lead popup, on Qua Qua. By the time somebody opens a lead to work it, that date is
 * what the vertical plans from, and a worked lead still missing it is the one nobody can schedule.
 */
test("Add Lead and Bulk Entry never ask for the date", () => {
  for (const status of ["Interested", "CNA", "Converted"]) {
    for (const name of ["Anitha", "CNA", ""]) {
      assert.equal(isRequiredLeadField("dateOfBirthOrEdod", status, name), false, `${status} / ${name}`);
    }
  }
});

test("the lead popup asks for it, and only on Qua Qua", () => {
  assert.equal(isRequiredLeadField("dateOfBirthOrEdod", "Interested", "Anitha", { vertical: "Qua Qua", popup: true }), true);
  assert.deepEqual(
    keys("Interested", "Anitha", { vertical: "Qua Qua", popup: true }),
    ["name", "phone", "assignedBranch", "estimatedValue", "dateOfBirthOrEdod"],
  );
  // The other two verticals do not show the field at all, so they cannot be asked for it.
  for (const vertical of ["Dum Dum", "Corp", "", "Calls"]) {
    assert.equal(isRequiredLeadField("dateOfBirthOrEdod", "Interested", "Anitha", { vertical, popup: true }), false, vertical);
  }
});

test("a lead named CNA is excused the date, exactly as it is excused the value", () => {
  /*
   * The flow the studio asked for: nobody answered the phone, so the baby's date is no more
   * knowable than what the job is worth. Both fall away together, and everything that makes the
   * call findable stays.
   */
  assert.deepEqual(keys("Interested", "CNA", { vertical: "Qua Qua", popup: true }), ["name", "phone", "assignedBranch"]);
  assert.equal(isRequiredLeadField("dateOfBirthOrEdod", "Interested", "CNA", { vertical: "Qua Qua", popup: true }), false);
  assert.equal(isRequiredLeadField("estimatedValue", "Interested", "CNA", { vertical: "Qua Qua", popup: true }), false);
});

test("a Qua Qua lead being turned down is asked for neither", () => {
  // Invalid and Rejected drop everything but the name and number, on the popup as anywhere else.
  for (const status of ["Invalid", "Rejected"]) {
    assert.deepEqual(keys(status, "Anitha", { vertical: "Qua Qua", popup: true }), ["name", "phone"], status);
  }
});

/*
 * `CNA` typed into Enquire Name is a caller nobody has reached: the phone rang, the call did not
 * connect, and who they are is the one thing not known. What the studio reckons the job is worth
 * cannot be answered from a call that never connected, so demanding it is asking for an invented
 * number - or for the call to go unrecorded.
 */
test("a lead named CNA is not asked what the job is worth", () => {
  assert.deepEqual(keys("Interested", "CNA"), ["name", "phone", "assignedBranch"]);
  // Everything that makes the call findable is still required - the number is the whole point of it.
  assert.equal(isRequiredLeadField("phone", "Interested", "CNA"), true);
  assert.equal(isRequiredLeadField("assignedBranch", "Interested", "CNA"), true);
  assert.equal(isRequiredLeadField("estimatedValue", "Interested", "CNA"), false);
});

test("it is the name as typed, however it is typed", () => {
  for (const typed of ["CNA", "cna", " Cna ", "cNa"]) {
    assert.deepEqual(keys("Interested", typed), ["name", "phone", "assignedBranch"], typed);
  }
});

test("any other name leaves the field exactly as required as it was", () => {
  /*
   * The condition is `CNA` and nothing near it. A name that merely contains those letters is a
   * person - Cnaan, or a client whose note happens to mention a missed call - and a rule that
   * matched loosely would quietly stop asking for a real lead's value.
   */
  for (const typed of ["", "Anitha", "CNA Traders", "Mr CNA", "cna kumar", "C N A"]) {
    assert.deepEqual(
      keys("Interested", typed),
      ["name", "phone", "assignedBranch", "estimatedValue"],
      typed,
    );
  }
});

/*
 * The CNA *status* used to be read as a different thing and deliberately ignored here - an attempt
 * that went unanswered against a lead whose client is known, so the argument ran that those leads
 * have a value and the form should go on asking for it. It no longer does: a call that did not
 * connect cannot tell anybody what the job is worth, and on Qua Qua it cannot tell them when the
 * baby is due either. The status now excuses the same two fields the name does - and only those
 * two, so the client and the branch a CNA lead does have are still asked for.
 */
test("the CNA status excuses the same two fields the CNA name does", () => {
  assert.deepEqual(keys("CNA", "Anitha"), ["name", "phone", "assignedBranch"]);
});

test("a lead being turned down is still asked for who the person is, and nothing else", () => {
  // Unchanged by any of the above: Invalid and Rejected drop everything but the name and number,
  // whatever the name says.
  for (const status of ["Invalid", "Rejected"]) {
    assert.deepEqual(keys(status, "Anitha"), ["name", "phone"], status);
    assert.deepEqual(keys(status, "CNA"), ["name", "phone"], status);
  }
});

test("the save refuses on exactly what the asterisks ask for", () => {
  const form = { vertical: "Qua Qua", leadStatus: "Interested", name: "CNA", phone: "9876543210", assignedBranch: "Erode TN" };
  assert.deepEqual(missingRequiredLeadFields(form), [], "a CNA call with a number and a branch is saveable");
  // The same form under a real name is refused until the value is answered - and says which field.
  assert.deepEqual(
    missingRequiredLeadFields({ ...form, name: "Anitha" }).map((field) => field.key),
    ["estimatedValue"],
    "Add Lead asks for the value and never the date",
  );
  // The popup asks for both, and the CNA name still excuses both.
  assert.deepEqual(
    missingRequiredLeadFields({ ...form, name: "Anitha" }, { vertical: "Qua Qua", popup: true }).map((field) => field.key),
    ["estimatedValue", "dateOfBirthOrEdod"],
  );
  assert.deepEqual(missingRequiredLeadFields(form, { vertical: "Qua Qua", popup: true }), []);
});

/*
 * ── An unanswered call excuses the two questions it could not have answered ───────────────────
 *
 * `CNA` as a *status* is a call to this lead that went unanswered. It used to be read as a
 * different case from the CNA *name* - the client is known, so the argument ran, the value and the
 * date should still be asked for - and the Qua Qua popup went on demanding both. That is right
 * about the client and wrong about the questions: what the job is worth, and when the baby is due,
 * are things somebody finds out by getting through. Insisting buys an invented date, which the
 * Newborns and Birthdays tabs then schedule a shoot from.
 */
test("a CNA status excuses Estimated Value and the date, on a lead with a real name", () => {
  // The name is a real client's - this is the status doing the work, which is the whole change.
  assert.deepEqual(keys("CNA", "Priya", { vertical: "Qua Qua", popup: true }), ["name", "phone", "assignedBranch"]);
  assert.equal(isRequiredLeadField("estimatedValue", "CNA", "Priya", { vertical: "Qua Qua", popup: true }), false);
  assert.equal(isRequiredLeadField("dateOfBirthOrEdod", "CNA", "Priya", { vertical: "Qua Qua", popup: true }), false);
});

test("it excuses those two and nothing else - a CNA lead still has a client and a branch", () => {
  /*
   * Unlike `Invalid` and `Rejected`, which end the conversation and keep only who the person is.
   * A call that went unanswered is still a live lead on a branch, so the three that make it
   * findable are still demanded.
   */
  const asked = keys("CNA", "Priya", { vertical: "Qua Qua", popup: true });
  for (const key of ["name", "phone", "assignedBranch"]) assert.ok(asked.includes(key), `${key} is still required`);
  assert.deepEqual(keys("Rejected", "Priya", { vertical: "Qua Qua", popup: true }), ["name", "phone"]);
});

test("the older spellings of the status are excused too", () => {
  /*
   * The pills write `CNA` exactly, so a click was always going to match - but a lead's stored
   * status is regularly what a sheet wrote, and `in review` is normalised to CNA everywhere else
   * on this screen. Comparing the raw column would refuse a lead whose panel says CNA.
   */
  for (const status of ["CNA", "cna", "In Review", "in review", " CNA "]) {
    assert.equal(isRequiredLeadField("dateOfBirthOrEdod", status, "Priya", { vertical: "Qua Qua", popup: true }), false, status);
  }
  // And the same tolerance now applies to the two that end the conversation.
  for (const status of ["rejected", "INVALID"]) {
    assert.deepEqual(keys(status, "Priya", { vertical: "Qua Qua", popup: true }), ["name", "phone"], status);
  }
});

test("a status that is not one of the three still demands both", () => {
  // The change must not quietly stop asking a worked lead for what its board is built on.
  for (const status of ["Followup", "Interested", "Converted", "Converted & Followup", ""]) {
    const asked = keys(status, "Priya", { vertical: "Qua Qua", popup: true });
    assert.ok(asked.includes("estimatedValue"), `${status || "(blank)"} still asks Estimated Value`);
    assert.ok(asked.includes("dateOfBirthOrEdod"), `${status || "(blank)"} still asks the date`);
  }
});

test("a CNA status leaves Add Lead and Bulk Entry as they were, bar Estimated Value", () => {
  // The date is never asked outside the popup, so there is nothing there for this to excuse; the
  // value is, and an unanswered call cannot answer it on the way in either.
  assert.deepEqual(keys("CNA", "Priya"), ["name", "phone", "assignedBranch"]);
  assert.deepEqual(keys("Interested", "Priya"), ["name", "phone", "assignedBranch", "estimatedValue"]);
});

test("the save refusal agrees with the asterisks", () => {
  // Both read `requiredLeadFields`, so a lead saved on CNA with neither answer is not refused.
  const lead = { name: "Priya", phone: "9876543210", assignedBranch: "Erode", leadStatus: "CNA", estimatedValue: "", dateOfBirthOrEdod: "" };
  assert.deepEqual(missingRequiredLeadFields(lead, { vertical: "Qua Qua", popup: true }), []);
  // The same lead on Followup is refused for exactly the two.
  const worked = { ...lead, leadStatus: "Followup" };
  assert.deepEqual(
    missingRequiredLeadFields(worked, { vertical: "Qua Qua", popup: true }).map((field) => field.key),
    ["estimatedValue", "dateOfBirthOrEdod"],
  );
});
