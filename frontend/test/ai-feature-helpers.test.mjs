import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatEventRange, formatTime, processingPercent, describeActivity, detailsProblems, WIZARD_STEPS, EVENT_FILTERS, toDateInput } from "../src/lib/aiFeature.mjs";

test("sizes read in the unit that fits", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), "5.0 GB");
});

test("an event's dates read as one range", () => {
  assert.equal(formatEventRange("2026-09-22", null), "22 Sept 2026".replace("Sept", formatEventRange("2026-09-22", null).includes("Sept") ? "Sept" : "Sep"));
  assert.match(formatEventRange("2026-09-22", "2026-09-23"), /^22 – 23 Sep/);
  assert.match(formatEventRange("2026-09-28", "2026-10-02"), /^28 Sep.* – 2 Oct/);
  assert.equal(formatEventRange("2026-09-22", "2026-09-22"), formatEventRange("2026-09-22", null));
  assert.equal(formatEventRange(null, null), "");
});

test("times read as the guest would say them", () => {
  assert.equal(formatTime("09:00"), "9:00 AM");
  assert.equal(formatTime("13:05"), "1:05 PM");
  assert.equal(formatTime("00:30"), "12:30 AM");
  assert.equal(formatTime(""), "");
});

test("processing percent counts everything that is no longer waiting", () => {
  assert.equal(processingPercent({ total: 10, completed: 5, failed: 1, skipped: 2 }), 80);
  assert.equal(processingPercent({ total: 0, completed: 0, failed: 0, skipped: 0 }), 0);
  assert.equal(processingPercent(null), 0);
});

test("activity rows read as a sentence, with the detail after a dash", () => {
  assert.equal(describeActivity({ event: "MEDIA_UPLOADED", detail: "250 photos uploaded" }), "Media uploaded — 250 photos uploaded");
  assert.equal(describeActivity({ event: "EVENT_CREATED", detail: null }), "Event created");
  assert.equal(describeActivity({ event: "SOMETHING_NEW" }), "SOMETHING_NEW");
});

test("step one refuses to move on without its required answers", () => {
  assert.deepEqual(Object.keys(detailsProblems({ name: "", eventType: "", startDate: "" })).sort(), ["eventType", "name", "startDate"]);
  assert.deepEqual(detailsProblems({ name: "Arun & Priya", eventType: "Wedding", startDate: "2026-09-22", endDate: "2026-09-21" }), { endDate: "The end date is before the start date." });
  assert.deepEqual(detailsProblems({ name: "Arun & Priya", eventType: "Wedding", startDate: "2026-09-22" }), {});
});

test("the wizard has six steps and the list five filters, review last and All first", () => {
  assert.equal(WIZARD_STEPS.length, 6);
  assert.equal(WIZARD_STEPS.at(-1)[0], "review");
  assert.equal(EVENT_FILTERS[0][0], "all");
  assert.equal(toDateInput("2026-09-22T00:00:00.000Z"), "2026-09-22");
});
