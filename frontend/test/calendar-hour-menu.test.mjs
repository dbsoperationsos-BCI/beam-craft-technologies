import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Calendar → Day: an hour's ⋮ opens Add Meet and Block Period starting at that hour - seeded, so it
 * can still be changed in the dialog.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const page = read("components", "sales", "MeetingsPage.js");

test("Add Meet starts at the hour", () => {
  assert.match(page, /if \(kind === "meet"\) \{ setAddMeetDate\(day\); setAddMeetTime\(time\); return; \}/);
  assert.match(page, /initialTime=\{addMeetTime\}/);
  assert.match(read("components", "sales", "ScheduleMeetDialog.js"), /useState\(\(\) => emptyForm\(initialDate, initialTime\)\)/);
});

test("Block Period starts at the hour", () => {
  assert.match(page, /setDayAction\(\{ kind, day, time \}\)/);
  assert.match(page, /<BlockPeriodDialog\s+date=\{dayAction\.day\}\s+startTime=\{dayAction\.time\}/);
  assert.match(read("components", "sales", "BlockPeriodDialog.js"), /\{ branchId: "", date, startTime, endTime: "", reason: "" \}/);
});
