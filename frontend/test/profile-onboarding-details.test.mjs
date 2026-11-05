import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { onboardingFormSections } from "../src/constants/onboardingFormConfig.js";

/*
 * My Profile states the record somebody filled in when they joined.
 *
 * It used to state eleven assorted facts in read-only text boxes: a summary rather than a record,
 * so the one place a person can check what the studio holds about them - and spot what needs
 * correcting - showed a tenth of it.
 *
 * The view is drawn from the onboarding form's own section list rather than from a second copy of
 * the fields, and these tests are about that staying true. Two lists would agree right up until
 * somebody edited one of them.
 */

const read = (file) => fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
const view = () => read("src/components/profile/OnboardingDetailsView.js");

test("the view is drawn from the onboarding form's own sections", () => {
  assert.match(view(), /from "@\/constants\/onboardingFormConfig"/, "the profile keeps its own copy of the fields again");
  assert.doesNotMatch(view(), /label: "(First Name|Bank Name|Aadhar)/, "field labels are being written out a second time");
});

test("every section of the onboarding form is reachable on the profile", () => {
  // Nothing filters sections by name, so all eight arrive; a section is dropped only when the
  // person answered nothing in it.
  assert.equal(onboardingFormSections.length, 8);
  for (const section of onboardingFormSections) {
    assert.ok(section.title, `${section.id} has no title to head its card with`);
    assert.ok(section.fields.length, `${section.id} has no fields`);
  }
});

test("the backend sends every field the form collects, under the form's own names", () => {
  /*
   * The view reads `onboarding[field.name]`, so a field the payload spells differently is a field
   * that silently never appears. This is the join between the two halves and nothing else checks it.
   */
  const routes = read("../backend/src/modules/user/routes.js");
  const payload = routes.slice(routes.indexOf("onboarding: employee ? {"), routes.indexOf("} : null,", routes.indexOf("onboarding: employee ? {")));
  assert.ok(payload, "the profile route no longer sends an onboarding record");

  const skipped = new Set(["profilePhoto", "sameAsCurrentAddress", "firstName", "lastName"]);
  for (const section of onboardingFormSections) {
    for (const field of section.fields) {
      if (skipped.has(field.name)) continue;
      assert.match(payload, new RegExp(`\\b${field.name}:`), `the profile payload never sends ${field.name}, so it cannot be shown`);
    }
  }
});

test("the photo and the form's own bookkeeping are not read back as facts", () => {
  /*
   * The profile photo is already the largest thing on the page, in the header above this. "Same as
   * current address" is a question the form asked itself to save typing, not an answer about
   * anybody - printing it would read as a fact about the person.
   */
  const source = view();
  assert.match(source, /field\.name !== "profilePhoto"/);
  assert.match(source, /field\.type !== "checkbox"/);
});

test("an answer nobody gave is left out rather than shown empty", () => {
  // Which is also what handles the fields the form only asks some people - an unmarried employee
  // has no spouse row, and this needs to know nothing about the rule that decides that.
  const source = view();
  assert.match(source, /function answered\(/);
  assert.match(source, /if \(Array\.isArray\(value\)\) return value\.length > 0;/, "an empty list is being shown as an answer");
});

test("nothing on the page pretends to be editable", () => {
  // Stated as label-over-value. Read-only text boxes ask somebody to work out that a row of input
  // boxes is not for typing in.
  const source = view();
  assert.doesNotMatch(source, /<TextField/, "the record is drawn as form fields again");
  assert.match(source, /<dl /, "the record is no longer a description list");
});

test("each identity proof is read as one fact: the number, and that card beside it", () => {
  /*
   * The form asks for both numbers first and both photographs after, because that is the order
   * they are easiest to type in. Read back in that order it is two documents split in half, with
   * "Aadhar Card Number" in one corner and its photograph three fields away.
   */
  const source = view();
  assert.match(source, /aadharCardNumber: "aadharCardImage"/);
  assert.match(source, /panCardNumber: "panCardImage"/);
  // And the photographs do not also appear on their own, which would print each card twice.
  assert.match(source, /!PAIRED_IMAGES\.has\(field\.name\)/, "the proof photographs are listed as facts of their own again");
});

test("the record uses the width it is given, by placing cards rather than columns", () => {
  /*
   * It was a 3xl column down the middle with most of the screen empty either side. Widening it by
   * adding a third column of *fields* was worse, not better - see the next test - so the width is
   * used by putting the short cards side by side instead.
   */
  const source = view();
  assert.match(source, /max-w-6xl/, "the record is pinned back to a narrow column");
  assert.match(source, /grid max-w-6xl gap-4 lg:grid-cols-2/, "the cards no longer sit side by side");
  assert.match(source, /section\.wide \? "lg:col-span-2"/, "a card holding an address or a table no longer takes the whole row");
});

test("the fields inside a card are two to a row, so a pair is never split", () => {
  /*
   * The form's fields come in pairs, written one after the other: a nominee's name then their
   * phone, a father's name then his occupation, a bank's name then its branch. An odd number of
   * columns puts half of a pair at the end of one row and the other half at the start of the next,
   * which is precisely what a three-column layout did to Nominee 2 and to both parents.
   *
   * Checked against the form's own list rather than the markup, so a field added between a pair
   * fails here rather than quietly splitting them on the page.
   */
  const source = view();
  assert.match(source, /<dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">/, "the fields are no longer two to a row");
  assert.doesNotMatch(source, /lg:grid-cols-3/, "a third column of fields is back, which splits every pair");

  const PAIRS = [
    ["fatherName", "fatherOccupation"],
    ["motherName", "motherOccupation"],
    ["nominee1PersonName", "nominee1PersonPhone"],
    ["nominee2PersonName", "nominee2PersonPhone"],
    ["reference1PersonName", "reference1PersonPhone"],
    ["reference2PersonName", "reference2PersonPhone"],
    ["emergencyContactName", "emergencyContactNumber"],
    ["bankName", "bankLocation"],
    ["accountNumber", "ifscCode"],
  ];
  const shown = (section) => section.fields
    .filter((field) => field.name !== "profilePhoto" && field.type !== "checkbox")
    .filter((field) => !["aadharCardImage", "panCardImage"].includes(field.name));
  const isWide = (field) => field.colSpan === 2 || field.type === "textarea" || field.type === "custom";

  /*
   * The rows the grid actually produces, rather than index parity: a full-width field takes a row
   * of its own and starts the next one fresh, so the pair after an address is back at column one
   * however odd its index is. Getting that wrong is what this very test did on its first run.
   */
  const rowsOf = (section) => {
    const rows = [];
    let row = [];
    for (const field of shown(section)) {
      if (isWide(field)) {
        if (row.length) rows.push(row);
        rows.push([field.name]);
        row = [];
        continue;
      }
      row.push(field.name);
      if (row.length === 2) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return rows;
  };

  for (const [first, second] of PAIRS) {
    const section = onboardingFormSections.find((entry) => entry.fields.some((field) => field.name === first));
    const row = rowsOf(section).find((entry) => entry.includes(first));
    assert.deepEqual(row, [first, second], `${first} and ${second} no longer share a row`);
  }
});
