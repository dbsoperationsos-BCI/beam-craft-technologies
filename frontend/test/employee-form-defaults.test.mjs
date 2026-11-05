import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { defaultNextReviewDate } from "../src/lib/employeeReviewSchedule.mjs";

/*
 * Two answers the review form gets wrong when nobody types in it.
 *
 * Review Employee reads a submission the candidate has already filled in, so most of its fields
 * arrive with values and are never touched. Both faults here were the form only doing its work in an
 * `onChange` - correct while HR typed every answer, wrong the moment the answers started arriving
 * from the onboarding form.
 *
 * Read from the source, the way employee-pickers-active-only.test.mjs reads the same panel: what is
 * being pinned is which values the form starts with, and there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = read("components", "employees", "EmployeeFormPanel.js");

/** The panel with its prose stripped: these rules are discussed at length in the comments. */
const code = PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** One field's tuple in a section definition, as written. */
const field = (name) => {
  const match = new RegExp(`\\["${name}",[^\\]]*\\]`).exec(code);
  assert.ok(match, `the form no longer defines a "${name}" field`);
  return match[0];
};

/* ------------------------------------------------------- the review date fills itself on load */

test("a record that arrives with a joining date arrives with a review date", () => {
  /*
   * The rule existed in two places and neither ran on the way in: `update` moves the date when the
   * joining date is *edited*, and `withReviewSchedule` falls back to it when the last review row is
   * deleted. So Next Review Date sat empty on a form whose joining date was already filled in, and
   * only appeared once somebody touched that date - which is what the studio saw as "empty when I
   * open it, filled when I change the date".
   */
  assert.match(
    code,
    /nextReviewDate: form\.nextReviewDate \|\| defaultNextReviewDate\(form\.dateOfJoining\)/,
    "the form no longer derives a missing Next Review Date when it loads a record",
  );
});

test("all three places the six-month rule is applied are still there", () => {
  // One rule, three moments: loading a record, editing the joining date, and deleting the last
  // review. A fourth answer, or one of these going missing, is two rules that can disagree.
  assert.match(code, /defaultNextReviewDate\(form\.dateOfJoining\)/, "not applied on load");
  assert.match(code, /nextReviewDate: syncedNextReviewDate\(/, "not applied when the joining date is edited");
  // With no cyclic review left, a stored date stands and six months from joining fills a blank one.
  assert.match(code, /: \(current\.nextReviewDate \|\| defaultNextReviewDate\(current\.dateOfJoining\)\)/, "not applied when the last review is deleted");
});

test("a stored review date outranks the default, so nothing HR chose is overwritten", () => {
  /*
   * `form.nextReviewDate || …` and not the other way round. A stored date is either HR's own answer
   * or the latest review's, and both are decisions - the default is only for the gap where there is
   * no answer at all. This is the same precedence `syncedNextReviewDate` applies when the joining
   * date moves, stated for load.
   */
  assert.match(code, /nextReviewDate: form\.nextReviewDate \|\|/);
  assert.doesNotMatch(code, /nextReviewDate: defaultNextReviewDate\(form\.dateOfJoining\)/, "the default is overwriting a stored answer");
});

test("the six months is the shared rule, not a second copy of the arithmetic", () => {
  // Pinned against the library the other two call sites use, so the form cannot grow its own idea
  // of when a review falls due.
  assert.equal(defaultNextReviewDate("2026-10-01"), "2027-04-01");
  assert.equal(defaultNextReviewDate(""), "", "no joining date means no derived review date");
});

/* --------------------------------------------------------------------- Referred By is optional */

test("Referred By is not a required field", () => {
  /*
   * It began optional, was made required, and is optional again at the studio's asking: most hires
   * are not referred, so a required field meant answering it with somebody who had not referred
   * them. The tuple is [key, label, type, required, …], so the fourth entry is the flag.
   */
  assert.match(field("referredByEmployeeId"), /"employeeRef",\s*false\s*[,\]]/, "Referred By is required again");
});

test("the fields the studio must answer are still required", () => {
  // The change is one field, not the section: Designation, Department, Vertical and Reports To are
  // still answers Review Employee has to have before a record can be saved.
  for (const name of ["designation", "department", "vertical", "reportsToEmployeeId", "dateOfJoining"]) {
    assert.match(field(name), /,\s*true\s*[,\]]/, `"${name}" stopped being required`);
  }
});

/* ------------------------------- Employment Details is page 2's, and page 2 has to have it */

/*
 * Ten fields — Designation, Department, Reports To, Vertical, the two locations, Joining Salary,
 * Referred By, Date of Joining, Next Review Date — moved from Personal Details to the Login
 * Credentials page. They stayed required, and the split was supposed to be that each page validates
 * its own: Approve & Next stopped refusing over fields it was not showing, and the press that
 * creates the account took them on instead.
 *
 * Only half of that was wired up. `fields` narrows to Employment Details while the credentials page
 * is open, so the marks and the message were right — but nothing on that page's submit read them, so
 * the asterisks were decoration. An account could be created for an employee with no designation,
 * department, vertical or reporting line.
 */

