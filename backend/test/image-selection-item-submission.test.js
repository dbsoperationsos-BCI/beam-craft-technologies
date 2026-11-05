const test = require("node:test");
const assert = require("node:assert/strict");
const { submissionPlan } = require("../src/modules/image-selection/publication/service");

// A wedding project part-way through: the engagement album has been picked in full, everything
// else is still open. Shapes match what createDeliverableService().list() returns.
const item = (id, shootId, selectionLimit, overrides = {}) => ({ id, name: id, shootId, selectionLimit, selectionSubmittedAt: null, ...overrides });
const items = () => [
  item("album", "shoot-engagement", 25),
  item("retouches", "shoot-engagement", 30),
  item("wedding-retouches", "shoot-wedding", 19),
];

test("submits one selection item once it reached its limit", () => {
  const plan = submissionPlan(items(), "album", { album: 25 });
  assert.deepEqual(plan.submittedIds, ["album"]);
  assert.equal(plan.completesProject, false);
});

// The limit is a ceiling on how many the client may pick, not a quota they have to fill: a client
// who wants seven of the ten offered may send seven. Picking an eleventh is what is refused, and
// that is `updateSelection`'s rule rather than this one.
test("submits an item the client has not filled to its limit", () => {
  assert.deepEqual(submissionPlan(items(), "retouches", { retouches: 29 }).submittedIds, ["retouches"]);
  assert.deepEqual(submissionPlan(items(), "retouches", { retouches: 1 }).submittedIds, ["retouches"]);
});

test("refuses an item with nothing picked for it", () => {
  assert.throws(
    () => submissionPlan(items(), "retouches", { retouches: 0 }),
    (error) => error.status === 409 && /at least one photo for retouches/.test(error.message),
  );
  assert.throws(
    () => submissionPlan(items(), "retouches", {}),
    (error) => error.status === 409 && /at least one photo for retouches/.test(error.message),
  );
});

test("a short count on another item does not block this one", () => {
  const plan = submissionPlan(items(), "wedding-retouches", { "wedding-retouches": 19, retouches: 2 });
  assert.deepEqual(plan.submittedIds, ["wedding-retouches"]);
});

test("a sibling item under the same shoot does not block this one", () => {
  const plan = submissionPlan(items(), "album", { album: 25, retouches: 0 });
  assert.deepEqual(plan.submittedIds, ["album"]);
});

test("refuses an item that was already submitted", () => {
  const submitted = items().map((entry) => (entry.id === "album" ? { ...entry, selectionSubmittedAt: new Date() } : entry));
  assert.throws(() => submissionPlan(submitted, "album", {}), (error) => error.status === 409 && /already been submitted/.test(error.message));
});

test("refuses an unknown selection item", () => {
  assert.throws(() => submissionPlan(items(), "no-such-item", {}), (error) => error.status === 404);
});

test("refuses a submit that names no selection item", () => {
  assert.throws(() => submissionPlan(items(), null, {}), (error) => error.status === 404);
});

test("submitting the last open item completes the project", () => {
  const partly = items().map((entry) => (entry.id === "wedding-retouches" ? entry : { ...entry, selectionSubmittedAt: new Date() }));
  const plan = submissionPlan(partly, "wedding-retouches", { "wedding-retouches": 19 });
  assert.equal(plan.completesProject, true);
});

// A manual project's items belong to no shoot; each still submits on its own.
test("a manual project's item submits alone", () => {
  const manual = [item("retouches", null, 30), item("frames", null, 12)];
  const plan = submissionPlan(manual, "retouches", { retouches: 30 });
  assert.deepEqual(plan.submittedIds, ["retouches"]);
  assert.equal(plan.completesProject, false);
});
