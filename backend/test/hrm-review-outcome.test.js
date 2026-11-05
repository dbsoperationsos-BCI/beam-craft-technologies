const test = require("node:test");
const assert = require("node:assert/strict");
/*
 * The salary review's mark, and its increment becoming optional.
 *
 * The rule worth holding here is that an empty box and a typed 0 stay different all the way to the
 * column. `Number("")` is 0, so a conversion that does not think about it silently records an
 * increment of zero for every review held without a figure — and the difference cannot be recovered
 * afterwards, because the two are then identical in the database.
 */
const { reviewSchema, REVIEW_OUTCOMES } = require("../src/modules/hrm/employees/controller");

test("a review held without a figure keeps null, not zero", () => {
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", incrementAmount: "" }).data.incrementAmount, null);
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01" }).data.incrementAmount, undefined);
});

test("a review that deliberately awarded nothing keeps its zero", () => {
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", incrementAmount: "0" }).data.incrementAmount, 0);
});

test("only the studio's two marks are stored", () => {
  assert.deepEqual(REVIEW_OUTCOMES, ["Shine", "Shadow"]);
  for (const mark of REVIEW_OUTCOMES) {
    assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", outcome: mark }).success, true, mark);
  }
  // A word from the vocabulary this replaced must not slip in through the API.
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", outcome: "Good" }).success, false);
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", outcome: "shine" }).success, false);
});

test("a review nobody marked is stored unmarked rather than refused", () => {
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", outcome: "" }).data.outcome, null);
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", outcome: null }).data.outcome, null);
});

test("a negative increment is still refused", () => {
  assert.equal(reviewSchema.safeParse({ reviewDate: "2026-03-01", incrementAmount: "-1" }).success, false);
});
