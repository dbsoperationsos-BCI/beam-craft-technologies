import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { irregularityNote, irregularityTabs, pendingRequestLabel, requestSummary } from "../src/lib/attendanceRegisterCards.mjs";

/*
 * The Attendance Register's Irregularities and Request cards.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const PAGE = read("components", "hrm", "AttendanceRegisterPage.js");
const CARDS = read("components", "hrm", "RegisterAttentionCards.js");

test("an irregularity says why, which day when it is not the one shown, and a request still pending", () => {
  assert.equal(irregularityNote({ date: "2026-10-12", loggedIn: false }, "2026-10-12"), "No login, no approved leave");
  assert.equal(irregularityNote({ date: "2026-10-12", loggedIn: true, pendingRequest: "LEAVE" }, "2026-10-12"), "Logged in, but not enough for a half day");
  // A pending request is said apart, as a pill.
  assert.equal(pendingRequestLabel({ pendingRequest: "LEAVE" }), "Leave request pending");
  assert.equal(pendingRequestLabel({ pendingRequest: "COMP_OFF" }), "Comp-off request pending");
  assert.equal(pendingRequestLabel({ pendingRequest: null }), "");
  assert.equal(irregularityNote({ date: "2026-10-11", flexible: true, loggedIn: false }, "2026-10-12"), "No login, no approved leave · Flexible shift, 11 Oct");
});

test("a waiting request says its kind and its days or hours", () => {
  const labels = { LEAVE: "Leave", PERMISSION: "Permission", COMP_OFF: "Comp-off" };
  assert.equal(requestSummary({ type: "LEAVE", leaveType: "CL", fromDate: "2026-10-14", toDate: "2026-10-15" }, labels), "Leave (CL) · 14 Oct - 15 Oct");
  assert.equal(requestSummary({ type: "PERMISSION", fromDate: "2026-10-14", toDate: "2026-10-14", fromTime: "10:00", toTime: "11:30" }, labels), "Permission · 14 Oct, 10:00 - 11:30");
  assert.equal(requestSummary({ type: "COMP_OFF", fromDate: "2026-10-20", toDate: "2026-10-20" }, labels), "Comp-off · 20 Oct");
});

test("the two cards sit under Today's Attendance, the Request card on the Waiting for me rule", () => {
  // Below Today's Attendance - the day's roster first, then what needs acting on.
  assert.match(PAGE, /<TodaysAttendance rows=\{rows\}[^\n]*\/>\s+<\/div>\s+<div className="mt-3">\s+<RegisterAttentionCards/);
  assert.match(PAGE, /getAttendanceRequests\(\{ scope: "team" \}\)\s+\.then\(\(response\) => setWaitingRequests\(\(response\?\.data \|\| \[\]\)\.filter\(awaitsMe\)\)\)/);
  assert.match(CARDS, /<div className="grid gap-3 md:grid-cols-2">/);
  assert.match(CARDS, /title=\{`Irregularities\$\{/);
  assert.match(CARDS, /title=\{`Request\$\{/);
  // The shared card shell and its empty / loading / error states - no hand-rolled ones.
  assert.match(CARDS, /import DashboardCard, \{ CardState \} from "@\/components\/shared\/DashboardCard";/);
  assert.doesNotMatch(CARDS, /<button|<table|apiRequest|fetch\(/);
  // A register that failed to load says so, rather than "Nobody is absent".
  assert.match(CARDS, /<CardState loading=\{loading\} error=\{error\} onRetry=\{onRetry\} empty=\{!shown\.items\.length\}/);
  assert.match(PAGE, /error=\{register \? "" : loadError\}\s+onRetry=\{load\}/);
});

test("Irregularities splits in two tabs: fixed shifts under Today, flexible shifts under Yesterday", () => {
  const items = [
    { employeeId: 1, date: "2026-10-12", flexible: false },
    { employeeId: 2, date: "2026-10-11", flexible: true },
    { employeeId: 3, date: "2026-10-12" },
  ];
  const [today, yesterday] = irregularityTabs(items);
  assert.deepEqual([today.id, today.label, yesterday.id, yesterday.label], ["today", "Today", "yesterday", "Yesterday"]);
  assert.deepEqual(today.items.map((item) => item.employeeId), [1, 3]);
  assert.deepEqual(yesterday.items.map((item) => item.employeeId), [2]);
  assert.deepEqual(irregularityTabs(undefined).map((tab) => tab.items.length), [0, 0], "a register not loaded yet is two empty tabs");
});
