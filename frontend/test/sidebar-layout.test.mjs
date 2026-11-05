import test from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_MODULES } from "../src/constants/navigation.mjs";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  applyVisibleOrder,
  isDefaultLayout,
  moveInList,
  dropIndex,
  resolveSidebarLayout,
} from "../src/lib/sidebarLayout.mjs";

/*
 * The merge behind everybody's sidebar: the registry, what they may open, and what they arranged.
 *
 * Written against the real registry rather than a fixture, so these also fail if a module or screen
 * is added to the application without an id, or with an id that collides with another.
 */

const seeEverything = () => true;
const ids = (groups) => groups.map((group) => group.id);
const itemIds = (groups, moduleId) => groups.find((group) => group.id === moduleId)?.items.map((item) => item.id);

test("with nothing saved, the sidebar is the registry's own order", () => {
  const { groups, layout, changed } = resolveSidebarLayout(null, seeEverything);
  assert.deepEqual(ids(groups), DEFAULT_SIDEBAR_LAYOUT.moduleOrder);
  assert.deepEqual(layout, DEFAULT_SIDEBAR_LAYOUT);
  // Nothing is written back for somebody who has never arranged anything: they keep following the
  // application's own order as it changes.
  assert.equal(changed, false);
});

test("a saved order is the order, for the modules and inside them", () => {
  const stored = {
    moduleOrder: ["accounts", "hrm", "subscribe", "sales-crm", "client-management", "resource-management"],
    submoduleOrder: {
      ...DEFAULT_SIDEBAR_LAYOUT.submoduleOrder,
      "sales-crm": ["quotations", "contacts", "leads-followups", "reports-analytics", "bookings-converted"],
    },
  };
  const { groups, changed } = resolveSidebarLayout(stored, seeEverything);
  assert.equal(ids(groups)[0], "accounts");
  assert.equal(ids(groups)[1], "hrm");
  assert.deepEqual(itemIds(groups, "sales-crm").slice(0, 3), ["quotations", "contacts", "leads-followups"]);
  // A complete arrangement that still matches the application needs no correcting, so nothing is
  // written back.
  assert.equal(changed, false);
});

test("a layout that mentions only some of the modules is completed, and written back once", () => {
  // The stored record ends up holding every module's order explicitly, rather than half of it
  // being implied by whatever the registry happened to say the day it was saved.
  const stored = { moduleOrder: ["accounts"], submoduleOrder: { "sales-crm": ["quotations"] } };
  const { layout, changed } = resolveSidebarLayout(stored, seeEverything);

  assert.equal(changed, true);
  assert.equal(layout.moduleOrder[0], "accounts");
  // Every module's own order is kept, one off the menu included (its list is just empty).
  assert.deepEqual(Object.keys(layout.submoduleOrder), Object.keys(DEFAULT_SIDEBAR_LAYOUT.submoduleOrder));
  assert.equal(layout.submoduleOrder["sales-crm"][0], "quotations");
  // Completing it is a one-off: merging the completed layout again changes nothing.
  assert.equal(resolveSidebarLayout(layout, seeEverything).changed, false);
});

test("two logins arrange independently: one layout says nothing about another", () => {
  const a = resolveSidebarLayout({ moduleOrder: ["sales-crm", "client-management", "hrm"], submoduleOrder: {} }, seeEverything);
  const b = resolveSidebarLayout({ moduleOrder: ["hrm", "resource-management", "sales-crm"], submoduleOrder: {} }, seeEverything);
  assert.deepEqual(ids(a.groups).slice(0, 3), ["sales-crm", "client-management", "hrm"]);
  assert.deepEqual(ids(b.groups).slice(0, 3), ["hrm", "resource-management", "sales-crm"]);
});

test("a screen cannot be moved into another module, however the layout was written", () => {
  // The exact case the rule exists for: Quotations, filed under Project Management.
  const stored = {
    moduleOrder: DEFAULT_SIDEBAR_LAYOUT.moduleOrder,
    submoduleOrder: { "client-management": ["quotations", "client-details"] },
  };
  const { groups } = resolveSidebarLayout(stored, seeEverything);
  assert.equal(itemIds(groups, "client-management").includes("quotations"), false);
  // And it is still where it belongs, rather than lost.
  assert.equal(itemIds(groups, "sales-crm").includes("quotations"), true);
});

