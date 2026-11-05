import test from "node:test";
import assert from "node:assert/strict";
import { FAMILY_SIDEBAR_ITEM_ID, familyEntryFor, hasChoice, rbacSectionsFor } from "../src/constants/rbacSections.js";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import { permissionForRoute } from "../src/constants/modulePermissions.js";

/*
 * The control beside the Employee Repository heading, and who sees what in it.
 *
 * It is the only way to four of the five screens it names - Users, Roles, User Activity Logs and,
 * since the referral register came off the menu, Employee Referral - so what it lists is what those readers can reach
 * at all. Two things have to hold at once: a destination a role cannot open is **absent** rather
 * than listed and refused a click later, and the screen being read stays in the menu whatever the
 * permissions say, because a switch whose own value is missing shows an empty trigger.
 */

const holding = (...pairs) => (module, feature) => pairs.includes(`${module}/${feature}`);
const everything = () => true;
const labels = (rows) => rows.filter((row) => row.label).map((row) => row.label);

test("the five screens are one menu, with the RBAC pair under their own heading", () => {
  const rows = rbacSectionsFor(everything, "/employees");
  assert.deepEqual(labels(rows), ["Administration", "Employee Referral", "User Activity Logs", "Users", "Roles"]);
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

test("the activity log sits under Employee Referral, in the first group, and has its own permission", () => {
  const rows = rbacSectionsFor(everything, "/employees");
  const values = rows.map((row) => row.value || row.heading || (row.separator ? "|" : ""));
  assert.deepEqual(values.slice(0, 4), ["/employees", "/hrm/employee-referrals", "/admin/activity-logs", "|"]);
  assert.deepEqual(permissionForRoute("/admin/activity-logs"), { module: "ADMIN", feature: "User Activity Logs" });
});

test("a reader without User Activity Logs is not offered it, and one holding only it still reaches it", () => {
  const without = rbacSectionsFor(holding("HRM/Employee Management", "ADMIN/User Management"), "/employees");
  assert.ok(!labels(without).includes("User Activity Logs"));
  // User Management does not open the log: `/admin` must not answer for `/admin/activity-logs`.
  assert.deepEqual(labels(rbacSectionsFor(holding("ADMIN/User Activity Logs"), "/admin/activity-logs")), ["User Activity Logs"]);
  assert.equal(familyEntryFor(holding("ADMIN/User Activity Logs")), "/admin/activity-logs");
});

test("a reader without Employee Referral is not offered it", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "ADMIN/User Management", "ADMIN/Role Management"), "/employees");
  assert.deepEqual(labels(rows), ["Administration", "Users", "Roles"]);
});

test("a reader holding neither RBAC screen loses the heading and the rule above it", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "HRM/Employee Referral"), "/employees");
  assert.deepEqual(labels(rows), ["Administration", "Employee Referral"]);
  assert.equal(rows.some((row) => row.separator || row.heading), false);
});

test("the screen being read stays in its own menu", () => {
  // Somebody on the referral register who holds nothing else: the trigger still has a value to show.
  const rows = rbacSectionsFor(holding("HRM/Employee Referral"), "/hrm/employee-referrals");
  assert.deepEqual(labels(rows), ["Employee Referral"]);
});

/* ------------------------------------------------------------------ the family's one sidebar row */

/*
 * Employee Repository is the only entry in the menu for any of the five screens, so what it opens
 * has to follow the reader rather than always being `/employees`. A role granted the referral
 * register and not the repository used to get a menu with no way to the one screen it could read.
 */

test("the row in the menu is the repository for anybody who holds it", () => {
  assert.equal(familyEntryFor(everything), "/employees");
  assert.equal(familyEntryFor(holding("HRM/Employee Management")), "/employees");
});

test("and falls through to whichever of the five the reader may open", () => {
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
  assert.deepEqual(labels(rows), ["Administration", "Employee Referral"]);
});

test("Users and Roles join them when those permissions are held", () => {
  const rows = rbacSectionsFor(holding("HRM/Employee Management", "ADMIN/User Management", "ADMIN/Role Management"), "/employees");
  assert.equal(hasChoice(rows), true);
  assert.deepEqual(labels(rows), ["Administration", "Users", "Roles"]);
});
