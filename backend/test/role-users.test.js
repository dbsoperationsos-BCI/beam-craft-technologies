const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Administration → Roles → a role's Manage Users section.
 *
 * Who carries a role is changed through `/users/:userId/roles`, which answers to User Management,
 * so the list those changes are made against must answer to the same permission, be narrowed the
 * same way `GET /users` is, and count only the accounts the role's own `_count.users` counts.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");
const handler = ROUTES.slice(ROUTES.indexOf('router.get("/roles/:roleId/users"'), ROUTES.indexOf('router.post("/roles"'));

test("a role's users are read under User Management, not Role Management", () => {
  assert.match(handler, /router\.get\("\/roles\/:roleId\/users", READ_USERS, /);
  assert.doesNotMatch(handler, /READ_ROLES/);
});

test("a role's users are narrowed by the caller's User Management branches", () => {
  assert.match(handler, /buildBranchFilter\(req\.user\.id, \{ module: "ADMIN", feature: "User Management" \}\)/);
  assert.match(handler, /\.\.\.branchFilter/);
});

test("only active accounts carrying the role are listed, with the shape the Users list returns", () => {
  assert.match(handler, /status: "ACTIVE"/);
  assert.match(handler, /roles: \{ some: \{ roleId: req\.params\.roleId \} \}/);
  assert.match(handler, /select: userFields/);
  assert.match(handler, /withLinkedEmployees\(users\)/);
});
