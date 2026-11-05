const test = require("node:test");
const assert = require("node:assert/strict");
const { rangeBounds, RANGE_KEYS, RANGE_LABELS, DEFAULT_RANGE, dashboardQuerySchema } = require("../src/services/dashboardRange");
const imageSelection = require("../src/modules/image-selection/dashboard/service");

// 15 Sep 2026, 15:30 IST — a Tuesday afternoon in the studio's day.
const NOW = new Date("2026-09-15T10:00:00.000Z");

test("the one range vocabulary every dashboard shares", () => {
  assert.deepEqual(RANGE_KEYS, ["lifetime", "month", "week", "3m", "6m"]);
  assert.deepEqual(RANGE_KEYS.map((key) => RANGE_LABELS[key]), ["Lifetime", "This Month", "This Week", "3 Months", "6 Months"]);
  assert.equal(DEFAULT_RANGE, "month");
});

test("a month starts on the studio's 1st and ends after today", () => {
  const month = rangeBounds("month", NOW);
  assert.equal(month.from.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(month.to.toISOString(), "2026-09-15T18:30:00.000Z");
  assert.equal(month.label, "This Month");
});

test("an unknown key falls back to this month", () => {
  assert.equal(rangeBounds("year", NOW).key, "month");
});

test("the query schema refuses a range the picker has no option for", () => {
  assert.equal(dashboardQuerySchema.safeParse({ range: "year" }).success, false);
  assert.equal(dashboardQuerySchema.parse({}).range, "month");
});

test("the Image Selection dashboard answers with the same helper", () => {
  assert.equal(imageSelection.rangeBounds, rangeBounds);
  assert.equal(imageSelection.RANGE_KEYS, RANGE_KEYS);
});
