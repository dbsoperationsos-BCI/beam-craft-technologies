import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const PAGE = fs.readFileSync(new URL("../src/components/employees/EmployeeVerificationPage.js", import.meta.url), "utf8");
const LIST = fs.readFileSync(new URL("../src/components/shared/SideFilterList.js", import.meta.url), "utf8");

test("Pending sits second, right after All, and the other tabs keep their order", () => {
  const order = ["All", "Pending", "Active", "Serving Notice", "Employee Submission Pending", "HR Onboarding Pending", "Incomplete Profiles", "Review Pending", "InActive"];
  let at = -1;
  for (const label of order) {
    const next = PAGE.indexOf(`{ label: "${label}",`, at + 1);
    assert.ok(next > at, `${label} is missing or out of order`);
    at = next;
  }
});

test("Review Pending is listed only down the Pending tab's side, not in the tab bar", () => {
  assert.match(PAGE, /\{ label: "Review Pending", filter: isReviewPending, pendingOnly: true \}/);
  assert.match(PAGE, /const barTabs = tabs\.filter\(\(tab\) => !tab\.pendingOnly\);/);
  assert.match(PAGE, /tabs=\{barTabs\.map\(/);
  assert.match(PAGE, /useStickyTab\("employee-repository", "All", barTabs\.map\(/);
  assert.match(PAGE, /const selectedTab = barTabs\.find\(/);
});

test("Pending holds whoever any pending tab holds, and lists each kind down its side", () => {
  assert.match(PAGE, /const PENDING_KIND_LABELS = \["Employee Submission Pending", "HR Onboarding Pending", "HR Offboarding Pending", "Review Pending"\];/);
  assert.match(PAGE, /\{ label: "Pending", filter: \(row, payslipNeeds\) => PENDING_KINDS\.some\(\(kind\) => matchesTab\(kind, row, payslipNeeds\)\) \}/);
  assert.match(PAGE, /useStickyTab\("employee-repository-pending", ALL_PENDING, \[ALL_PENDING, \.\.\.PENDING_KIND_LABELS\]\)/);
  assert.match(PAGE, /\{onPending && <SideFilterList/);
  assert.match(PAGE, /count: tabCounts\[label === ALL_PENDING \? "Pending" : label\] \|\| 0/);
});

test("the side list is a vertical tab list that wraps above the table on a phone", () => {
  assert.match(LIST, /role="tablist" aria-label=\{ariaLabel\} aria-orientation="vertical"/);
  assert.match(LIST, /role="tab"\n\s+aria-selected=\{active\}/);
  assert.match(LIST, /flex-wrap[^"]*md:w-72 md:flex-col md:flex-nowrap/);
  // A label is read whole: "Employee Submission Pending" wraps rather than ending in "...".
  assert.match(LIST, /<span className="min-w-0 break-words leading-snug">\{item\.label\}<\/span>/);
  assert.doesNotMatch(LIST, /truncate">\{item\.label\}/);
});

test("the Board offers every tab in the bar: a status tab shows its own column, an overlay narrows every column", () => {
  assert.doesNotMatch(PAGE, /boardTabs/);
  assert.match(PAGE, /tabs=\{barTabs\.map\(\(tab\) =>/);
  // Its own column, with any other a row of that tab sits in - so nobody on the Active tab lands in Other.
  assert.match(PAGE, /const held = new Set\(filteredRows\.map\(boardColumnOf\)\);\n\s+return boardColumns\.filter\(\(column\) => column\.value === selectedTab\.label \|\| held\.has\(column\.value\)\);/);
  assert.match(PAGE, /columns=\{shownBoardColumns\}/);
  assert.match(PAGE, /const onPending = selectedTab\.label === "Pending";/);
});

test("the two onboarding kinds are reached only inside Pending; Incomplete Profiles stays in the bar, outside Pending", () => {
  assert.match(PAGE, /\{ label: "Employee Submission Pending", statuses: \["Employee Submission Pending"\], pendingOnly: true \}/);
  assert.match(PAGE, /\{ label: "HR Onboarding Pending", statuses: \["HR Onboarding Pending"\], pendingOnly: true \}/);
  assert.match(PAGE, /\{ label: "Incomplete Profiles", filter: [^\n]*\}/);
  assert.doesNotMatch(PAGE.match(/\{ label: "Incomplete Profiles", filter: [^\n]*\}/)[0], /pendingOnly/);
});

test("HR Offboarding Pending: a submitted resignation waiting on HR, inside Pending only", () => {
  assert.match(PAGE, /\{ label: "HR Offboarding Pending", filter: isResignationPending, pendingOnly: true \}/);
});

test("the Board's columns run in the order a person moves through them", () => {
  const block = PAGE.slice(PAGE.indexOf("const boardColumns = ["), PAGE.indexOf("];", PAGE.indexOf("const boardColumns = [")));
  const order = [...block.matchAll(/\{ value: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["Employee Submission Pending", "HR Onboarding Pending", "Active", "Serving Notice", "InActive"]);
});