test("a screen added to the application appears in a saved layout, at its default position", () => {
  // A layout saved before Tasks and Client Gifts existed: everything else in a deliberate order.
  const stored = {
    moduleOrder: DEFAULT_SIDEBAR_LAYOUT.moduleOrder,
    submoduleOrder: {
      // Includes a screen since taken off the menu (`hidden`), which is the realistic case for
      // a layout saved a while ago - a stored id for a screen nobody can see any more is dropped.
      hrm: ["employee-referral", "employee-repository"],
      "sales-crm": ["quotations", "leads-followups", "contacts"],
    },
  };
  const { groups, layout, changed } = resolveSidebarLayout(stored, seeEverything);

  // The arrangement they made is untouched, and the new screens follow it, in registry order.
  assert.deepEqual(itemIds(groups, "hrm"), ["employee-repository", "employee-attendance", "tasks", "interview", "payroll"]);
  assert.deepEqual(itemIds(groups, "sales-crm"), ["quotations", "leads-followups", "contacts", "reports-analytics", "bookings-converted"]);
  // Beam Craft's Client Management shows Client Details only; DBS's customer screens are hidden there.
  assert.deepEqual(itemIds(groups, "client-management"), ["client-details"]);
  // Worth writing back, so the stored record keeps up with the application.
  assert.equal(changed, true);
  assert.equal(layout.submoduleOrder.hrm.at(-1), "payroll");
});

test("a screen the role cannot open is neither added nor shown, and arrives when the permission does", () => {
  const stored = { moduleOrder: ["hrm"], submoduleOrder: { hrm: ["employee-repository"] } };
  const withoutTasks = (item) => item.id !== "tasks";

  const before = resolveSidebarLayout(stored, withoutTasks);
  assert.equal(itemIds(before.groups, "hrm").includes("tasks"), false);
  assert.equal(before.layout.submoduleOrder.hrm.includes("tasks"), false);

  // The permission is granted; nothing was reset and nothing had to be pressed.
  const after = resolveSidebarLayout(before.layout, seeEverything);
  assert.deepEqual(itemIds(after.groups, "hrm"), ["employee-repository", "employee-attendance", "interview", "payroll", "tasks"]);
});

test("a permission taken away hides the screen but keeps where it was put", () => {
  const stored = {
    moduleOrder: DEFAULT_SIDEBAR_LAYOUT.moduleOrder,
    submoduleOrder: { hrm: ["tasks", "employee-repository", "employee-attendance"] },
  };
  const noTasks = (item) => item.id !== "tasks";
  const { groups, layout } = resolveSidebarLayout(stored, noTasks);

  assert.equal(itemIds(groups, "hrm").includes("tasks"), false);
  // Still first in the stored order, so getting the permission back puts it back where it was
  // rather than at the bottom.
  assert.equal(layout.submoduleOrder.hrm[0], "tasks");
  assert.deepEqual(itemIds(resolveSidebarLayout(layout, seeEverything).groups, "hrm")[0], "tasks");
});

test("a module with nothing the role may open is not drawn at all", () => {
  const salesOnly = (item) => item.href.startsWith("/sales");
  const { groups } = resolveSidebarLayout(null, salesOnly);
  // On Beam Craft the /sales screens under Client Management are hidden, so only Sales & CRM is drawn.
  assert.deepEqual(ids(groups), ["sales-crm"]);
});

test("an id that has left the registry is ignored, not an error", () => {
  const stored = {
    moduleOrder: ["retired-module", "hrm"],
    submoduleOrder: { hrm: ["retired-screen", "tasks"], "retired-module": ["whatever"] },
  };
  const { groups, layout, changed } = resolveSidebarLayout(stored, seeEverything);
  assert.equal(ids(groups)[0], "hrm");
  assert.equal(layout.moduleOrder.includes("retired-module"), false);
  assert.equal(layout.submoduleOrder.hrm[0], "tasks");
  assert.equal(changed, true);
});

test("a value that is not a layout at all reads as no layout", () => {
  for (const rubbish of ["nonsense", 7, [], { moduleOrder: "sales-crm" }]) {
    const { layout } = resolveSidebarLayout(rubbish, seeEverything);
    assert.deepEqual(layout, DEFAULT_SIDEBAR_LAYOUT);
  }
});

