import test from "node:test";
import assert from "node:assert/strict";

import { addMonths, defaultNextReviewDate, heldReviews, REVIEW_INTERVAL_MONTHS, scheduledReview, syncedNextReviewDate, today } from "../src/lib/employeeReviewSchedule.mjs";

/*
 * The six-month review clock.
 *
 * Two things are worth pinning. The arithmetic, because month-end and year-end are where date maths
 * quietly goes wrong and a review lands in the wrong month. And when the rule declines to write:
 * every date it produces is a default sitting in an editable field, so overwriting one a person
 * typed would be worse than never filling it in at all.
 */

test("a review cycle is six months", () => {
  assert.equal(REVIEW_INTERVAL_MONTHS, 6);
  assert.equal(defaultNextReviewDate("2026-01-15"), "2026-07-15");
});

test("six months across a year end lands in the right year", () => {
  assert.equal(defaultNextReviewDate("2026-09-05"), "2027-03-05");
  assert.equal(defaultNextReviewDate("2026-12-31"), "2027-06-30");
});

test("a day the target month does not have is clamped to its last, never rolled over", () => {
  // 31 August + 6 is February. Rolling would give 3 March and put the review in the wrong month.
  assert.equal(defaultNextReviewDate("2026-08-31"), "2027-02-28");
  // A leap February keeps its 29th.
  assert.equal(defaultNextReviewDate("2027-08-31"), "2028-02-29");
  assert.equal(defaultNextReviewDate("2026-03-31"), "2026-09-30");
});

test("dates are read as calendar days, not as UTC midnight", () => {
  // `new Date("2026-01-01")` is UTC midnight, which is 31 December east of Greenwich. Reading the
  // string as calendar parts is what keeps the 1st the 1st wherever the studio is.
  assert.equal(defaultNextReviewDate("2026-01-01"), "2026-07-01");
  assert.equal(addMonths("2026-01-01", 0), "2026-01-01");
});

test("anything that is not a real date produces nothing rather than a wrong date", () => {
  for (const value of ["", null, undefined, "not-a-date", "2026-13-01", "2026-02-30", "2026-1-1", "15/01/2026"]) {
    assert.equal(defaultNextReviewDate(value), "", String(value));
  }
});

test("a next review nobody has touched follows the date it is counted from", () => {
  // The joining date moves; the review that was derived from it moves with it.
  assert.equal(syncedNextReviewDate({ previousSource: "2026-01-15", nextSource: "2026-02-15", currentNext: "2026-07-15" }), "2026-08-15");
  // Nothing there yet, so there is nothing to protect.
  assert.equal(syncedNextReviewDate({ previousSource: "2026-01-15", nextSource: "2026-02-15", currentNext: "" }), "2026-08-15");
});

test("a next review somebody typed is never overwritten", () => {
  // HR chose 1 September. Moving the joining date must not take that away from them.
  assert.equal(syncedNextReviewDate({ previousSource: "2026-01-15", nextSource: "2026-02-15", currentNext: "2026-09-01" }), "2026-09-01");
});

test("clearing the date it counts from clears only a date nobody chose", () => {
  assert.equal(syncedNextReviewDate({ previousSource: "2026-01-15", nextSource: "", currentNext: "2026-07-15" }), "");
  assert.equal(syncedNextReviewDate({ previousSource: "2026-01-15", nextSource: "", currentNext: "2026-09-01" }), "2026-09-01");
});

test("setting the source for the first time fills an empty next review", () => {
  assert.equal(syncedNextReviewDate({ previousSource: "", nextSource: "2026-03-10", currentNext: "" }), "2026-09-10");
});

test("today is the reader's own calendar day", () => {
  assert.equal(today(new Date(2026, 8, 5, 23, 30)), "2026-09-05");
  assert.equal(today(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

/*
 * The two tabs on the review list are a schedule and a history, not two halves of one list.
 *
 * Splitting the review rows by date put everything under Past and left Upcoming permanently empty,
 * because a row records an appraisal that has been held — the dialog refuses a future date for one.
 * What is outstanding is the employee's next review date, which is not a row.
 */

test("the outstanding review is the scheduled date, not a row", () => {
  assert.deepEqual(scheduledReview("2027-03-01", "2026-09-05"), { dueOn: "2027-03-01", overdue: false });
});

test("a due date that has gone by is overdue", () => {
  assert.deepEqual(scheduledReview("2026-08-01", "2026-09-05"), { dueOn: "2026-08-01", overdue: true });
  // Due today is not yet overdue.
  assert.deepEqual(scheduledReview("2026-09-05", "2026-09-05"), { dueOn: "2026-09-05", overdue: false });
});

test("no date scheduled means nothing outstanding", () => {
  for (const value of ["", null, undefined, "not-a-date", "2026-02-30"]) {
    assert.equal(scheduledReview(value, "2026-09-05"), null, String(value));
  }
});

test("a stored timestamp is read by its date part", () => {
  assert.deepEqual(scheduledReview("2027-03-01T00:00:00.000Z", "2026-09-05"), { dueOn: "2027-03-01", overdue: false });
});

test("held reviews read newest first", () => {
  const rows = [{ key: "a", reviewDate: "2025-03-01" }, { key: "b", reviewDate: "2026-09-05" }, { key: "c", reviewDate: "2024-06-30" }];
  assert.deepEqual(heldReviews(rows).map((row) => row.key), ["b", "a", "c"]);
  // The list handed in is left alone; the order is a new array.
  assert.deepEqual(rows.map((row) => row.key), ["a", "b", "c"]);
});

test("an empty or missing list of held reviews is an empty list", () => {
  assert.deepEqual(heldReviews([]), []);
  assert.deepEqual(heldReviews(undefined), []);
});
