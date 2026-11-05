import test from "node:test";
import assert from "node:assert/strict";

import { missingOnboardingFields, onboardingFormSections, requiredOnboardingFields } from "../src/constants/onboardingFormConfig.js";

/*
 * What a candidate must answer before the onboarding form will submit.
 *
 * `requiredOnboardingFields` is derived from the sections, and the form checks a value as missing
 * when it is empty — so a field is required by carrying `required: true` and by nothing else. That
 * makes the list worth asserting directly: a field that quietly stops being required is not visible
 * in any diff of the form, and the first sign of it is a record arriving with a hole in it.
 */

const required = new Set(requiredOnboardingFields.map(([name]) => name));

test("the candidate's photograph is required", () => {
  // The studio puts a face to every record — the repository, the org chart and the top bar all read
  // it — and a photograph is far harder to collect after the fact than during the one sitting where
  // somebody is filling in everything else about themselves.
  assert.ok(required.has("profilePhoto"), "Profile Photo must be required");
});

test("it is asked for the same way as the two identity proofs beside it", () => {
  for (const name of ["aadharCardImage", "panCardImage"]) {
    assert.ok(required.has(name), `${name} must be required`);
  }
});

test("a required field carries the label the refusal names it by", () => {
  // The form lists what is missing by label, so a required field with no label would be reported as
  // an empty string in a sentence asking somebody to go and fill it in.
  for (const [name, label] of requiredOnboardingFields) {
    assert.ok(label && String(label).trim(), `${name} has no label`);
  }
});

test("every required field is one the form actually draws", () => {
  const drawn = new Set(onboardingFormSections.flatMap((section) => section.fields).map((field) => field.name));
  for (const [name] of requiredOnboardingFields) {
    assert.ok(drawn.has(name), `${name} is required but is not on the form`);
  }
});

/*
 * Every field on the form is required, and the three that are not are named here rather than left
 * to be noticed. A field quietly losing its `required: true` looks like nothing in a diff, and the
 * first sign of it is a record arriving with a hole in it - so the exceptions are a list somebody
 * has to come and edit, with the reason each one is on it written beside it.
 */
const OPTIONAL_BY_DESIGN = {
  // Not a question: a tick that copies one address onto the other. Requiring it would make every
  // candidate declare their two addresses the same.
  sameAsCurrentAddress: "the tick that copies the current address onto the permanent one",
  // A fresher has no job to name, and asking for one would make this form the reason they cannot
  // be taken on.
  experiences: "a fresher has no previous employment to list",
  // Plenty of married people have no children, which is why the list opens empty and says so.
  children: "a married candidate may have no children",
  // The studio issues these after somebody joins, not before - most candidates have none yet.
  companyGivenNumber: "most candidates do not have a company-issued number yet",
};

test("every field on the form is required, apart from the three that cannot be", () => {
  const optional = onboardingFormSections
    .flatMap((section) => section.fields)
    .filter((field) => !field.required)
    .map((field) => field.name);
  assert.deepEqual(optional.sort(), Object.keys(OPTIONAL_BY_DESIGN).sort());
});

test("the answers a candidate gives about other people are required too", () => {
  // References and nominees were the two whole sections a candidate could skip, so a record could
  // arrive naming nobody to vouch for them and nobody to pay out to.
  for (const name of [
    "reference1PersonName", "reference1PersonPhone", "reference1PersonAddress",
    "reference2PersonName", "reference2PersonPhone", "reference2PersonAddress",
    "nominee1PersonName", "nominee1PersonPhone", "nominee2PersonName", "nominee2PersonPhone",
  ]) {
    assert.ok(required.has(name), `${name} must be required`);
  }
});

test("the tick-lists and the qualification list are required", () => {
  // Each of these holds an array rather than a value, which the form counts as answered only when
  // it holds something - and, for the qualification list, only rows somebody actually filled in.
  for (const name of ["skills", "languagesKnown", "qualifications"]) {
    assert.ok(required.has(name), `${name} must be required`);
  }
});

/*
 * The rule itself, called the way the form calls it.
 *
 * The browser refuses the empty text boxes on its own - they carry `required` - so a submit never
 * reaches this check until those are filled. The lists are the half nothing native guards: a
 * multi-select and a repeating list are not inputs, so if this rule does not count them nobody
 * does, and a submission goes out with the sections empty.
 */
const answered = Object.fromEntries(requiredOnboardingFields.map(([name]) => [name, "answered"]));
const complete = {
  ...answered,
  maritalStatus: "Single",
  skills: ["Photography"],
  languagesKnown: ["Tamil"],
  qualifications: [{ degree: "B.Sc" }],
  experiences: [],
  children: [],
};

test("a complete form has nothing missing", () => {
  assert.deepEqual(missingOnboardingFields(complete), []);
});

test("an empty tick-list or qualification list is counted as missing", () => {
  for (const [name, label] of [["skills", "Skills"], ["languagesKnown", "Languages Known"], ["qualifications", "Qualification Details"]]) {
    assert.deepEqual(missingOnboardingFields({ ...complete, [name]: [] }), [label]);
  }
});

test("a qualification list holding only a blank row is counted as missing", () => {
  /*
   * The case a browser cannot easily be driven into and the one that matters most: "+ Add
   * Qualification" leaves a row of empty boxes behind, the submit drops those rows on the way out,
   * and counting the rows as they stand would call the list answered and then send an empty one.
   */
  const blankRow = { key: "row-1", degree: "", branch: "", college: "", passedOutYear: "" };
  assert.deepEqual(missingOnboardingFields({ ...complete, qualifications: [blankRow] }), ["Qualification Details"]);
});

test("a fresher and a childless married candidate are not asked for the two optional lists", () => {
  assert.deepEqual(missingOnboardingFields({ ...complete, experiences: [] }), []);
  const married = { ...complete, maritalStatus: "Married", spouseName: "Meena", weddingAnniversary: "2024-02-11", children: [] };
  assert.deepEqual(missingOnboardingFields(married), []);
});

test("the two fields only a married candidate sees are asked for only of them", () => {
  assert.deepEqual(missingOnboardingFields({ ...complete, maritalStatus: "Single", spouseName: "", weddingAnniversary: "" }), []);
  const missing = missingOnboardingFields({ ...complete, maritalStatus: "Married", spouseName: "", weddingAnniversary: "" });
  assert.deepEqual(missing, ["Spouse Name", "Wedding Anniversary"]);
});
