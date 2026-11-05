import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const CARDS = read("components", "hrm", "AdminTimeOffCards.js");
const DASHBOARD = read("components", "hrm", "AdminAttendanceDashboard.js");

test("the administrator's Dashboard ends with who used Casual Leave, permissions and comp-offs", () => {
  // Below Day by Day and By Branch, from the same overview response and its loading and error.
  assert.match(DASHBOARD, /<AdminTimeOffCards timeOff=\{data\?\.timeOff\} loading=\{loading\} error=\{!data \? error : ""\} onRetry=\{reload\} \/>/);
  assert.ok(DASHBOARD.indexOf('title="By Branch"') < DASHBOARD.indexOf("<AdminTimeOffCards"));
  assert.deepEqual([...CARDS.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]), ["Casual Leave", "Permissions", "Comp-offs"]);
});

test("one card to a row on a phone, two on a tablet, three on a wide screen - each in the page's own card shell", () => {
  assert.match(CARDS, /<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">/);
  assert.match(CARDS, /<DashboardCard key=\{card\.key\} title=\{card\.title\} note=\{card\.note\} bodyClassName="p-1\.5">/);
  assert.match(CARDS, /<CardState loading=\{loading\} error=\{error\} onRetry=\{onRetry\} empty=\{!rows\.length\} emptyMessage=\{card\.empty\} rows=\{4\}>/);
  // A long list scrolls inside its card; a long name truncates beside a figure that never wraps.
  assert.match(CARDS, /className="max-h-72 divide-y divide-slate-100 overflow-y-auto"/);
  assert.match(CARDS, /className="min-w-0 truncate text-xs font-medium text-slate-700"/);
  assert.match(CARDS, /className="flex flex-col gap-x-3 sm:flex-row sm:items-baseline sm:justify-between"/);
  assert.match(CARDS, /className=\{`text-xs font-semibold tabular-nums sm:shrink-0 sm:text-right \$\{card\.tone\}`\}/);
  assert.doesNotMatch(CARDS, /<table|<button|apiRequest|fetch\(/);
});

test("a pressed Dashboard card keeps its filter until another card is pressed, or the chip clears it", () => {
  const DASHBOARD = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AdminAttendanceDashboard.js"), "utf8");
  assert.match(DASHBOARD, /onClick=\{\(\) => setView\(card\.key\)\}/);
  assert.doesNotMatch(DASHBOARD, /setView\(pressed \? null|onDoubleClick/);
  assert.match(DASHBOARD, /onClearView=\{\(\) => setView\(null\)\}/);
});

test("Permission is a headline card of its own, beside Absent, and lists the people it counted", () => {
  /*
   * The studio's own reason for it: somebody with an approved hour or two off is read against
   * **Absent** on a day their session falls short, and the figure alone could not tell the two
   * apart. So the days a permission was taken are counted on a card beside Absent, and - the cards
   * being filters on the Employees table rather than links - pressing it lists exactly those people,
   * most first. The figure was already tallied per day, per branch and per employee
   * (`attendance/service.js` `blank()`); nothing here is a second count.
   */
  const cards = [...DASHBOARD.matchAll(/\{ key: "(\w+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(cards, [
    ["present", "Present"], ["absent", "Absent"], ["permission", "Permission"], ["onLeave", "On Leave"],
    ["late", "Late"], ["halfDay", "Half Day"], ["earlyExit", "Early Exit"],
    // The Day by Day strip repeats the same four plus Permission, in the same order.
    ["date", "Date"], ["present", "Present"], ["absent", "Absent"], ["permission", "Permission"], ["onLeave", "On Leave"], ["late", "Late"],
  ]);
  // Approved time off, so a rise is neither good nor bad - no red arrow, as On Leave has none.
  assert.doesNotMatch(DASHBOARD, /\{ key: "permission", label: "Permission", worse/);
  // The table it narrows carries the figure as a column of its own, next to Absent.
  const employees = read("components", "hrm", "AdminAttendanceEmployees.js");
  assert.match(employees, /\{ id: "permission", header: "Permission", accessorFn: \(row\) => row\.permission,/);
  assert.ok(employees.indexOf('id: "permission"') > employees.indexOf('id: "absent"'));
  // Seven cards, seven columns on a wide screen: at six the seventh sat alone on a row of its own,
  // which reads as a card belonging to something else. The `lg` step breaks it 4 + 3, not 3 + 3 + 1.
  assert.match(DASHBOARD, /className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"/);
  assert.equal(cards.filter(([key]) => key !== "date").length - 5, 7, "seven headline cards, and the strip's five");
  // Pressing a card filters by that key and orders by it - the one rule every card shares.
  assert.match(employees, /return rows\.filter\(\(row\) => Number\(row\[key\] \|\| 0\) > 0\)\.sort\(\(a, b\) => Number\(b\[key\] \|\| 0\) - Number\(a\[key\] \|\| 0\)\);/);
});
