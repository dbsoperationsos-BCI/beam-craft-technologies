import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * `DateField` answering a date *and* a time.
 *
 * There were two native `datetime-local` inputs in the whole application - the CRD document's
 * event start and end - and they were native for one reason: this field had no time, so it could
 * not express the question. A native picker beside eight of these reads as a different application,
 * looks different in every browser, and takes none of the bounds `restriction` / `minDate` /
 * `maxDate` express.
 *
 * Read from the source rather than by rendering: the suites here run as plain Node with no DOM, and
 * what is worth pinning is the contract - the value's shape, that the calendar is given the date
 * half alone, and that nothing changes for the callers who do not ask for a time.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const FIELD = read("components", "shared", "DateField.js");

test("the value is the date key with the time after a T", () => {
  // The shape `<input type="datetime-local">` itself uses, and the one the CRD document already
  // stored - so nothing had to be migrated when the control changed.
  assert.match(FIELD, /`\$\{nextDateKey\}T\$\{draftTime \|\| DEFAULT_TIME\}`/);
  assert.match(FIELD, /const DEFAULT_TIME = "00:00"/);
});

test("a date chosen with no time still commits", () => {
  /*
   * The studio's own data has dates with no time all through it, and a calendar that will not close
   * until somebody sets a clock is a calendar people fight. Midnight is the answer, and it is what
   * the documents already held.
   */
  assert.match(FIELD, /draftTime \|\| DEFAULT_TIME/);
});

test("clearing the date clears the whole value, never a time on its own", () => {
  // `nextDateKey &&` guards the composition: a time with no day is not an answer.
  assert.match(FIELD, /onChange\?\.\(nextDateKey && withTime \? `[^`]+` : nextDateKey\)/);
  assert.match(FIELD, /onClear=\{\(\) => commit\(""\)\}/);
});

test("the calendar is given the date half alone", () => {
  /*
   * `CalendarPanel` parses a `YYYY-MM-DD` key. Handed the whole value it would read
   * "2026-09-08T22:30" as no date at all and open on today with nothing selected - the field
   * forgetting the day it is showing, every time it is opened.
   */
  assert.match(FIELD, /<CalendarPanel[\s\S]*?value=\{datePart\}/);
});

test("nothing changes for a caller that does not ask for a time", () => {
  // Every existing `DateField` passes a plain `YYYY-MM-DD` and must keep getting one back.
  assert.match(FIELD, /withTime = false/);
  assert.match(FIELD, /const displayValue = \(value, withTime\) =>[\s\S]{0,120}?: value\);/);
});

test("the time is re-seeded from the value each time the popover opens", () => {
  // Otherwise reopening a field shows the last time somebody typed and cancelled out of, rather
  // than the one the field holds.
  assert.match(FIELD, /if \(!open\) \{\s*measure\(\);\s*setDraftTime\(timePart \|\| DEFAULT_TIME\);/);
});

test("read-only loses the calendar, because there is none to open", () => {
  // `readOnly` is a value being read back - `TextField`'s own grey, no icon pointing at a list
  // nobody can open. `disabled` keeps the icon: it is a control waiting on an earlier answer.
  assert.match(FIELD, /if \(readOnly \|\| disabled\) return;/);
  assert.match(FIELD, /readOnly\s*\?\s*<span[^>]*bg-slate-100/);
});

test("the CRD document's two date fields use it, and are the only ones that needed to", () => {
  const form = read("components", "sales", "PublicCrdDocumentFormDumDum.js");
  for (const label of ["Event Start Date & Time", "Event End Date & Time"]) {
    const control = form.match(new RegExp(`<DateField[^>]*label="${label}"[^>]*/>`));
    assert.ok(control, `"${label}" is no longer a DateField`);
    assert.match(control[0], /\bwithTime\b/);
  }
  // And the native picker has gone from the application entirely.
  const sources = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) sources.push(full);
  });
  walk(path.join(process.cwd(), "src"));
  const offenders = sources.filter((file) => /type="datetime-local"/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], "a native datetime-local input is back; use DateField withTime");
});
