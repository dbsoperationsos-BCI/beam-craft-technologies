const test = require("node:test");
const assert = require("node:assert/strict");
const { offboardingStage } = require("../src/modules/hrm/offboarding-invites/controller");

/*
 * HR Offboarding List says where each leaver stands, not only that their form was approved.
 */
const WORKING = new Set(["Active", "in Training", "PIP"]);
const approved = (extra) => ({ status: "Approved", separationId: 7, employee: { employmentStatus: "Active" }, ...extra });

test("an approved form whose leaver is still working reads Serving Notice", () => {
  assert.equal(offboardingStage(approved(), WORKING), "Serving Notice");
  assert.equal(offboardingStage(approved({ employee: { employmentStatus: "PIP" } }), WORKING), "Serving Notice");
});

test("one whose leaver has gone reads the status they left on", () => {
  assert.equal(offboardingStage(approved({ employee: { employmentStatus: "Relieved" } }), WORKING), "Relieved");
  assert.equal(offboardingStage(approved({ employee: { employmentStatus: "Absconded" } }), WORKING), "Absconded");
});

test("one whose separation was removed since reads Withdrawn", () => {
  assert.equal(offboardingStage(approved({ separationId: null, employee: { employmentStatus: "Relieved" } }), WORKING), "Withdrawn");
});

test("every other form reads its own status, and nothing changes where the working statuses were not read", () => {
  for (const status of ["Sent", "Verified", "Submitted", "Sent Back", "Rejected", "Cancelled", "Expired"]) {
    assert.equal(offboardingStage({ status, separationId: null, employee: { employmentStatus: "Active" } }, WORKING), status);
  }
  assert.equal(offboardingStage(approved(), null), "Approved");
});
