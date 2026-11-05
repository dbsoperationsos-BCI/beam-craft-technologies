import test from "node:test";
import assert from "node:assert/strict";

import { isReviewPending } from "../src/lib/employmentStatus.mjs";

/*
 * The Employee Repository's Review Pending tab: an overlay over a working employee's own status,
 * not a status of its own. See `isReviewPending` and the tab it feeds in EmployeeVerificationPage.
 */

test("a working employee whose review date has gone by is review pending", () => {
  assert.equal(isReviewPending({ employmentStatus: "Active", nextReviewDate: "2026-08-01" }, "2026-09-05"), true);
  assert.equal(isReviewPending({ employmentStatus: "in Training", nextReviewDate: "2026-08-01" }, "2026-09-05"), true);
  assert.equal(isReviewPending({ employmentStatus: "PIP", nextReviewDate: "2026-08-01" }, "2026-09-05"), true);
});

test("due today, or still to come, is not pending", () => {
  assert.equal(isReviewPending({ employmentStatus: "Active", nextReviewDate: "2026-09-05" }, "2026-09-05"), false);
  assert.equal(isReviewPending({ employmentStatus: "Active", nextReviewDate: "2027-01-01" }, "2026-09-05"), false);
});

test("nobody without a working status is asked, however old the date", () => {
  for (const employmentStatus of ["HR Onboarding Pending", "Employee Submission Pending", "Relieved", "Absconded", "Fired", "Long Leave"]) {
    assert.equal(isReviewPending({ employmentStatus, nextReviewDate: "2020-01-01" }, "2026-09-05"), false, employmentStatus);
  }
});

test("no review date scheduled is nothing outstanding", () => {
  assert.equal(isReviewPending({ employmentStatus: "Active", nextReviewDate: null }, "2026-09-05"), false);
  assert.equal(isReviewPending({ employmentStatus: "Active" }, "2026-09-05"), false);
});

test("a row with no employee at all is never pending", () => {
  assert.equal(isReviewPending(null), false);
  assert.equal(isReviewPending(undefined), false);
});
