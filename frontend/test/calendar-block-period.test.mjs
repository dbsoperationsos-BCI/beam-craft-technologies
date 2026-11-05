import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sourceScheduleEntries } from "../src/lib/meetingSources.js";

/*
 * Calendar → a day's ⋮ → Block Period: a branch, the day, from and to, and why - offered only to a
 * writer of SALES / Block Period, shown whatever source is picked, and freed from its details.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const page = read("components", "sales", "MeetingsPage.js");
const dialog = read("components", "sales", "BlockPeriodDialog.js");

test("offered in a day's ⋮ only to a writer of SALES / Block Period, and opened on that day", () => {
  assert.match(page, /hasPermission\("SALES", "Block Period", "READ_WRITE"\) \? \[\{ kind: "block", label: "Block Period" \}\]/);
  assert.match(page, /\{dayAction\?\.kind === "block" && <BlockPeriodDialog\s+date=\{dayAction\.day\}/);
});

test("asks for the branch, the date, from and to, and the reason - and posts them", () => {
  for (const label of ["Branch", "Date", "From", "To", "Reason"]) assert.match(dialog, new RegExp(`label="${label}"(?: helperText="[^"]*")? required`));
  assert.match(dialog, /createCalendarBlock\(\{\s*branchId: Number\(values\.branchId\),\s*date: values\.date,\s*startTime: values\.startTime,\s*endTime: values\.endTime,\s*reason: values\.reason\.trim\(\),\s*\}\)/);
  // Each mistake said under its own field, before anything is sent.
  assert.match(dialog, /values\.startTime && values\.endTime <= values\.startTime \? "End after the start time\."/);
  for (const field of ["branchId", "date", "startTime", "endTime", "reason"]) assert.match(dialog, new RegExp(`error=\\{errors\\.${field}\\}`));
  assert.match(read("services", "schedule", "calendarBlocks.service.js"), /const ROOT = "\/api\/schedule\/blocks";/);
});

test("a block shows whatever source is picked, as a holiday does", () => {
  const entries = [{ id: "block:1", kind: "block" }, { id: "meeting:1", kind: "meeting" }, { id: "shoot:1", kind: "shoot" }];
  assert.deepEqual(sourceScheduleEntries("meetings", entries).map((entry) => entry.id), ["block:1", "meeting:1"]);
  assert.deepEqual(sourceScheduleEntries("projects", entries).map((entry) => entry.id), ["block:1", "shoot:1"]);
});

test("freed from its details only by a writer, after a confirm", () => {
  assert.match(page, /const canFreeBlocks = hasPermission\("SALES", "Block Period", "READ_WRITE"\);/);
  assert.match(page, /\{panelEntry\.kind === "block" && canFreeBlocks && \(/);
  assert.match(page, /await removeCalendarBlock\(freeing\.meta\?\.blockId\);/);
});

test("a Duration under From sets To from it, follows From, and To set by hand is kept", () => {
  for (const label of ["15 min", "30 min", "45 min", "1 hr", "2 hr", "3 hr"]) assert.match(dialog, new RegExp(`label: "${label}"`));
  assert.match(dialog, /if \(value && values\.startTime\) change\("endTime", plus\(values\.startTime, value\)\);/);
  assert.match(dialog, /if \(duration && value\) change\("endTime", plus\(value, duration\)\);/);
  assert.match(dialog, /setDuration\(match \? match\.value : ""\);/);
  // It ends on its own day.
  assert.match(dialog, /Math\.min\(toMinutes\(time\) \+ Number\(duration\), 23 \* 60 \+ 59\)/);
  // And it is not sent: the request carries From and To only.
  assert.doesNotMatch(dialog, /duration: /);
});
