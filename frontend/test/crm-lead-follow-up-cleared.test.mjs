import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A lead being turned down carries no next call.
 *
 * Invalid and Rejected end the conversation, so neither a Next Follow-up Date nor a Time applies -
 * and the popup had gone on asking for both long after Add Lead and Bulk Update had stopped. The
 * fields being on screen was the visible half; the half that actually cost something is that a lead
 * already carrying a date kept it when it was rejected, so it turned up in somebody's Pending
 * Followups the next morning under a status saying the conversation was over.
 *
 * `CRMPage.js` is a React module and this suite has no renderer, so the declarations the rule is
 * made of are lifted out of the source and evaluated on their own. They depend on nothing else in
 * the file, which is what makes that honest: what runs here is the code that ships.
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
  declaration('const STATUSES_WITHOUT_FOLLOW_UP = [', '];'),
  declaration('function isOccasionLead(', '\n}'),
  declaration('function occasionEcho(', '\n}'),
  declaration('function followUpClearedBy(', '\n}'),
].join("\n\n");

const { followUpClearedBy } = new Function(`${source}\nreturn { followUpClearedBy };`)();

const ordinary = { name: "Anitha" };
// An occasion lead's follow-up is read off the occasion rather than off the lead, so it carries a
// second copy of both fields - which is the copy the Newborns and Birthdays tabs actually count.
const occasion = { name: "Anitha", occasionWindow: "newborn" };

test("Invalid and Rejected drop the next call the lead was carrying", () => {
  for (const status of ["Invalid", "Rejected"]) {
    assert.deepEqual(
      followUpClearedBy(ordinary, "leadStatus", status),
      { nextFollowUpDate: "", nextFollowUpTime: "" },
      status,
    );
  }
});

test("an occasion lead's own copies go too, or the tabs would still count it", () => {
  assert.deepEqual(followUpClearedBy(occasion, "leadStatus", "Rejected"), {
    nextFollowUpDate: "",
    nextFollowUpTime: "",
    occasionNextFollowUpDate: "",
    occasionNextFollowUpTime: "",
  });
});

test("every other status leaves the follow-up exactly where it was", () => {
  for (const status of ["Interested", "Followup", "CNA", "Converted", "Converted & Followup", ""]) {
    assert.deepEqual(followUpClearedBy(occasion, "leadStatus", status), {}, status || "an empty status");
  }
});

test("it is the status that clears them, not any other edit", () => {
  // Every field on the popup goes through the same draft function, so a rule keyed on the value
  // rather than on the field would wipe a follow-up when somebody typed "Rejected" into a remark.
  for (const key of ["name", "remarks", "assignedBranch", "nextFollowUpDate"]) {
    assert.deepEqual(followUpClearedBy(occasion, key, "Rejected"), {}, key);
  }
});

test("the status is matched as typed, and never loosely", () => {
  // Trimmed, because a status arriving with whitespace is still that status...
  assert.deepEqual(followUpClearedBy(ordinary, "leadStatus", " Rejected "), { nextFollowUpDate: "", nextFollowUpTime: "" });
  // ...but a status that merely contains the word is a different status and keeps its date.
  for (const near of ["Rejected by client", "Not Rejected", "rejected"]) {
    assert.deepEqual(followUpClearedBy(ordinary, "leadStatus", near), {}, near);
  }
  // Nothing at all is not a rejection either - it is Yet to connect, which is still to be worked.
  for (const empty of [null, undefined]) {
    assert.deepEqual(followUpClearedBy(ordinary, "leadStatus", empty), {}, String(empty));
  }
});

/*
 * The two halves have to agree: the fields are taken off the popup by the same list that clears
 * them. A rule applied in one place and not the other is how this bug existed - Add Lead hid and
 * cleared, the popup did neither.
 */
test("the popup hides the two fields on the same list that clears them", () => {
  assert.match(
    PAGE,
    /\{STATUSES_WITHOUT_FOLLOW_UP\.includes\(String\(displayLead\.leadStatus \|\| ""\)\.trim\(\)\) \? \(/,
    "the lead popup is asking a rejected lead for a follow-up date again",
  );
  // And both draft paths clear it - the popup's, and the info panel's beside the table.
  assert.equal(
    PAGE.match(/\.\.\.followUpClearedBy\(/g)?.length,
    2,
    "both of the popup's draft handlers must clear the follow-up",
  );
});