test("creating the account refuses while Employment Details is unanswered", () => {
  const submit = code.slice(code.indexOf("async function handleSubmit"));
  const body = submit.slice(0, submit.indexOf("\n  }"));
  const guard = /if \(hasProblems\) \{[\s\S]*?showFirstProblem\(\);[\s\S]*?return;[\s\S]*?\}/.exec(body);
  assert.ok(guard, "the credentials page creates an account without checking its own required fields");
  // And it says so out loud, in the same line the record page refuses with - the marks under each
  // box say what, the scroll answers where.
  assert.match(guard[0], /credentialForm\.showError\(describeProblems\(validation\.missing, validation\.invalid\)\)/, "the refusal is silent");
  // Ahead of both writes: the record save below it is conditional on `recordDirty`, so a check
  // living in there would be skipped by the ordinary case of nobody touching the fields at all.
  assert.ok(
    body.indexOf("hasProblems") < body.indexOf("recordDirty"),
    "the check runs after the record save, so leaving every field untouched walks straight past it",
  );
  assert.ok(
    body.indexOf("hasProblems") < body.indexOf("credentialForm.submit"),
    "the account is created before the required fields are checked",
  );
});

test("the credentials page validates Employment Details and the record pages validate theirs", () => {
  // The split the refusal depends on: on page two `validation.missing` is Employment Details, so
  // the check added above asks for those ten and not for the whole record.
  assert.match(
    code,
    /twoPage && page === "credentials"\s+\? employmentSection\.fields\s+(?:\/\/[^\n]*\n\s+)?: \[\.\.\.new Map\(\[\.\.\.sections\.flatMap\(\(section\) => section\.fields\),/,
    "each page no longer validates its own fields",
  );
  // And Employment Details is on page two only — it is not in `sections`, which is what page one
  // renders, so moving it was a move rather than a copy.
  assert.match(code, /const allSections = \[\.\.\.sections, employmentSection\]/, "Employment Details is back among the first page's sections");
});

test("a refusal can reach a field on the other page", () => {
  /*
   * `showFirstProblem` set the section and scrolled directly, which cannot cross pages: asked for a
   * section on the other one it scrolled to a heading that was not rendered and did nothing at all.
   * That is reachable now the credentials page refuses — `validation.invalid` is the whole form, so
   * a malformed IFSC is refused from a page that does not show Bank Details.
   */
  const fn = code.slice(code.indexOf("function showFirstProblem"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /goToSection\(sectionId\)/, "showFirstProblem cannot move between pages");
  assert.doesNotMatch(body, /scrollToSection\(sectionId\)/, "showFirstProblem is still scrolling without changing page");
  // `goToSection` is what knows which page a section is on.
  assert.match(code, /function goToSection\(id\) \{\s*const target = pageForSection\(id\);/);
});

test("Save Draft still keeps unfinished work", () => {
  // The refusal is on the press that creates the account, not on the one that puts the page aside:
  // a draft is deliberately incomplete, and both draft buttons are plain `type="button"` handlers
  // that never reach `handleSubmit`.
  assert.match(code, /onClick=\{\(\) => void credentialForm\.saveDraft\(\)\}/);
  assert.match(code, /onClick=\{\(\) => void saveDraftAndClose\(\)\}/);
});

test("the credentials page can show the panel's own refusal", () => {
  /*
   * The record page's refusal message goes out through the caller — `onSave(null, error)` — and the
   * credentials press has no caller in that path, so without this the refusal could only mark fields
   * and scroll. `useCredentialForm` hands `showError` back for it, and the page already draws that
   * notice in exactly the state the button is pressable in: ready, not loading, no result yet.
   */
  const HOOK = read("components", "employees", "useCredentialForm.js");
  assert.match(HOOK, /const \{ notice, showNotice, showError, clearNotice \} = useNotice\(\);/);
  assert.match(HOOK, /return \{[^}]*\bshowError\b[^}]*\};/, "the hook no longer hands back showError");
  assert.match(code, /<FloatingNotice notice=\{credentialForm\.notice\} onClose=\{credentialForm\.clearNotice\} \/>/);
});

/*
 * ── Closing the panel asks before it throws work away ────────────────────────────────────────
 *
 * The prompt began on Review Employee Details alone, was extended to Edit after somebody lost three
 * salary reviews to the ×, and left Add Employee out on the reasoning that its first page "is not a
 * review of anything". True, and beside the point: it is the longest form in the application, and a
 * × pressed halfway through threw away everything typed without a word. Being new is the case where
 * the *most* is lost, because nothing has ever been saved.
 */
test("every mode that can hold unsaved work asks before closing", () => {
  assert.match(
    PANEL,
    /const recordDirty = \["review", "edit", "add"\]\.includes\(mode\) && hasFormChanged\(form, originalForm\);/,
    "a mode that can hold typed work closes without asking again",
  );
});

test("Add Employee's prompt does not promise a draft it cannot keep", () => {
  /*
   * An employee that does not exist cannot be half-written to the register, so the save is the same
   * one Add Employee's own footer makes and is held to the same required fields. Saying "kept as a
   * draft" and then asking for eight more fields would read as a button that does not work - so the
   * wording says what actually happens, and the button says Save rather than Save draft.
   */
  assert.match(PANEL, /Saving adds them to the register; anything still required will be named rather than saved\./);
  assert.match(PANEL, /\(mode === "add" && !credentialsDirty\) \? "Save" : "Save draft"/);
});
