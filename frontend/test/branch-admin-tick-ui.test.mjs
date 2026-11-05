import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Branch Admin on the role editor.
 *
 * Ticking it fills the matrix with **everything**, to be cut back from there - an administrator
 * starts from "all of it" and the studio takes away what this one has no business in. The tick then
 * **survives the editing**: it used to clear the moment any module was touched, because a role
 * differing from the shared Admin Permission set was no longer carrying that set. There is no set
 * now - what a branch admin may do is their own matrix - so there is nothing to differ from, and
 * cutting a permission out does not stop somebody administering a branch.
 */
const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "admin", "RoleDialog.js"), "utf8");

test("ticking it fills every module at Read / Write", () => {
  assert.match(DIALOG, /const everyPermissionRow = permissions\.map\(\(permission\) => \(\{ permissionId: permission\.id, accessLevel: "READ_WRITE", permission \}\)\);/);
  assert.match(DIALOG, /if \(checked\) mergeIntoMatrix\(everyPermissionRow\);/);
});

test("editing the matrix afterwards leaves the role a Branch Admin", () => {
  // The module block is handed the setter and nothing else: no untick rides along with an edit.
  assert.match(DIALOG, /onChange=\{set\}/);
  assert.doesNotMatch(DIALOG, /if \(current\.isBranchManager === true\) onChange\("isBranchManager", false\)/);
});

test("the shared Admin Permission set is gone from the screens", () => {
  const admin = (file) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "admin", file), "utf8");
  for (const file of ["RoleDialog.js", "RoleManagement.js", "AdminPage.js"]) {
    assert.doesNotMatch(admin(file), /AdminPermissionDialog|adminPermissions|openAdminPermission/, file);
  }
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "admin", "AdminPermissionDialog.js")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(import.meta.dirname, "..", "src", "services", "admin", "admin.service.js"), "utf8"), /branch-admin-permissions/);
});

test("the tick says what it does: every record in the role's branches", () => {
  assert.match(DIALOG, /label="Branch Admin — sees every record in this role's branches"/);
  // The explanation is the tick's helperText (its ⓘ), not a paragraph under it.
  assert.match(DIALOG, /helperText="[^"]*Ticking it fills every module below at Read \/ Write[^"]*"/);
});
