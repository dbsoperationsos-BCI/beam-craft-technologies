import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Assigning the Production Manager, on the screen that staffs the project.
 *
 * It used to be asked for on Pre Production → General, on the reasoning that it is settled once
 * pre-production is under way. It is the fifth seat on a project, so it is asked for with the other
 * four - Project Manager, Pre Production Coordinator, Creative Manager, Post Production Coordinator
 * - on Start Project and Edit Project: staffing a project is one question, and answering half of it
 * on another screen left studios hunting for the half they had missed.
 *
 * Pre Production still shows the name - a board column and a line in the record panel - and no
 * longer sets it.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const FORM = src("components", "project-management", "StartProjectFormPanel.js");
const GENERAL = src("components", "project-management", "PreProductionGeneral.js");
const PAGE = src("components", "project-management", "PreProductionPage.js");
const STAFF = src("constants", "projectStaff.js");
const INFO = src("constants", "infoPanelConfig.js");

test("the picker is in Project Setup, beside the other seats, and picks an employee", () => {
  // `EmployeeDropdown`, the control the other four seats already use on this form.
  assert.match(FORM, /<EmployeeDropdown label="Production Manager"(?: helperText="[^"]*")? employeeId=\{form\.productionManagerEmployeeId\} employeeName=\{form\.productionManager\}/);
  assert.match(FORM, /productionManagerEmployeeId: id, productionManager: name/);
  // Between Pre Production Coordinator and Creative Manager: the order the work runs in.
  const order = ["Pre Production Coordinator", "Production Manager", "Creative Manager", "Post Production Coordinator"]
    .map((label) => FORM.indexOf(`<EmployeeDropdown label="${label}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((at) => at > -1));
});

test("the form opens on the seat the project already holds, and sends it back", () => {
  // Starting value, or the picker opens blank over a saved seat.
  assert.match(FORM, /productionManager: project\?\.productionManager \|\| "",/);
  assert.match(FORM, /productionManagerEmployeeId: project\?\.productionManagerEmployeeId \|\| "",/);
  // The payload is the form, so nothing else has to name the field for it to be saved.
  assert.match(FORM, /const \{ giftAssigneesSame, \.\.\.fields \} = form;/);
});

test("Pre Production's General panel no longer asks for it", () => {
  assert.doesNotMatch(GENERAL, /productionManagerEmployeeId/);
  // Nor on the closed bar, which summarises what the panel itself holds.
  assert.doesNotMatch(GENERAL, /\["Production Manager", project\.productionManager\]/);
});

test("the pre production board still shows who it is", () => {
  /*
   * The projection is explicit, so a field that is not named here simply is not there - which looks
   * exactly like a seat nobody has filled. The four tabs are views over one column list, so the
   * column appears in all of them, beside the other seats: the question the register is being asked
   * is who is running this project.
   */
  assert.match(PAGE, /productionManager: first\.productionManager,/);
  assert.match(PAGE, /\{ id: "productionManager", label: "Production Manager" \},/);
  // The panel that opens on a row, under People with the rest of them.
  assert.match(INFO, /\["productionManager", "Production Manager"\], \["preProductionCoordinator", "Pre Production Coordinator"\]/);
});

test("being the Production Manager does not widen who may edit or delete a project", () => {
  /*
   * The browser's copy of the backend's access rule. Whoever is named in it may edit the project and
   * the first entry may delete it, so a seat added here is a permission change - not bookkeeping.
   * Moving where the seat is asked for is not a reason to grant it: it stays an assignment.
   */
  assert.doesNotMatch(STAFF, /productionManagerEmployeeId/);
});
