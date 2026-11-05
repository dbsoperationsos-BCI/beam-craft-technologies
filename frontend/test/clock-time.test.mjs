import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { toTwelveHourClock } from "../src/lib/clockTime.mjs";

/*
 * The Calls board was the one column in the application on a 24-hour clock.
 *
 * Callyzer sends `call_time` as "17:49:41". The board trimmed it to the minute and showed it as it
 * arrived, so Call Time read "17:49" in a CRM whose every other time - a lead's Added Time, an
 * activity stamp, a follow-up - is written "10:08 am". Nothing was broken and nothing errored; it
 * was simply the one place the studio had to translate in their head.
 */

test("a 24-hour time is put on the 12-hour clock", () => {
  assert.equal(toTwelveHourClock("17:49"), "05:49 pm");
  assert.equal(toTwelveHourClock("09:05"), "09:05 am");
  // Seconds are dropped: the column is read to the minute, and Callyzer sends them.
  assert.equal(toTwelveHourClock("17:49:41"), "05:49 pm");
});

test("noon and midnight, which are where a 12-hour clock goes wrong", () => {
  /*
   * `hours % 12` is 0 for both, so the naive version prints "00:00 am" for midnight and "00:30 pm"
   * for half past twelve - an hour that does not exist on the clock anybody reads.
   */
  assert.equal(toTwelveHourClock("00:00"), "12:00 am");
  assert.equal(toTwelveHourClock("00:30"), "12:30 am");
  assert.equal(toTwelveHourClock("12:00"), "12:00 pm");
  assert.equal(toTwelveHourClock("12:30"), "12:30 pm");
  assert.equal(toTwelveHourClock("23:59"), "11:59 pm");
});

test("a time that is already 12-hour is normalised, not rebuilt", () => {
  /*
   * The lead boards store the meridiem and the Calls board does not, and one renderer answers for
   * both - so the same column would otherwise show "9:45PM" against one row and "05:49 pm" against
   * the next.
   */
  assert.equal(toTwelveHourClock("09:45 pm"), "09:45 pm");
  assert.equal(toTwelveHourClock("9:45PM"), "09:45 pm");
  assert.equal(toTwelveHourClock("9:45 p.m."), "09:45 pm");
  assert.equal(toTwelveHourClock("12:05 am"), "12:05 am");
  assert.equal(toTwelveHourClock("12:05 pm"), "12:05 pm");
});

test("the hour is two digits, so the column lines up down the page", () => {
  // A column where some rows are "9:05 am" and others "10:08 am" is one the eye cannot run down.
  assert.equal(toTwelveHourClock("09:05"), "09:05 am");
  assert.equal(toTwelveHourClock("13:05"), "01:05 pm");
});

test("anything that is not a clock time is refused rather than guessed at", () => {
  /*
   * Refused rather than mangled, because the caller has a second reading to fall back on - a full
   * timestamp put through the CRM's own formatter. A helper that returned something for every input
   * would take that fallback away and print nonsense in its place.
   */
  assert.equal(toTwelveHourClock(""), "");
  assert.equal(toTwelveHourClock(null), "");
  assert.equal(toTwelveHourClock("2026-08-24"), "");
  assert.equal(toTwelveHourClock("2026-08-24T17:49:00.000Z"), "");
  assert.equal(toTwelveHourClock("this afternoon"), "");
  // Not a time on any clock.
  assert.equal(toTwelveHourClock("24:00"), "");
  assert.equal(toTwelveHourClock("17:71"), "");
  assert.equal(toTwelveHourClock("13:00 pm"), "");
  assert.equal(toTwelveHourClock("00:30 am"), "");
});

test("no zone is applied, because a bare clock time has no day to apply one to", () => {
  /*
   * The trap this avoids, and it is the reason the conversion is arithmetic rather than a `Date`
   * put through `Intl`. "17:49" carries no date and no offset; parsing it would make the runtime
   * pick a day, and formatting it in Asia/Kolkata would then shift it - 17:49 becoming 12:19 pm,
   * which is wrong in a way that looks entirely plausible on the screen.
   */
  const source = fs.readFileSync(new URL("../src/lib/clockTime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new Date\(/);
  assert.doesNotMatch(source, /Intl\./);
  assert.doesNotMatch(source, /timeZone/);
});

test("the CRM's time column is drawn through it", () => {
  // Rendered from one place for every board, which is what makes the Calls board agree with the
  // lead boards - and what carries the same clock into the info panel and the CSV export.
  const crm = fs.readFileSync(new URL("../src/components/sales/CRMPage.js", import.meta.url), "utf8");
  const formatter = crm.slice(crm.indexOf("function formatAddedTime"), crm.indexOf("function formatClockTime"));
  assert.match(formatter, /const clock = toTwelveHourClock\(stored\);/);
  assert.match(formatter, /if \(clock\) return clock;/);
  // The old test - "it has a colon in it, show it as written" - is what let 24-hour times through.
  assert.doesNotMatch(formatter, /return stored\.toLowerCase\(\);/);
});
