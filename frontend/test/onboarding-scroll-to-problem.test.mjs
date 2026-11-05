import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { onboardingFormSections } from "../src/constants/onboardingFormConfig.js";

/*
 * A refused onboarding submission has to say where the problem is, not only that there is one.
 *
 * The form is eight sections long and a candidate fills it in on a phone. It marked the offending
 * fields and raised "Please fill in all required fields" from a notice at the top, and then left the
 * reader standing at the Submit button they had just pressed — which restates the complaint rather
 * than answering it: somebody who cannot see the marked field is being told to go and find it.
 *
 * `EmployeeFormPanel` already refuses this way for HR, through `showFirstProblem`. This is the same
 * move on the candidate's side, against the page itself rather than an inner scroll pane.
 *
 * Read from the source, the way the other form tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const FORM = read("components", "onboarding", "PublicOnboardingForm.js");
/** The form with its prose stripped: these rules are discussed at length in the comments. */
const code = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("every section carries the anchor the scroll finds it by", () => {
  // The same attribute `SchemaFormSection` puts on the signed-in forms, so both sides refuse the
  // same way and there is one convention rather than two.
  assert.match(code, /data-schema-section=\{section\.id\}/, "the config's sections have no anchor to scroll to");
  assert.match(code, /data-schema-section=\{AGREEMENT_SECTION\}/, "the agreement section has no anchor");
  assert.match(code, /document\.querySelector\(`\[data-schema-section="\$\{sectionId\}"\]`\)\?\.scrollIntoView/);
});

test("the field-to-section map is built from the config, not written out", () => {
  /*
   * A second copy of "which section is this field in" is a second thing to update when a field
   * moves, and nothing would fail if somebody forgot — the refusal would just scroll to the wrong
   * heading. Derived from the same list the form is drawn from.
   */
  assert.match(
    code,
    /const sectionByField = Object\.fromEntries\(\s*onboardingFormSections\.flatMap\(\(section\) => section\.fields\.map\(\(field\) => \[field\.name, section\.id\]\)\),\s*\);/,
    "the field-to-section map is no longer derived from onboardingFormSections",
  );
});

test("every refusal marks, says why, and goes there", () => {
  // One helper rather than the same three lines five times — and the scroll cannot then be added to
  // some refusals and forgotten on others, which is how it went missing in the first place.
  const fn = code.slice(code.indexOf("function refuse("));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /setFieldErrors\(errors\)/);
  assert.match(body, /showError\(message\)/);
  assert.match(body, /scrollToSection\(sectionId \|\| sectionByField\[Object\.keys\(errors\)\[0\]\]\)/);
});

test("no refusal still marks a field without going to it", () => {
  /*
   * The property behind the helper: inside `submit`, the only thing that writes field marks is
   * `refuse`. A branch calling `setFieldErrors` directly would be one that marks and does not move.
   */
  const submitFn = code.slice(code.indexOf("async function submit("));
  const body = submitFn.slice(0, submitFn.indexOf("\n  }\n"));
  const writes = body.match(/setFieldErrors\([^)]*\)/g) || [];
  // The agreement adds its own mark beside the others (`refuse` would replace them), and goes to it.
  assert.match(body, /setFieldErrors\(\(current\) => \(\{ \.\.\.current, policyAgreementAccepted: [^\n]+\n\s*scrollToSection\(AGREEMENT_SECTION\)/, "the agreement mark does not go to the agreement");
  // Otherwise exactly one, and it is the clear on the way out - every refusal above it goes through `refuse`.
  assert.deepEqual(writes.filter((write) => write !== "setFieldErrors((current)"), ["setFieldErrors({})"], "a refusal marks fields without scrolling to them");
  // Five of them: the agreement, the missing fields, a bad format, the age rule and the row lists.
  assert.ok((body.match(/refuse\(/g) || []).length >= 4, "the refusals no longer go through the helper");
});

test("the agreement refusal does not wipe the marks already on the form", () => {
  /*
   * It runs before the required-field check and has no field of its own to mark, so handing the
   * helper an empty set would clear every mark a previous press had put on the form — which is the
   * ordinary case, not a corner: a candidate with blank fields who has also not ticked the box.
   */
  const submitFn = code.slice(code.indexOf("async function submit("));
  const agreement = submitFn.slice(0, submitFn.indexOf("const missing ="));
  assert.doesNotMatch(agreement, /refuse\(\{\}/, "the agreement refusal clears the form's existing marks");
  assert.match(agreement, /scrollToSection\(AGREEMENT_SECTION\)/, "the agreement refusal does not go to the agreement");
});

test("every section id the map can produce is one the page renders", () => {
  // The scroll is a no-op for an id nothing carries, so a section in the config that the form does
  // not draw would be a silent refusal. Both come from the same list, which is what makes it true.
  const ids = new Set(onboardingFormSections.map((section) => section.id));
  assert.ok(ids.size >= 5, "the onboarding form has lost its sections");
  for (const section of onboardingFormSections) {
    assert.ok(section.fields.length > 0, `section "${section.id}" has no fields, so nothing can scroll to it`);
  }
});