test("reordering what is on screen leaves hidden entries where they were", () => {
  const full = ["quotations", "contacts", "leads-followups"];
  const visible = new Set(["quotations", "leads-followups"]);
  assert.deepEqual(
    applyVisibleOrder(full, ["leads-followups", "quotations"], (id) => visible.has(id)),
    ["leads-followups", "contacts", "quotations"]
  );
});

test("moveInList moves one entry, and refuses to move it off the ends", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 0, 5), ["a", "b", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], -1, 1), ["a", "b", "c"]);
});

test("dropIndex turns the gap a row is dropped into, named either way, into where it lands", () => {
  // Carried down: the rows above it close up, so the index is one less than the gap.
  assert.equal(dropIndex(0, 2, "after"), 2);
  assert.equal(dropIndex(0, 2, "before"), 1);
  // Carried up: nothing above it moves, so the gap is the index.
  assert.equal(dropIndex(3, 1, "before"), 1);
  assert.equal(dropIndex(3, 1, "after"), 2);
  // The same gap has two names, and both land in the same place.
  assert.equal(dropIndex(4, 1, "after"), dropIndex(4, 2, "before"));
  // Dropped into a gap it already borders, a row stays where it is.
  assert.equal(dropIndex(1, 0, "after"), 1);
  assert.equal(dropIndex(1, 2, "before"), 1);
  assert.deepEqual(moveInList(["a", "b", "c"], 1, dropIndex(1, 2, "before")), ["a", "b", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], 0, dropIndex(0, 2, "after")), ["b", "c", "a"]);
});

test("isDefaultLayout knows the registry's own order from an arrangement", () => {
  assert.equal(isDefaultLayout(DEFAULT_SIDEBAR_LAYOUT), true);
  assert.equal(isDefaultLayout(null), true);
  assert.equal(isDefaultLayout({ ...DEFAULT_SIDEBAR_LAYOUT, moduleOrder: ["accounts", "hrm"] }), false);
});

test("every id in the registry is unique, and every screen belongs to exactly one module", () => {
  const moduleIds = SIDEBAR_MODULES.map((group) => group.id);
  assert.equal(new Set(moduleIds).size, moduleIds.length, "two modules share an id");
  const screenIds = SIDEBAR_MODULES.flatMap((group) => group.items.map((item) => item.id));
  assert.equal(new Set(screenIds).size, screenIds.length, "two screens share an id");
  for (const id of screenIds) assert.equal(moduleIds.includes(id), false, `"${id}" is both a module and a screen`);
});

/* ------------------------------------------------------------------ screens taken off the menu */

test("a screen marked hidden is off the menu for everybody, permission or not", () => {
  /*
   * `hidden` is not a permission. Employee Referral is still in the registry - the Roles screen
   * reads its friendly label from there, Field Settings its screen picker, and the topbar the
   * page's title - but the studio reaches it from the Employee Repository's heading instead, and
   * that applies to a Super Admin as much as to anybody.
   */
  const { groups } = resolveSidebarLayout(null, seeEverything);
  const hrm = itemIds(groups, "hrm");
  assert.equal(hrm.includes("employee-referral"), false);
  assert.deepEqual(hrm, ["employee-repository", "employee-attendance", "tasks", "interview", "payroll"]);
});

test("a hidden screen cannot be reordered either, since there is nothing to arrange", () => {
  // Sidebar Layout is drawn from the same resolver, so it offers exactly what the menu draws.
  const { layout } = resolveSidebarLayout(null, seeEverything);
  assert.equal(layout.submoduleOrder.hrm.includes("employee-referral"), false);
});

test("hiding a screen does not take its name off the Roles screen", () => {
  /*
   * The reason the flag exists rather than the row simply being deleted. `FEATURE_LABELS` in
   * modulePermissions is built by walking this registry, so a deleted entry would leave the
   * permission showing its raw feature name to whoever is granting it. `HRM / Employee Referral`
   * is the live case: off the menu, still granted by name on the Roles screen.
   */
  const hrm = SIDEBAR_MODULES.find((group) => group.id === "hrm");
  const labels = hrm.items.filter((item) => item.hidden).map((item) => item.label);
  // Request, the Attendance Register and Events too: they are Employee Attendance's sections now,
  // and still granted by name. Payroll is on the menu again; Payslip is a tab of My Profile, off the
  // menu and still granted by name as My Payslip.
  assert.deepEqual(labels, ["Attendance Register", "Leave or Comp-Off Request", "Events", "Employee Referral", "Payslip"]);
});
