import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * Settings → Holidays declares a holiday for every branch or for the branches chosen, and the
 * screen asks which. What is pinned: the field is there, the branches come from the server rather
 * than being typed here, the save sends the scope the API takes, and a read-only viewer still gets
 * a calendar.
 */

const PANEL = fs.readFileSync(new URL("../src/components/settings/HolidaysPanel.js", import.meta.url), "utf8");
const SERVICE = fs.readFileSync(new URL("../src/services/settings/holidays.service.js", import.meta.url), "utf8");

test("the dialog asks whom the holiday applies to, with the branches read from the server", () => {
  assert.match(PANEL, /label="Holiday applies to"/);
  assert.match(PANEL, /\{ value: ALL, label: "All branches" \}/);
  assert.match(PANEL, /\{ value: "branches", label: "Specific branches" \}/);
  // The branch picker is the shared control, filled from the holidays API - no branch is typed here.
  assert.match(PANEL, /<MultiSelectField\s+label="Branches"/);
  assert.match(PANEL, /getHolidayBranches\(\)/);
  assert.doesNotMatch(PANEL, /"Chennai"|"Madurai"|"Coimbatore"|"Erode"/, "a branch name is typed into the screen");
  // "All branches" is offered only to somebody the server says may declare one.
  assert.match(PANEL, /branchChoices\.allBranches \|\| draft\.allBranches \? SCOPE_OPTIONS : SCOPE_OPTIONS\.filter\(\(option\) => option\.value !== ALL\)/);
  // And nothing can be declared until the server has answered which branches this login may declare for.
  assert.match(PANEL, /const canDeclare = canWrite && branchChoices\.ready && \(branchChoices\.allBranches \|\| branchOptions\.length > 0\)/);
  assert.match(PANEL, /allBranches: false, ready: false/, "the safe default before the answer is in must be 'not allowed'");
  // A holiday this login's reach does not cover offers no Edit or Remove.
  assert.match(PANEL, /canDeclare && holiday\.canEdit !== false &&/);
  // And a save with no branch chosen is refused on the screen before the server has to.
  assert.match(PANEL, /branchIds: !draft\.allBranches && !\(draft\.branchIds \|\| \[\]\)\.length \? "Choose at least one branch\." : ""/);
  assert.match(PANEL, /error=\{fields\.errors\.branchIds\}/);
});

test("the save sends the scope the API takes, and an edit carries the holiday's own", () => {
  assert.match(SERVICE, /allBranches: true, branchIds: \[\]/);
  assert.match(SERVICE, /allBranches: false, branchIds: branchIds\.map\(Number\)/);
  assert.match(SERVICE, /export function getHolidayBranches\(\)/);
  assert.match(SERVICE, /`\$\{ROOT\}\/branches`/);
  // An existing holiday opens with its own scope, the ids as the picker's strings.
  assert.match(PANEL, /allBranches: holiday\.allBranches !== false, branchIds: \(holiday\.branchIds \|\| \[\]\)\.map\(String\)/);
});

test("a day holds every holiday on it, and each is named with whose it is", () => {
  // Two branches may each have a holiday on one day, so the day is a list, not one holiday.
  assert.match(PANEL, /map\.set\(holiday\.date, \[\.\.\.\(map\.get\(holiday\.date\) \|\| \[\]\), holiday\]\)/);
  assert.match(PANEL, /holiday\.scopeLabel \|\| "All branches"/);
  // The month can be read as one branch sees it: its own holidays and the studio's.
  assert.match(PANEL, /observedBy = \(holiday, branchId\) => branchId === ALL \|\| holiday\.allBranches \|\| \(holiday\.branchIds \|\| \[\]\)\.includes\(Number\(branchId\)\)/);
  // A failure to read the branches is said, not swallowed.
  assert.match(PANEL, /getHolidayBranches\(\)\.catch\(\(error\) => \{ onError\?\.\(/);
  // A day holding several holidays opens a chooser naming each with whose it is.
  assert.match(PANEL, /if \(existing\.length > 1\) return setDayChooser\(key\);/);
});
