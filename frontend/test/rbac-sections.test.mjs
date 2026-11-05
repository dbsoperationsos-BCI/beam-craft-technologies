import test from "node:test";
import assert from "node:assert/strict";
import { FAMILY_SIDEBAR_ITEM_ID, familyEntryFor, hasChoice, rbacSectionsFor } from "../src/constants/rbacSections.js";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";

/*
 * The control beside the Employee Repository heading, and who sees what in it.
 *
 * It is the only way to three of the four screens it names - Users, Roles and, since the referral
 * register came off the menu, Employee Referral - so what it lists is what those readers can reach
 * at all. Two things have to hold at once: a destination a role cannot open is **absent** rather
 * than listed and refused a click later, and the screen being read stays in the menu whatever the
 * permissions say, because a switch whose own value is missing shows an empty trigger.
 */

const holding = (...pairs) => (module, feature) => pairs.includes(`${module}/${feature}`);
const everything = () => true;
const labels = (rows) => rows.filter((row) => row.label).map((row) => row.label);

test("the four screens are one menu, with the RBAC pair under their own heading", () => {
  const rows = rbacSectionsFor(everything, "/employees");
  assert.deepEqual(labels(rows), ["Client Details", "Employees", "Employee Referral", "Users", "Roles"]);
  assert.equal(rows.filter((row) => row.separator).length, 1);
  assert.deepEqual(rows.filter((row) => row.heading).map((row) => row.heading), ["RBAC Action"]);
});

test("the referral register is reached from here rather than from the sidebar", () => {
  const rows = rbacSectionsFor(everything, "/employees");
  assert.ok(rows.some((row) => row.value === "/hrm/employee-referrals"));

  const hrm = SIDEBAR_MODULES.find((group) => group.id === "hrm");
  const referral = hrm.items.find((item) => item.id === "employee-referral");
  assert.ok(referral, "the entry stays in the registry - the Roles screen reads its name from it");
  assert.equal(referral.hidden, true, "and is off the menu");
});

test("a reader without Employee Referral is not offered it", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "ADMIN/User Management", "ADMIN/Role Management"), "/employees");
  assert.deepEqual(labels(rows), ["Employees", "Users", "Roles"]);
});

test("a reader holding neither RBAC screen loses the heading and the rule above it", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "HRM/Employee Referral"), "/employees");
  assert.deepEqual(labels(rows), ["Employees", "Employee Referral"]);
  assert.equal(rows.some((row) => row.separator || row.heading), false);
});

test("the screen being read stays in its own menu", () => {
  // Somebody on the referral register who holds nothing else: the trigger still has a value to show.
  const rows = rbacSectionsFor(holding("HRM/Employee Referral"), "/hrm/employee-referrals");
  assert.deepEqual(labels(rows), ["Employee Referral"]);
});

/* ------------------------------------------------------------------ the family's one sidebar row */

/*
 * Employee Repository is the only entry in the menu for any of the four screens, so what it opens
 * has to follow the reader rather than always being `/employees`. A role granted the referral
 * register and not the repository used to get a menu with no way to the one screen it could read.
 */

test("the row in the menu is Client Details for anybody who holds it", () => {
  assert.equal(familyEntryFor(everything), "/hrm/client-details");
  assert.equal(familyEntryFor(holding("SUBSCRIBE/Client Onboarding")), "/hrm/client-details");
});

test("the employee list is still reached from it, by a reader without Client Details", () => {
  assert.equal(familyEntryFor(holding("HRM/Employee Management")), "/employees");
});

test("and falls through to whichever of the four the reader may open", () => {
  assert.equal(familyEntryFor(holding("HRM/Employee Referral")), "/hrm/employee-referrals");
  assert.equal(familyEntryFor(holding("ADMIN/User Management")), "/admin/users");
  assert.equal(familyEntryFor(holding("ADMIN/Role Management")), "/admin/roles");
});

test("a reader who holds none of them has no row at all", () => {
  assert.equal(familyEntryFor(holding("SALES/CRM Leads")), null);
});

test("the row it names is one the registry actually has", () => {
  const hrm = SIDEBAR_MODULES.find((group) => group.id === "hrm");
  const door = hrm.items.find((item) => item.id === FAMILY_SIDEBAR_ITEM_ID);
  assert.ok(door && !door.hidden, "the family's door is a visible entry in the menu");
});

/* ----------------------------------------------------------------- when the switch is worth drawing */

test("one destination is not a choice, and draws no switch", () => {
  assert.equal(hasChoice(rbacSectionsFor(holding("HRM/Employee Management"), "/employees")), false);
  assert.equal(hasChoice(rbacSectionsFor(holding("HRM/Employee Referral"), "/hrm/employee-referrals")), false);
  // A lone survivor carrying its group's heading is still one destination.
  assert.equal(hasChoice(rbacSectionsFor(holding("ADMIN/User Management"), "/admin/users")), false);
});

test("two are, and both are listed", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "HRM/Employee Referral"), "/employees");
  assert.equal(hasChoice(rows), true);
  assert.deepEqual(labels(rows), ["Employees", "Employee Referral"]);
});

test("Users and Roles join them when those permissions are held", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "ADMIN/User Management", "ADMIN/Role Management"), "/employees");
  assert.equal(hasChoice(rows), true);
  assert.deepEqual(labels(rows), ["Employees", "Users", "Roles"]);
});
