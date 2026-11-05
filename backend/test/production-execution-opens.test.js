const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/modules/project-management/production/steps");

/*
 * A shoot's steps open three days before the shoot, once its plan is submitted - not the moment the
 * plan is in. A shoot with no date opens on its plan; one whose day has begun stays open.
 */
const shoot = (overrides = {}) => ({ planSubmittedAt: new Date("2026-10-01"), currentStep: null, shootStatus: null, shoot: { shootType: "Outdoor", dateCreated: new Date("2026-10-20T00:00:00Z") }, ...overrides });

test("the steps open three days before the shoot", () => {
  assert.equal(S.executionOpensOn(shoot()), "2026-10-17");
  assert.match(S.executionRefusal(shoot(), "2026-10-16"), /The steps open on 17 Oct 2026, three days before the shoot\./);
  assert.equal(S.executionRefusal(shoot(), "2026-10-17"), null, "open on the third day before");
  assert.equal(S.executionRefusal(shoot(), "2026-10-25"), null, "and after the shoot");
});

test("no plan, no steps; no date, the plan alone opens them; a day begun stays open", () => {
  assert.equal(S.executionRefusal(shoot({ planSubmittedAt: null }), "2026-10-19"), "The plan has not been submitted yet.");
  assert.equal(S.executionRefusal(shoot({ shoot: { shootType: "Outdoor", dateCreated: null } }), "2026-01-01"), null);
  assert.equal(S.executionRefusal(shoot({ currentStep: "PINEAPPLE_MEETING" }), "2026-10-01"), null);
});

test("a step's photo cannot be added before the steps open", () => {
  assert.match(S.fileAddRefusal(shoot(), "STARTED_FROM_STUDIO", "2026-10-10") || "", /The steps open on/);
});
