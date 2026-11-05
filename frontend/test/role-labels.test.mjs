import test from "node:test";
import assert from "node:assert/strict";

import { MENU_GROUPS } from "../src/constants/navigation.mjs";
import { MODULE_LABELS, featureLabel, moduleLabel, permissionForRoute, sortFeaturesForMenu, sortModulesForMenu } from "../src/constants/modulePermissions.js";

/*
 * The Roles screen must call a screen what the sidebar calls it.
 *
 * This is the failure these assertions exist for: the menu said "Resource Management" and the role
 * form said "Asset Management", for the same permission. Nothing broke - somebody granted a
 * permission, went looking for the menu entry it had named, and it was not there under that name.
 */

test("every menu group titles its module on the roles screen", () => {
  for (const group of MENU_GROUPS) {
    if (!group.module) continue;
    assert.equal(moduleLabel(group.module), group.title,
      `${group.module} reads as "${moduleLabel(group.module)}" on the roles screen but "${group.title}" in the sidebar`);
  }
});

test("every menu entry names its permission the way the menu does", () => {
  for (const group of MENU_GROUPS) {
    for (const item of group.items || []) {
      if (!item.href) continue;
      const permission = permissionForRoute(item.href);
      if (!permission) continue;
      // Several entries can answer to one permission - Employee Repository and Employee Attendance
      // are both HRM / Employee Management - so the label must be one of that permission's entries.
      const siblings = MENU_GROUPS.flatMap((g) => (g.items || []).filter((i) => {
        const p = i.href && permissionForRoute(i.href);
        return p && p.module === permission.module && p.feature === permission.feature;
      })).map((i) => i.label);
      assert.ok(siblings.includes(featureLabel(permission)),
        `${permission.module}/${permission.feature} reads as "${featureLabel(permission)}", which is no menu entry of its own`);
    }
  }
});

test("a permission with no menu entry keeps the name the server gave it", () => {
  // The extra fields: real permissions that open no screen by themselves.
  assert.equal(featureLabel({ module: "HRM", feature: "All Tasks", displayName: "View All Tasks" }), "View All Tasks");
  assert.equal(featureLabel({ module: "ASSET", feature: "Asset Request Approval", displayName: "Approve Asset Requests" }), "Approve Asset Requests");
  assert.equal(featureLabel({ module: "ADMIN", feature: "Role Management", displayName: "Manage Roles" }), "Manage Roles");
  // And with nothing to fall back on it still reads as something.
  assert.equal(featureLabel({ module: "X", feature: "Y" }), "Y");
  assert.equal(featureLabel(null), "");
});

test("Administration is named even though it has no menu group", () => {
  assert.equal(MODULE_LABELS.ADMIN, "Administration");
});

/*
 * And in the same order the sidebar puts them.
 *
 * `RoleDialog` groups by `permission.module` and drew the blocks in whatever order the catalogue
 * was written in, which listed Resource Management above HRM and Bookings & Converted above Leads
 * & Followups. The headings matched the menu and the sequence did not, so somebody hunting for a
 * screen's row had to look for it somewhere other than where they navigate to it.
 */

test("the roles screen lists its module blocks in sidebar order", () => {
  const inMenu = MENU_GROUPS.map((group) => group.module).filter(Boolean);
  // Shuffled deliberately: the assertion is that the sort decides the order, not the input.
  const sorted = sortModulesForMenu(["ADMIN", ...[...inMenu].reverse()]);
  assert.deepEqual(sorted.slice(0, inMenu.length), inMenu);
  // Administration has no menu group of its own, so it sorts after every module that does.
  assert.equal(sorted.at(-1), "ADMIN");
});

test("a module's rows follow the order its screens appear in the menu", () => {
  for (const group of MENU_GROUPS) {
    if (!group.module) continue;
    const screens = (group.items || [])
      .map((item) => permissionForRoute(item.href))
      .filter((permission) => permission?.module === group.module);
    if (screens.length < 2) continue;

    // A permission that opens no menu entry - Approve Asset Requests, View All Tasks - has nowhere
    // in the sequence to be, so it sorts after the screens that do rather than in among them.
    const screenless = { module: group.module, feature: "Not a screen in the menu" };
    const sorted = sortFeaturesForMenu([screenless, ...[...screens].reverse()]);

    assert.deepEqual(
      sorted.slice(0, screens.length).map((permission) => permission.feature),
      screens.map((permission) => permission.feature),
      `${group.title} rows are not in the order the menu lists its screens`);
    assert.equal(sorted.at(-1), screenless, `${group.title} put a screenless permission among its screens`);
  }
});
