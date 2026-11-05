import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Calendar → a day's ⋮: Add Meet, Create Project, Block Period and Raise Request,
 * each offered only to somebody holding what its own endpoint asks for, each opening with the day
 * already set.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const page = read("components", "sales", "MeetingsPage.js");

test("each action is offered on the permission its endpoint asks for", () => {
  assert.match(page, /hasPermission\("SALES", "CRM Leads", "READ_WRITE"\) \? \[\{ kind: "meet", label: "Add Meet" \}\]/);
  assert.match(page, /hasPermission\("SALES", "Sales Manager", "READ_WRITE"\) \? \[\{ kind: "project", label: "Create Project" \}\]/);
  assert.match(page, /!isAdministrator && \(hasPermission\("HRM", "Requests", "READ"\) \|\| hasPermission\("HRM", "Employee Attendance", "READ"\)\) \? \[\{ kind: "request", label: "Raise Request" \}\]/);
  // No Schedule Interview: interviews are scheduled from the Interview register.
  assert.doesNotMatch(page, /label: "Schedule Interview"|ScheduleInterviewForDay/);
});

test("a ⋮ in place of the +, and none where nothing is permitted; the cell itself starts nothing", () => {
  assert.match(page, /\{dayActions\.length > 0 && <span[^>]*>\s*<OptionsMenu/);
  assert.doesNotMatch(page, /onClick=\{canWrite \? \(\) => setAddMeetDate\(cell\.key\)/);
  assert.doesNotMatch(page, />\s*\+\s*<\/span>/);
});

test("each opens with the day set", () => {
  assert.match(page, /if \(kind === "meet"\) \{ setAddMeetDate\(day\); setAddMeetTime\(time\); return; \}/);
  assert.match(page, /prefill=\{\{ mainEventDateKnown: true, mainEventDate: dayAction\.day \}\}/);
  assert.match(page, /prefill=\{dayAction\?\.kind === "request" \? \{ fromDate: dayAction\.day, toDate: dayAction\.day \} : null\}/);
  assert.match(read("components", "hrm", "RaiseRequestLauncher.js"), /prefill=\{prefill\}/);
});
