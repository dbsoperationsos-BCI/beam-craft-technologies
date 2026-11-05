import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dayLabel } from "../src/lib/attendanceTime.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const CARD = read("components", "hrm", "AttendanceBalancesCard.js");
const PAGE = read("components", "hrm", "EmployeeAttendancePage.js");

test("the employee's own dashboard shows what is left to take, right under Your attendance", () => {
  assert.match(PAGE, /<AttendanceTotals totals=\{totals\} \/>\r?\n.*\r?\n\s+<div className="mt-3"><AttendanceBalancesCard \/><\/div>/);
  // Both cards draw their figures with the one shared tile.
  assert.match(PAGE, /<StatTile key=\{label\} label=\{label\} value=\{value \?\? 0\} tone=\{tone\} \/>/);
  assert.match(CARD, /import StatTile from "@\/components\/shared\/StatTile";/);
  /*
   * The card above is **Your attendance**, which is what the strip is: the days the range owed and
   * how each of them went. It was headed "How the range went" - a title that named nothing in it,
   * since every card on this screen is about the range, and read as a verdict on the range rather
   * than as the reader's own record. The note names both figures, where "Worked 157h 17m of 127h
   * 30m" left the second to be guessed at.
   */
  assert.match(PAGE, /title="Your attendance"/);
  assert.match(PAGE, /note=\{`\$\{formatTotalMinutes\(totals\.workedMinutes\)\} worked of \$\{formatTotalMinutes\(totals\.targetMinutes\)\} expected`\}/);
  assert.doesNotMatch(PAGE, /title="How the range went"/);
});

test("Casual Leave and Permissions side by side on a phone and a tablet, comp-offs on the row below; one row on a laptop", () => {
  assert.match(CARD, /<div className="grid grid-cols-2 items-start gap-2 lg:grid-cols-3">/);
  assert.match(CARD, /className="col-span-2 lg:col-span-1"\r?\n\s+label="Comp-offs to claim"/);
  assert.ok(CARD.indexOf('label="Casual Leave"') < CARD.indexOf('label="Permissions left"'));
  assert.ok(CARD.indexOf('label="Permissions left"') < CARD.indexOf('label="Comp-offs to claim"'));
});

test("read from the answers the Raise Request form reads, each comp-off with the day it lapses", () => {
  assert.match(CARD, /Promise\.allSettled\(\[getMyLeaveBalance\(\), getMyPermissionUsage\(\{ date: isoDate\(new Date\(\)\) \}\), getMyCompOffOptions\(\)\]\)/);
  assert.match(CARD, /`Use by \$\{dayLabel\(option\.expiresOn\)\}/);
  assert.equal(dayLabel("2026-11-04"), "4 Nov 2026");
  // Permissions left is the limit less those used, never below none - and none left is said in words.
  assert.match(CARD, /Math\.max\(0, permission\.limit - permission\.used\)/);
  assert.match(CARD, /"None left - "/);
  // A long list stops at three; one that failed says so with its own Try again.
  assert.match(CARD, /claimable\.slice\(0, COMP_OFFS_SHOWN\)/);
  assert.match(CARD, /<p role="alert">Couldn&apos;t load\. <Button/);
  assert.doesNotMatch(CARD, /<table|<button|apiRequest|fetch\(|text-slate-400/);
});
