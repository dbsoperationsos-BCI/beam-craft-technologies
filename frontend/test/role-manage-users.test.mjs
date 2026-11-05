import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Administration → Roles: who carries a role is chosen on the role form itself, in a Manage Users
 * section, rather than in a dialog of its own from the row menu.
 *
 * The section answers to User Management - the permission of the endpoints that assign and remove a
 * role - so it is absent for a viewer without it, a list with no controls for READ, and editable for
 * READ_WRITE. Its answer is held on the form and handed over on save, since a new role has no id to
 * assign anybody to until then.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const DIALOG = src("components", "admin", "RoleDialog.js");
const MANAGEMENT = src("components", "admin", "RoleManagement.js");
const PICKER = src("components", "shared", "RolePicker.js");
const SERVICE = src("services", "admin", "admin.service.js");

test("the role form carries a Manage Users section, only for a viewer with User Management", () => {
  assert.match(DIALOG, /\.\.\.\(usersAccess \? \[\{\s*id: "users",\s*title: "Manage Users",/);
  assert.match(DIALOG, /name: "userIds",/);
  assert.match(DIALOG, /readOnly=\{!usersEditable\}/);
});

test("the section's permission comes from User Management, not Role Management", () => {
  assert.match(MANAGEMENT, /hasPermission\("ADMIN", "User Management", "READ_WRITE"\) \? "READ_WRITE"/);
  assert.match(MANAGEMENT, /hasPermission\("ADMIN", "User Management", "READ"\) \? "READ" : null/);
});

test("a locked role can still be saved for its users alone", () => {
  assert.match(DIALOG, /const formReadOnly = readOnly && !usersEditable;/);
  assert.match(DIALOG, /onSubmit=\{formReadOnly \? undefined : submit\}/);
  // Its branches are not being changed, so they are not asked for.
  assert.match(DIALOG, /if \(!readOnly && branchesMissing\) \{/);
});

test("the users are read from the role's own endpoint", () => {
  assert.match(SERVICE, /export const getRoleUsers = \(roleId\) => apiRequest\(`\/api\/admin\/roles\/\$\{roleId\}\/users`\);/);
  assert.match(MANAGEMENT, /getRoleUsers\(role\.id\)/);
});

test("saving hands over only who was added and who was removed, after the role itself", () => {
  const save = MANAGEMENT.slice(MANAGEMENT.indexOf("const save = async"), MANAGEMENT.indexOf("const openRole = async"));
  const roleSaved = save.indexOf("createRole(payload)");
  const usersSaved = save.indexOf("roleUserChanges(editing.heldUserIds, editing.values.userIds)");
  assert.ok(roleSaved > -1 && usersSaved > roleSaved, "users are assigned after the role is saved");
  assert.match(save, /assignRoleToUser\(userId, roleId\)/);
  assert.match(save, /removeRoleFromUser\(userId, roleId\)/);
});

test("roleUserChanges is the difference between the two lists, both ways", async () => {
  const body = DIALOG.slice(DIALOG.indexOf("export function roleUserChanges"));
  const roleUserChanges = new Function(`${body.replace("export ", "")}; return roleUserChanges;`)();
  assert.deepEqual(roleUserChanges([1, 2, 3], [2, 3, 4]), { add: [4], remove: [1] });
  assert.deepEqual(roleUserChanges([1], [1]), { add: [], remove: [] });
  assert.deepEqual(roleUserChanges(undefined, [5]), { add: [5], remove: [] });
});

test("the separate Manage Users dialog and its row-menu entry are gone", () => {
  assert.doesNotMatch(MANAGEMENT, /RoleUsersDialog/);
  assert.doesNotMatch(MANAGEMENT, /label: "Manage Users"/);
  assert.equal(fs.existsSync(path.join(HERE, "..", "src", "components", "admin", "RoleUsersDialog.js")), false);
});

test("a read-only picker shows the list with no controls, not disabled ones", () => {
  assert.match(PICKER, /\{!readOnly && options\.length > 0 && /);
  assert.match(PICKER, /\{!readOnly && <Button type="button" size="sm" variant="ghost"/);
});
