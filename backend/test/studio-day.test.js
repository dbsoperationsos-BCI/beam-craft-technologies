const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The studio's day is Asia/Kolkata, midnight to midnight.
 *
 * Every measured timestamp is stored as UTC, and the reports used to bound a range and group a day
 * on those raw values - so "23 Sept" ran from 05:30 on the 23rd to 05:29 on the 24th in the studio's
 * own clock, and an early-morning sitting was filed under the day before. One helper now says what
 * a day is, and every reader of measured time goes through it.
 */

const { studioDayStart, studioDayEnd, studioDaySql, STUDIO_OFFSET } = require("../src/services/studioDay");
const { dayStart, dayEnd } = require("../src/modules/sales/crm-reports/filters");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8").replace(/\\/g, "");
const REPORTS = read("modules", "sales", "crm-reports", "service.js");
const ATTENDANCE = read("modules", "schedule", "attendance", "service.js");

test("a studio day is bounded by the UTC instants it starts and ends at", () => {
  assert.equal(STUDIO_OFFSET, "+05:30");
  assert.equal(studioDayStart("2026-09-23"), "2026-09-22 18:30:00.000");
  assert.equal(studioDayEnd("2026-10-22"), "2026-10-22 18:29:59.999");
  // Nothing chosen is nothing, not a bound.
  assert.equal(studioDayStart(""), "");
  assert.equal(studioDayEnd(undefined), "");
  // Not a day at all is not guessed at - neither the wrong shape nor a day the calendar lacks, which
  // has the right shape and no date behind it. A bound that threw would fail the report instead.
  assert.equal(studioDayStart("yesterday"), "");
  assert.equal(studioDayStart("2026-02-31"), "");
  assert.equal(studioDayEnd("2026-02-31"), "");
  // The year's edges and a leap day cross into the right neighbours.
  assert.equal(studioDayStart("2026-01-01"), "2025-12-31 18:30:00.000");
  assert.equal(studioDayEnd("2026-12-31"), "2026-12-31 18:29:59.999");
  assert.equal(studioDayStart("2028-02-29"), "2028-02-28 18:30:00.000");
  // Adjacent days meet with nothing between them and nothing shared.
  assert.ok(studioDayEnd("2026-09-23") < studioDayStart("2026-09-24"));
});

test("the reports bound their ranges on the studio's day", () => {
  assert.equal(dayStart("2026-09-23"), "2026-09-22 18:30:00.000");
  assert.equal(dayEnd("2026-10-22"), "2026-10-22 18:29:59.999");
});

test("a stored UTC timestamp is filed under the studio's day in SQL", () => {
  assert.equal(studioDaySql("`s`.`started_at`"), "DATE(CONVERT_TZ(`s`.`started_at`, '+00:00', '+05:30'))");
});

test("every reader of measured time groups by the studio's day, not the UTC one", () => {
  // Application Usage and WhatsApp Usage (measuredUsage), Work Hours (both halves), and the Summary's
  // calls-by-day all file a row under a day. None of them may read the day off the raw column.
  assert.doesNotMatch(REPORTS, /DATE\(`s`\.`started_at`\)/, "a reports query groups app stretches by the UTC day again");
  assert.doesNotMatch(REPORTS, /DATE\(`c`\.`called_at`\)/, "a reports query groups calls by the UTC day again");
  // Exactly the four groupings the file has today - measuredUsage, workHours, callHoursByDay and the
  // Summary's calls-by-day. A fifth is fine; it should be added here, so this stays a list of them.
  assert.equal((REPORTS.match(/studioDaySql\(/g) || []).length, 4, "the count of day groupings changed - add the new one to this list");
  // Attendance derives Present from the same stretches and says it must agree with Work Hours.
  assert.doesNotMatch(ATTENDANCE, /DATE\(`s`\.`started_at`\)/, "attendance files a stretch under the UTC day again");
  assert.match(ATTENDANCE, /studioDaySql\(/);
  assert.match(ATTENDANCE, /studioDayStart\(from\)/);
  assert.match(ATTENDANCE, /studioDayEnd\(to\)/);
  assert.doesNotMatch(ATTENDANCE, /\$\{from\} 00:00:00/, "attendance bounds its range on a bare day again");
});
