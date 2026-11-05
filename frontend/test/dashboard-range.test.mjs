import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RANGE, RANGE_OPTIONS, formatBytes, formatCompact, number, periodPhrase, previousLabel, previousPhrase, relativeTime, trendOf, unitLabel } from "../src/lib/dashboardRange.mjs";
import * as imageSelection from "../src/lib/imageSelectionDashboard.mjs";

test("every module dashboard offers the same five ranges and opens on This Month", () => {
  assert.deepEqual(RANGE_OPTIONS.map((option) => option.value), ["lifetime", "month", "week", "3m", "6m"]);
  assert.equal(DEFAULT_RANGE, "month");
  assert.equal(periodPhrase("month"), "this month");
  assert.equal(previousPhrase("week"), "vs last week");
  assert.equal(previousLabel("3m"), "3 Months Ago");
  assert.equal(previousLabel("lifetime"), null);
});

test("an arrow is a direction and a signed figure", () => {
  assert.deepEqual(trendOf(-3), { direction: "down", text: "-3" });
  assert.deepEqual(trendOf(1200), { direction: "up", text: "+1,200" });
  assert.deepEqual(trendOf(0), { direction: "flat", text: "0" });
});

test("a unit follows its count, singular at one, as a suffixed word or as a given pair", () => {
  assert.equal(unitLabel(1, "Album"), "Album");
  assert.equal(unitLabel(2, "Album"), "Albums");
  assert.equal(unitLabel(1, ["Person", "People"]), "Person");
  assert.equal(unitLabel(0, ["Person", "People"]), "People");
  assert.equal(unitLabel(4, null), "");
});

test("the formatters every dashboard shares", () => {
  assert.equal(number(1234567), "12,34,567");
  assert.equal(formatCompact(248000), "248K");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(relativeTime(null), "—");
});

test("the Image Selection dashboard keeps the same words through its own module", () => {
  assert.equal(imageSelection.RANGE_OPTIONS, RANGE_OPTIONS);
  assert.equal(imageSelection.trendOf, trendOf);
  assert.equal(imageSelection.relativeTime, relativeTime);
  assert.equal(imageSelection.unitLabel, unitLabel);
});
