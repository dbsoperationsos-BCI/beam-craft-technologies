const test = require("node:test");
const assert = require("node:assert/strict");

const { quoteForDate, weekdayOf } = require("../src/modules/hrm/attendance/quotes");

/**
 * The line shown after a check-in.
 *
 * Two properties matter and neither is obvious from reading the function: the same day always picks
 * the same line, and consecutive days do not walk the list in order. The first is what stops the
 * quote shuffling while somebody reads it; the second is what stops three Mondays showing an
 * obvious cycle.
 */

const monday = [
  { id: 1, quote: "Start the week with purpose, not pressure." },
  { id: 2, quote: "The first hour of Monday sets the other thirty-nine." },
  { id: 3, quote: "Begin with the thing you are avoiding." },
];

test("a weekday is read from the written date, not from an instant", () => {
  // 2026-09-14 is a Monday. Read as the day it says, so a server east or west of UTC agrees.
  assert.equal(weekdayOf("2026-09-14"), 1);
  assert.equal(weekdayOf("2026-09-13"), 0);
  assert.equal(weekdayOf("2026-09-19"), 6);
  assert.equal(weekdayOf("not a date"), null);
  assert.equal(weekdayOf(null), null);
});

test("the same day always picks the same line", () => {
  const first = quoteForDate(monday, "2026-09-14");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assert.deepEqual(quoteForDate(monday, "2026-09-14"), first);
  }
  assert.ok(monday.includes(first));
});

test("consecutive weeks do not walk the list in order", () => {
  // Four consecutive Mondays. A hash that simply incremented would give 1,2,3,1 — a cycle anybody
  // would notice by the third week. This asserts they are not in the list's own order.
  const picks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"].map((iso) => quoteForDate(monday, iso).id);
  assert.notDeepEqual(picks, [1, 2, 3, 1]);
  assert.notDeepEqual(picks, [monday[0].id, monday[1].id, monday[2].id, monday[0].id]);
});

test("no quote written for the day is a card without a line, never an error", () => {
  // A check-in must not fail because nobody has written anything for a Thursday.
  assert.equal(quoteForDate([], "2026-09-14"), null);
  assert.equal(quoteForDate(null, "2026-09-14"), null);
  assert.equal(quoteForDate(undefined, "2026-09-14"), null);
  // Rows that somehow hold no text are skipped rather than shown blank.
  assert.equal(quoteForDate([{ id: 9, quote: "" }], "2026-09-14"), null);
});

test("a date it cannot read still answers something", () => {
  // Better a line than a crash: the quote is decoration on a card that reports a recorded fact.
  assert.deepEqual(quoteForDate(monday, "nonsense"), monday[0]);
  assert.deepEqual(quoteForDate(monday, null), monday[0]);
});
