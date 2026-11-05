import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * "Already on the register", said while the number is being typed.
 *
 * One person is one candidate, and the server refuses a second - but a refusal that arrives after
 * somebody has filled in a whole application is a refusal that arrives too late. So both forms that
 * take a number ask the register as it is typed, and say so **under the field**: Add Application,
 * and the candidate record's own form when a number is edited.
 *
 * The CRM's Add Lead settled the shape of this - when to ask, what to compare the answer against,
 * and what colour it is - and these mirror it deliberately rather than inventing a second one.
 *
 * Bulk Entry is not here on purpose: it marks its rows when the register refuses the batch, which
 * is what the CRM's own Bulk Entry does, and `interview-bulk-duplicates` covers it.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const ADD = src("components", "hrm", "InterviewAddApplicationDialog.js");
const PANEL = src("components", "hrm", "InterviewCandidateFormPanel.js");
const SERVICE = src("services", "hrm", "interview.service.js");
const PHONE_FIELD = src("components", "shared", "PhoneField.js");
const TEXT_FIELD = src("components", "shared", "TextField.js");
const SCHEMA_FIELD = src("components", "schema-form", "SchemaFormFields.js");

const FORMS = [["Add Application", ADD], ["the candidate record", PANEL]];

test("both forms ask only once the number is whole", () => {
  // Otherwise the warning appears against the first four digits of a number - and the register is
  // asked once per keystroke on the way to typing one.
  for (const [what, source] of FORMS) {
    assert.match(source, /const askPhone = isCompletePhoneNumber\(phone\) \? phone : "";/, what);
    assert.match(source, /window\.setTimeout\(/, what);
  }
});

test("an answer is held with the value it was asked about", () => {
  /*
   * A reply that lands after the field has been edited describes a number nobody is looking at any
   * more. Comparing it against the field as it stands is also what makes a stale answer worth
   * nothing without having to be cleared - and clearing state from an effect body would be a
   * cascading render for a fact already known.
   */
  for (const [what, source] of FORMS) {
    assert.match(source, /setClash\(found\.length \? \{ phone: askPhone, email: askEmail, candidates: found \} : null\);/, what);
    assert.match(source, /clash\.phone !== phone \|\| clash\.email !== email/, what);
  }
});

test("a check that will not answer is not a clash", () => {
  // The forms stay usable and the save is never held up by a network having a moment. The server
  // refuses a real duplicate regardless, which is what makes this safe to swallow.
  for (const [what, source] of FORMS) assert.match(source, /\.catch\(\(\) => \{\}\);/, what);
});

test("the warning is put under the field that raised it", () => {
  // A clash found on the address belongs under Email, not under the contact number.
  for (const [what, source] of FORMS) {
    assert.match(source, /const matchedBy = key === "phone" \? "phone number" : "email";/, what);
  }
  assert.match(ADD, /note=\{clashNote\("phone"\)\}/);
  assert.match(ADD, /note=\{clashNote\("email"\)\}/);
  // The record's own form is a schema form, so its notes travel as a map beside the errors.
  assert.match(PANEL, /notes=\{clashNotes\}/);
  assert.match(SCHEMA_FIELD, /const note = notes\?\.\[name\] \|\| "";/);
});

test("the warning names the candidate it clashes with", () => {
  // "Already on the register" alone leaves somebody searching thousands of rows for a record they
  // cannot see. The code and the name are what makes it answerable.
  for (const [what, source] of FORMS) {
    assert.match(source, /Already on the register: \$\{found\.map\(\(entry\) => \[entry\.candidateCode, entry\.name\]/, what);
  }
});

test("a record being edited does not find itself", () => {
  assert.match(PANEL, /excludeId: candidate\?\.id \|\| ""/);
  assert.match(SERVICE, /if \(excludeId\) query\.set\("excludeId", String\(excludeId\)\);/);
});

test("nothing to match on is not a question worth asking", () => {
  // Answered here rather than asked of the server: an empty query would otherwise be a request
  // per keystroke for a form nobody has typed a number into yet.
  assert.match(SERVICE, /if \(!query\.toString\(\)\) return Promise\.resolve\(/);
});

test("a note is amber and never shares the slot with an error", () => {
  /*
   * A number the register already holds is worth stopping for and is not an error - the form is
   * perfectly valid and the person filling it in may still have reason to go on. But a field that
   * is genuinely wrong is told so first: a remark about a value that has not been accepted yet is
   * a remark about nothing.
   */
  assert.match(PHONE_FIELD, /\{!error && note && <span className="mt-1 block text-\[11px\] font-normal text-amber-700">\{note\}<\/span>\}/);
  assert.match(TEXT_FIELD, /\{!error && note && <p className="mt-1\.5 font-normal text-amber-700">\{note\}<\/p>\}/);
  // Destructured, or it would reach the `<input>` as an attribute the browser does not know.
  assert.match(TEXT_FIELD, /error = "", note = "",/);
});
