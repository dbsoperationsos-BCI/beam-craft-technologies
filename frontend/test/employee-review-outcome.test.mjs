import test from "node:test";
import assert from "node:assert/strict";

import { REVIEW_OUTCOMES, outcomeStyle, reviewPayload, reviewStatusStyles, reviewTableFields, reviewTotals, validateReview } from "../src/constants/employeeReviewConfig.js";

/*
 * How a review went, and what it awarded — which are now two separate questions.
 *
 * The one that matters here is the difference between **no increment** and **an increment of zero**.
 * They look identical in a form (an empty box, a box holding 0) and mean opposite things: a review
 * held without a figure, and a review that deliberately awarded nothing. `Number("")` is 0, so the
 * obvious conversion silently turns the first into the second — permanently, and in a column that
 * feeds the employee's total salary.
 */

test("a review needs only its date", () => {
  assert.equal(validateReview({ reviewDate: "2026-03-01" }), "");
  assert.equal(validateReview({ reviewDate: "" }), "Enter the review date.");
});

test("an increment left empty is not a missing answer", () => {
  // The whole point of the field becoming optional: reviews are held without a figure.
  assert.equal(validateReview({ reviewDate: "2026-03-01", incrementAmount: "" }), "");
  assert.equal(validateReview({ reviewDate: "2026-03-01", incrementAmount: undefined }), "");
});

test("an increment that is given still has to be a number", () => {
  assert.notEqual(validateReview({ reviewDate: "2026-03-01", incrementAmount: "-5" }), "");
  assert.notEqual(validateReview({ reviewDate: "2026-03-01", incrementAmount: "abc" }), "");
  assert.equal(validateReview({ reviewDate: "2026-03-01", incrementAmount: "0" }), "");
});

test("empty reaches the server as null, and a typed zero as zero", () => {
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", incrementAmount: "" }).incrementAmount, null);
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", incrementAmount: "0" }).incrementAmount, 0);
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", incrementAmount: "12000" }).incrementAmount, 12000);
});

test("the row key never travels to the server", () => {
  assert.equal("key" in reviewPayload({ key: "review-1", reviewDate: "2026-03-01" }), false);
});

test("an unmarked review is null rather than an empty string", () => {
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", outcome: "" }).outcome, null);
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", outcome: "Shine" }).outcome, "Shine");
});

test("remarks are trimmed, and a remark of only spaces reaches the server as null", () => {
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", remarks: "  Good progress  " }).remarks, "Good progress");
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", remarks: "   " }).remarks, null);
  assert.equal(reviewPayload({ reviewDate: "2026-03-01", remarks: "" }).remarks, null);
  assert.equal(reviewPayload({ reviewDate: "2026-03-01" }).remarks, null);
});

test("a review with no increment adds nothing to the totals", () => {
  const totals = reviewTotals([
    { reviewDate: "2025-03-01", incrementAmount: 12000 },
    { reviewDate: "2025-09-01", incrementAmount: null },
  ], 30000);
  assert.equal(totals.totalIncrement, 12000);
  assert.equal(totals.totalSalary, 42000);
});

test("the two marks are Shine and Shadow, best first", () => {
  // Order is the scale, which is why the picker is told not to sort: alphabetically these read
  // Shadow, Shine — the scale backwards.
  assert.deepEqual(REVIEW_OUTCOMES, ["Shine", "Shadow"]);
});

test("each mark carries a tint and an edge, and an unmarked review carries neither", () => {
  for (const mark of REVIEW_OUTCOMES) {
    assert.ok(outcomeStyle(mark).row, `${mark} has a row tint`);
    assert.ok(outcomeStyle(mark).edge, `${mark} has an edge`);
  }
  // Nobody said, so nothing is said: an unmarked row is the honest middle case.
  assert.equal(outcomeStyle(null).row, "");
  assert.equal(outcomeStyle(null).edge, "");
  assert.equal(outcomeStyle("Average").row, "");
});

test("the marks are told apart by more than hue", () => {
  // The chip names the mark, so the answer is never only a colour.
  assert.notEqual(outcomeStyle("Shine").chip, outcomeStyle("Shadow").chip);
});

/*
 * A review dated in the future is still a recorded review.
 *
 * Reviews may be dated on any day — the studio records ones it has scheduled as well as ones it has
 * held — so the list that holds them is **Recorded** rather than "Past", and everything in it counts
 * towards the employee's totals whatever its date. The section also opens on that list when there is
 * anything in it: it used to open on Upcoming, which is a scheduled *date* and never a review row,
 * so a review that had just been saved was filed one tab away from where somebody went looking for
 * it — indistinguishable, from the outside, from one that had not saved at all.
 */
test("a review dated in the future counts like any other", () => {
  const future = [{ reviewDate: "2027-01-01", incrementAmount: 1000 }];
  const totals = reviewTotals(future, 30000);
  assert.equal(totals.totalIncrement, 1000);
  assert.equal(totals.totalSalary, 31000);
  assert.equal(totals.lastReviewDate, "2027-01-01");
});

/*
 * The review table's own columns.
 *
 * They are read by `buildTableColumns`, which decides filtering, sorting and what the CSV export
 * carries from the `type` on each — so a wrong type is not a cosmetic slip. `outcome` must be a
 * `status` or the mark loses its colour; `incrementAmount` must be an `amount` or a review held
 * without a figure exports as something other than the dash the screen shows.
 */

test("the table's columns carry the types the shared cells need", () => {
  const byKey = Object.fromEntries(reviewTableFields.map(([key, header, type]) => [key, { header, type }]));
  assert.equal(byKey.outcome.type, "status", "the mark needs the status cell to get its colour");
  assert.equal(byKey.incrementAmount.type, "amount", "an amount, so a review with none reads as a dash");
  assert.equal(byKey.reviewDate.type, "date");
  assert.equal(byKey.nextReviewDate.type, "date");
});

test("every mark the studio can record has a dot colour", () => {
  // `TableCellValue` looks these up by the stored value, not by a label, so a mark missing here
  // silently falls through to the shared slate dot and reads as unmarked.
  for (const mark of REVIEW_OUTCOMES) {
    assert.ok(reviewStatusStyles[mark], `${mark} has no dot colour`);
  }
  assert.equal(reviewStatusStyles.Shine === reviewStatusStyles.Shadow, false, "the two marks must not look alike");
});
