import test from "node:test";
import assert from "node:assert/strict";

import { missingProjectSetupLabels, projectSetupProblems } from "../src/lib/projectSetupValidation.mjs";

/*
 * What stands between a filled-in Project Setup and a started project.
 *
 * The rules here are asserted twice — once by the form, which marks the fields, and once by
 * `startProjectSchema` on the server, which refuses the save. These tests pin the half the form
 * reads, so a rule that drifts on one side is a failing test rather than a save that is refused
 * with nothing on screen to say why.
 */

const complete = {
  welcomeGift: "Not Applicable",
  shootCompletedGift: "Not Applicable",
  projectValidityMonths: "12",
  storageNeeded: "No",
  crdDocumentStatus: "Applicable",
};

test("a fully answered Project Setup has nothing outstanding", () => {
  assert.deepEqual(projectSetupProblems(complete), {});
  assert.deepEqual(missingProjectSetupLabels(complete), []);
});

test("every required field is named when nothing has been answered", () => {
  const problems = projectSetupProblems({});
  assert.deepEqual(Object.keys(problems).sort(), [
    "crdDocumentStatus",
    "projectValidityMonths",
    "shootCompletedGift",
    "storageNeeded",
    "welcomeGift",
  ]);
  // The assignees are not among them: a gift nobody has answered yet asks for nobody.
  assert.equal(problems.welcomeGiftEmployeeId, undefined);
});

test("an applicable gift carries its assignee, and a gift not being given does not", () => {
  const applicable = projectSetupProblems({ ...complete, welcomeGift: "Applicable" });
  assert.equal(applicable.welcomeGiftEmployeeId, "Required");

  const assigned = projectSetupProblems({ ...complete, welcomeGift: "Applicable", welcomeGiftEmployeeId: 7 });
  assert.deepEqual(assigned, {});

  const notGiven = projectSetupProblems({ ...complete, welcomeGift: "Not Applicable", welcomeGiftEmployeeId: "" });
  assert.deepEqual(notGiven, {});
});

test("the shoot completed gift is checked the same way and separately", () => {
  const problems = projectSetupProblems({ ...complete, shootCompletedGift: "Applicable" });
  assert.deepEqual(Object.keys(problems), ["shootCompletedGiftEmployeeId"]);
});

test("a CRD Document left blank stops the start", () => {
  assert.equal(projectSetupProblems({ ...complete, crdDocumentStatus: "" }).crdDocumentStatus, "Required");
  assert.equal(projectSetupProblems({ ...complete, crdDocumentStatus: null }).crdDocumentStatus, "Required");
  assert.deepEqual(missingProjectSetupLabels({ ...complete, crdDocumentStatus: "" }), ["CRD Document"]);
});

test("project validity has to be a whole number of months from one upward", () => {
  // Answered but out of range, which the column refuses — so it is refused here rather than there.
  for (const months of ["0", "-3", "1.5"]) {
    assert.equal(projectSetupProblems({ ...complete, projectValidityMonths: months }).projectValidityMonths, "Enter a whole number of months, 1 or more.");
  }
  assert.equal(projectSetupProblems({ ...complete, projectValidityMonths: "" }).projectValidityMonths, "Required");
  assert.equal(projectSetupProblems({ ...complete, projectValidityMonths: 1 }).projectValidityMonths, undefined);
});

test("Storage Needed answered No is an answer, not a blank", () => {
  assert.equal(projectSetupProblems({ ...complete, storageNeeded: "No" }).storageNeeded, undefined);
  assert.equal(projectSetupProblems({ ...complete, storageNeeded: "" }).storageNeeded, "Required");
});

test("outstanding fields are named the way the form labels them", () => {
  assert.deepEqual(missingProjectSetupLabels({ ...complete, storageNeeded: "", crdDocumentStatus: "" }).sort(), ["CRD Document", "Storage Needed"]);
});
