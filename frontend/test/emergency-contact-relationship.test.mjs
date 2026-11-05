import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { employeeOptionResources, emergencyContactRelationshipOptions } from "../src/constants/employeeOptions.js";

/*
 * Who the emergency contact is to the employee.
 *
 * It was a free text box on both screens that ask for it, which is the wrong shape for this field:
 * somebody rings that number on the worst day of an employee's career, and "how do you know them"
 * has to be readable at a glance rather than deciphered from `Bro`, `frnd` or `dad's`.
 *
 * It is a **combo box**, not a closed dropdown: the list covers the answers people actually give, so
 * they are spelled consistently, and anything nobody thought of can still be typed. A closed list
 * would refuse a real relationship for the sake of tidiness on the one field where being able to
 * record the truth matters most.
 *
 * Two things have to hold and neither announces itself: the two screens must offer the *same* list,
 * or the record disagrees with the form it came from; and both must let a value be typed, or the
 * candidate can answer something HR then cannot.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = read("components", "employees", "EmployeeFormPanel.js");
const ONBOARDING = read("constants", "onboardingFormConfig.js");
const SCHEMA_FIELD = read("components", "schema-form", "SchemaFormFields.js");

test("the list is wide enough that Other is the escape rather than the common case", () => {
  /*
   * An emergency contact is often not immediate family - a colleague sharing a flat, a guardian, a
   * neighbour - and a list of parents and siblings alone would push those people onto "Other",
   * which answers nothing at all on the day somebody has to ring.
   */
  for (const relationship of ["Father", "Mother", "Husband", "Wife", "Brother", "Sister", "Guardian", "Friend", "Colleague", "Neighbour"]) {
    assert.ok(emergencyContactRelationshipOptions.includes(relationship), `the list no longer offers "${relationship}"`);
  }
  assert.equal(emergencyContactRelationshipOptions.at(-1), "Other", "Other is not the last resort on the list");
  // No duplicates: `Dropdown` keys its options by value and a repeat quietly loses one of them.
  assert.equal(new Set(emergencyContactRelationshipOptions).size, emergencyContactRelationshipOptions.length);
});

test("both screens offer the same list, and both let it be typed past", () => {
  /*
   * A candidate answers this on the apply page and HR later edits it on the record. Two lists that
   * drift apart mean HR opening a record and finding the answer it was given is not one it can
   * choose - which is how a field ends up being retyped, and why `employeeOptions.js` exists. A
   * closed picker on one side and a combo box on the other is the same fault in a different form.
   */
  assert.match(PANEL, /\["emergencyContactRelationship", "Emergency Contact Relationship", "combobox", true, emergencyContactRelationshipOptions\]/, "HR's form no longer lets this be typed");
  /*
   * The onboarding form names the list rather than importing it: a candidate has no session to
   * read the studio's master data with, so the invite carries it and the field resolves it from
   * `context.options`. What matters here is unchanged - it is still a combo box, so an answer
   * nobody listed can still be typed.
   */
  assert.match(ONBOARDING, /name: "emergencyContactRelationship"[^}]*type: "combobox"[^}]*options: "emergencyContactRelationships"/, "the onboarding form no longer lets this be typed");
  /*
   * Neither writes a list of its own out, which is the property that matters: the two screens ask
   * the same question of the same person and must offer the same answers.
   *
   * They reach it differently now, and have to. HR's form reads the studio's list straight from the
   * master data (`employeeOptionResources`), falling back to this file's array; the candidate's page
   * has no session for that, so the invite carries the list and the field names it. What neither
   * does is hold its own copy.
   */
  assert.match(PANEL, /emergencyContactRelationshipOptions[^;]*\} from "@\/constants\/employeeOptions"/);
  assert.ok(
    employeeOptionResources.some((option) => option.resource === "emergency-contact-relationships"
      && option.fields.includes("emergencyContactRelationship")),
    "the relationship list is no longer one the studio maintains, so the two screens can drift again",
  );
  assert.ok(
    !/emergencyContactRelationshipOptions/.test(ONBOARDING),
    "the onboarding config holds its own copy of the list again instead of taking the studio's",
  );
});

test("both renderers draw a combobox through the application's own control", () => {
  /*
   * `ComboBoxField` is the app's pick-or-type field - the same one the CRM's Add Lead uses for
   * Relationship and Referred From - so this field behaves like the ones people already know rather
   * than like a new invention. A `select` with a stray text input beside it would be two controls
   * answering one question.
   */
  assert.match(PANEL, /if \(type === "combobox"\) return <SharedComboBoxField/);
  assert.match(SCHEMA_FIELD, /if \(type === "combobox"\) return <ComboBoxField/);
  // The list is a suggestion, so the placeholder says so rather than instructing a choice.
  assert.match(SCHEMA_FIELD, /placeholder \|\| "Select or type"/);
});

test("a closed select still keeps an answer that predates its list", () => {
  /*
   * Not this field any more - a combo box shows whatever it holds - but the fix is worth keeping and
   * worth pinning, because it is what every *other* `select` on these two forms relies on.
   *
   * `Dropdown` shows its placeholder for a value it cannot find among its options, so a record
   * answered before that field had a list - or before an option was retired from one - reads
   * "Select" while still holding and re-submitting the old answer. The Employee Repository's own
   * form already added the stored value to the list; the shared schema-form select did not, and that
   * is the one the candidate's onboarding page draws through.
   */
  assert.match(PANEL, /const selectOptions = safeOptions\.includes\(value\) \|\| !value \? safeOptions : \[\.\.\.safeOptions, value\];/);
  assert.match(SCHEMA_FIELD, /const selectOptions = stored === "" \|\| listed\.some\(\(option\) => option\.value === stored\)/);
  assert.match(SCHEMA_FIELD, /\[\.\.\.listed, \{ value: stored, label: String\(stored\) \}\]/);
});
