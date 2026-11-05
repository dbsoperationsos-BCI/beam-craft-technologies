import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { scheduleFormRows, scheduleSavePayload } from "../src/lib/paymentSchedule.mjs";

/*
 * Edit Sale Details shows the project's **own** Schedule Payment.
 *
 * It seeded `paymentScheduleDefaults` and sent `null` on save, so a booking created with a schedule -
 * which Create Project does persist, and Start / Edit Project does load - reopened showing one
 * "Advance · Slot Booking · 5%" row. That read as "the rows I entered were not saved", and a row typed
 * over it was then dropped on save.
 *
 * Now the form reads the saved rows, and the section is a form only for somebody the server will let
 * change one: the schedule answers to `PROJECT / Projects` plus this project's own started rule, not to
 * the sale's permission.
 */

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
const FORM = read("sales/CreateProjectFormPanel.js");
const SECTION = read("project-management/SchedulePaymentSection.js");

test("the saved rows become the form's rows, and survive being sent back", () => {
  // What the server sends for a project whose middle payment Accounts has already worked.
  const saved = [
    { id: "s1", category: "Advance", dueDate: "2026-10-10", remarks: "Slot Booking", percentage: 5, locked: false, status: "" },
    { id: "s2", category: "Partial Payment", dueDate: "2026-10-14", remarks: "", percentage: 45, locked: true, status: "Paid" },
  ];
  const rows = scheduleFormRows(saved, 100000);
  assert.deepEqual(rows.map((row) => [row.category, row.date, row.percentage, row.locked]), [
    ["Advance", "2026-10-10", 5, false],
    ["Partial Payment", "2026-10-14", 45, true],
  ]);
  // Both go back, so saving the form does not quietly drop the worked row.
  assert.equal(scheduleSavePayload(rows).length, 2);
});

test("editing a sale reads the project's schedule rather than the defaults", () => {
  assert.match(FORM, /getProjectPaymentSchedule\(project\.id\)/, "asked for the project's own");
  assert.match(FORM, /const loaded = scheduleFormRows\(saved\.data, savedScheduleFor\);\s*setSchedulePayments\(loaded\);\s*setLoadedSchedule\(loaded\);/);
  assert.match(FORM, /if \(mode !== "edit" \|\| !project\?\.id\) return undefined;/, "only when a sale is being edited");
  // A project booked before the schedule was kept has none, so the defaults still stand.
  assert.match(FORM, /saved\?\.data\?\.length/);
});

test("the rows are sent on save only when this viewer may change them", () => {
  assert.match(FORM, /mode === "create" \? createScheduleWithShootPlaces\(\) : canEditSchedule \? scheduleSavePayload\(schedulePayments\) : null, \{ draft \}\);/);
  // Ready to edit as it opens for somebody who may change it - no Edit button - and read-only for anyone else.
  assert.match(FORM, /const scheduleReadOnly = mode === "edit" && !canEditSchedule;/);
  assert.match(FORM, /readOnly=\{scheduleReadOnly\}/, "and the section says so rather than offering a save that is refused");
  assert.match(FORM, /offerNewRow=\{mode === "edit" && canEditSchedule\}/);
});

test("Shedule Payment opens ready to edit, with a row to add the next payment, and a change to it alone is saved", () => {
  const SECTION = read("project-management/SchedulePaymentSection.js");
  assert.doesNotMatch(SECTION, />Edit<\/Button>/, "no Edit button to press first");
  // A blank row as soon as the rows arrive, unless the last row already settles the balance.
  assert.match(SECTION, /const needsNewRow = offerNewRow && !readOnly && \(!rows\.length \|\| shouldAppendPaymentRow\(rows\[rows\.length - 1\], categories\)\);/);
  assert.match(SECTION, /current\.length && !shouldAppendPaymentRow\(current\[current\.length - 1\], categories\) \? current : \[\.\.\.current, emptyPaymentRow\(\)\]/);
  // Every row opens, completed and upcoming alike: a worked one is a form too, its status beneath it.
  assert.doesNotMatch(SECTION, /row\.locked \|\| readOnly/);
  assert.match(SECTION, /current\.filter\(\(row\) => row\.id !== id\)\)/, "and any row may be removed");
  assert.match(SECTION, /\{row\.locked && row\.status && <span className="block text-xs text-slate-500">\{row\.status\}<\/span>\}/);
  // Only the schedule changed: saved on its own, with the same date check, the sale not sent again.
  assert.match(FORM, /const scheduleChanged = canEditSchedule && JSON\.stringify\(scheduleSavePayload\(schedulePayments\)\) !== JSON\.stringify\(scheduleSavePayload\(loadedSchedule\)\);/);
  assert.match(FORM, /await onSave\(form, null, scheduleSavePayload\(schedulePayments\), \{ draft, scheduleOnly: true \}\);/);
  const bookings = read("sales/SalesManagerPage.js");
  assert.match(bookings, /if \(!scheduleOnly\) await updateSalesProject\(editingProject\.id, salePatchPayload\(form\), \{ draft \}\);/);
  assert.match(bookings, /if \(scheduleOnly && editingProject\.sentBackAt && !draft\) await returnSalesProjectToProjects\(editingProject\.id\);/);
  assert.match(read("project-management/ProjectsPage.js"), /if \(!scheduleOnly\) await updateSalesProject\(editingProject\.id, salePatchPayload\(form\)\);/);
});

test("a read-only schedule is a reading: no box, no row to remove, nothing to add", () => {
  // Every row read as text, with nothing to type in.
  assert.match(SECTION, /readOnly \? <span className="text-sm text-slate-700">\{lockedText\[column\.key\]\(row\)\}<\/span>/);
  // And the two writes are shut, so the auto-appended empty row cannot arrive either.
  assert.match(SECTION, /const updateRowWith = \(id, changes\) => readOnly \|\| onChange\(/);
  assert.match(SECTION, /const deleteRow = \(id\) => readOnly \|\| onChange\(/);
});

test("both screens ask what the save endpoint asks, and then save it", () => {
  /*
   * The two ways through: `SALES / Booking Edit`, which changes a booking and its schedule with it,
   * or planning projects **and** still being allowed to change this one.
   */
  for (const [screen, rule] of [
    ["sales/SalesManagerPage.js", /\(project\) => mayEditBookings\n\s+\|\| \(\(plansProjects \|\| worksEveryProject\)\n\s+&& \(\(project\?\.projectStatus \|\| "Yet to Start"\) === "Yet to Start" \|\| canDeleteProject\(project\)\)\),/],
    ["project-management/ProjectsPage.js", /\(project\) => mayEditBookings\n\s+\|\| \(canPlanProjects && \(\(project\?\.projectStatus \|\| "Yet to Start"\) === "Yet to Start" \|\| canEditStarted\(project\)\)\),/],
  ]) {
    const source = read(screen);
    assert.match(source, rule, `${screen}: may plan projects, and may still change this one`);
    assert.match(source, /canEditSchedule=\{canEditSchedule\(editingProject\)\}/, `${screen}: told the form`);
    assert.match(source, /if \(schedule\) await saveProjectPaymentSchedule\(editingProject\.id, schedule\);/, `${screen}: and saves it after the sale`);
  }
});
