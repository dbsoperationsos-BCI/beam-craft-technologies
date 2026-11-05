import test from "node:test";
import assert from "node:assert/strict";

import { applicationFormSections, applicationInitialValues } from "../src/constants/interviewApplicationConfig.js";
import { candidateFormSections, candidateInfoSections, emptyCandidateValues } from "../src/constants/interviewConfig.js";

/*
 * What the screening form asks about **where somebody is**, and how it asks for a list.
 *
 * Two changes, and the first is the one with teeth. The form asked for a State and a postal Address;
 * it now asks Native Place and Current Location. A state is too coarse to answer what a studio
 * actually wants to know about somebody it is considering - can they be on the floor on Saturday,
 * and would the job mean moving - and a full address is more than a studio should hold about a
 * person it has not hired.
 *
 * The form's payload is derived from these sections (`applicationInitialValues`), which is what
 * makes the section list the single authority on what a submission may send. So a field left here
 * after the server stopped accepting it is not cosmetic: it would be posted, and the submission
 * writes partially.
 */

const fieldNames = (sections) => sections.flatMap((section) => (section.fields || []).map((field) => field.name));
const field = (name) => applicationFormSections.flatMap((section) => section.fields || []).find((one) => one.name === name);

test("the screening form no longer asks for a state or a postal address", () => {
  const asked = fieldNames(applicationFormSections);
  for (const gone of ["state", "address"]) {
    assert.equal(asked.includes(gone), false, `the form still asks for a ${gone}`);
    /*
     * And it cannot post one either. The payload is built from the sections, so a key surviving in
     * the initial values is a key that would be sent - and an empty one would write over what a
     * linked sheet or the CSV import put on the record, because the submission is applied partially.
     */
    assert.equal(gone in applicationInitialValues, false, `${gone} would still be posted`);
  }
});

test("it asks where they are from and where they are now, as two plain boxes", () => {
  for (const name of ["nativePlace", "currentLocation"]) {
    const one = field(name);
    assert.ok(one, `the form does not ask for ${name}`);
    assert.ok(name in applicationInitialValues, `${name} would not be posted`);
    /*
     * Neither is a textarea. An answer is a town, sometimes a district - a textarea would invite the
     * paragraph that Address used to collect, which is the thing being removed.
     */
    assert.notEqual(one.type, "textarea", `${name} should be a one-line box`);
  }
  assert.equal(field("nativePlace").label, "Native Place");
  assert.equal(field("currentLocation").label, "Current Location");
  // The city stays: it is a different question from either of them.
  assert.ok(field("city"), "the form should still ask for a city");
});

test("skills and languages say comma separated in the label, not only in the placeholder", () => {
  /*
   * A placeholder is gone the moment somebody types, so the one instruction that decides whether the
   * answer is readable afterwards disappeared exactly when it started mattering. The label stays on
   * screen while the box is being filled in; the placeholder keeps the example.
   */
  for (const name of ["skills", "languagesKnown"]) {
    const one = field(name);
    assert.ok(one, `the form does not ask for ${name}`);
    assert.match(one.label, /comma separated/i, `${name} does not say how to separate its values`);
    assert.match(one.props?.placeholder || "", /,/, `${name} should still show a comma-separated example`);
  }
});

test("HR keeps the state and address on the record, and gains the two new answers", () => {
  /*
   * "The form no longer asks" is not "the studio throws away what it already has": a linked sheet
   * and the CSV import still fill `state` and `address` for candidates who arrived that way, so both
   * stay readable and correctable on the record beside the two new fields.
   */
  const onRecord = fieldNames(candidateFormSections);
  for (const kept of ["city", "state", "address"]) assert.ok(onRecord.includes(kept), `the record lost ${kept}`);
  for (const added of ["nativePlace", "currentLocation"]) {
    assert.ok(onRecord.includes(added), `the record cannot show ${added}`);
    // And the blank record carries the key, which is what `candidateFormValues` maps a candidate by.
    assert.ok(added in emptyCandidateValues(), `${added} would never be read off a candidate`);
  }
  // Both are on the info panel too, so a candidate reads the same whichever way they are opened.
  const onPanel = candidateInfoSections.flatMap((section) => section.fields.map(([key]) => key));
  for (const added of ["nativePlace", "currentLocation"]) {
    assert.ok(onPanel.includes(added), `the info panel does not show ${added}`);
  }
});
