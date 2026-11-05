const test = require("node:test");
const assert = require("node:assert/strict");
const { startProjectSchema, startProjectDraftSchema } = require("../src/modules/sales/projects/controller");

/*
 * What a project must answer before it may leave "Yet to Start".
 *
 * The form marks these fields and refuses to submit without them, but the form is not what makes
 * them true: `PATCH /projects/:id/start-project` is reachable on its own, so the rule is asserted
 * here as well. Mirrors `projectSetupProblems` in `frontend/src/lib/projectSetupValidation.mjs` —
 * the two drifting apart is what these tests exist to catch.
 *
 * The draft endpoint beside it is deliberately not held to any of this: it is what the panel
 * autosaves into every time typing pauses, and a half-answered form is what a draft is.
 */

const complete = {
  welcomeGift: "Not Applicable",
  shootCompletedGift: "Not Applicable",
  projectValidityMonths: 12,
  storageNeeded: "No",
  crdDocumentStatus: "Applicable",
};

const messagesFor = (payload) => {
  const parsed = startProjectSchema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

test("a fully answered Project Setup starts", () => {
  const parsed = startProjectSchema.safeParse(complete);
  assert.equal(parsed.success, true);
});

test("a CRD Document left unanswered is refused", () => {
  // The bug this closes: the field was marked required on the form and checked by nobody, so a
  // project could start with no answer - and a project with no answer appears neither on CRD
  // Documents nor among the enquiries Create CRD Document offers.
  for (const value of [null, undefined]) {
    assert.deepEqual(messagesFor({ ...complete, crdDocumentStatus: value }), ["Answer CRD Document."]);
  }
});

test("project validity, storage and both gifts are each required", () => {
  assert.deepEqual(messagesFor({ ...complete, projectValidityMonths: null }), ["Enter Project Validity (In Months)."]);
  assert.deepEqual(messagesFor({ ...complete, storageNeeded: null }), ["Answer Storage Needed."]);
  assert.deepEqual(messagesFor({ ...complete, welcomeGift: null }), ["Answer Welcome Gift."]);
  assert.deepEqual(messagesFor({ ...complete, shootCompletedGift: null }), ["Answer Shoot Completed Gift."]);
});

test("an applicable gift has to name the person taking care of it", () => {
  assert.deepEqual(messagesFor({ ...complete, welcomeGift: "Applicable" }), ["Assign an employee to take care of the Welcome Gift."]);
  assert.deepEqual(messagesFor({ ...complete, shootCompletedGift: "Applicable" }), ["Assign an employee to take care of the Shoot Completed Gift."]);
  assert.equal(startProjectSchema.safeParse({ ...complete, welcomeGift: "Applicable", welcomeGiftEmployeeId: 4 }).success, true);
});

test("a gift that is not being given asks for nobody", () => {
  assert.equal(startProjectSchema.safeParse({ ...complete, welcomeGift: "Not Applicable", welcomeGiftEmployeeId: null }).success, true);
});

test("every outstanding answer is reported at once, not one press at a time", () => {
  const messages = messagesFor({});
  assert.deepEqual(messages.sort(), [
    "Answer CRD Document.",
    "Answer Shoot Completed Gift.",
    "Answer Storage Needed.",
    "Answer Welcome Gift.",
    "Enter Project Validity (In Months).",
  ]);
});

test("the draft endpoint stays permissive, since it is what the form autosaves into", () => {
  assert.equal(startProjectDraftSchema.safeParse({}).success, true);
  assert.equal(startProjectDraftSchema.safeParse({ crdDocumentStatus: null, projectValidityMonths: null }).success, true);
});
