const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * `Employee.loginUsername` mirrors `User.username`, so a lookup by login - the CRM's Google Sheet
 * sync foremost, through `referenceMatchers.js` - reads one table instead of joining to `User`.
 * It is not a second place a username is *decided*: it is written only by the two places that
 * ever set `User.username` itself, in the same transaction as that write.
 *
 * Read from source rather than a live database, the way `crm-lead-tabs.test.js` is: the two write
 * paths this pins run inside HTTP handlers, and the fixture other test files reach for - a `User`
 * created directly by `prisma.user.create` for an unrelated scoping check - has no reason to go
 * through either of them, so a live invariant test here would fail on somebody else's fixture
 * rather than on a real drift. Source patterns catch the same thing without that hazard.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
const USER_ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "user", "routes.js"), "utf8");
const MATCHERS = fs.readFileSync(path.join(__dirname, "..", "src", "services", "referenceMatchers.js"), "utf8");
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("account creation mirrors the username it just set onto the employee, in the same transaction", () => {
  const created = CONTROLLER.slice(CONTROLLER.indexOf("const user = await prisma.$transaction("), CONTROLLER.indexOf("return created;"));
  assert.match(created, /username: parsed\.data\.username,/, "the account is no longer created with the username the form sent");
  assert.match(created, /loginUsername: created\.username,/, "the employee row is no longer given the username the account was just created with");
});

test("the self-service profile edit keeps the mirror in the same transaction as the real write", () => {
  const route = USER_ROUTES.slice(USER_ROUTES.indexOf('router.patch("/profile"'), USER_ROUTES.indexOf('router.patch("/profile-photo"'));
  assert.match(route, /prisma\.\$transaction\(async \(transaction\) => \{/, "the username write and the mirror are no longer one transaction");
  assert.match(route, /if \(data\.username !== undefined && user\.linkedEmployeeId\)/, "a profile edit with no username, or a login with no employee, must not touch the mirror");
  assert.match(route, /loginUsername: data\.username/, "the mirror is no longer written from the value actually saved");
});

test("nothing else writes Employee.loginUsername", () => {
  /*
   * `controller.js` names `loginUsername:` twice: the real write checked above, and an unrelated
   * field of the same name on the employee-list API response (`loginUsername: loginFor.get(...)`)
   * - a value it has always sent, computed the old way, that happens to share this name. Counted
   * apart so a third, unexpected write to the column does not hide behind that coincidence.
   */
  const controllerCount = (CONTROLLER.match(/loginUsername:/g) || []).length;
  const responseField = (CONTROLLER.match(/loginUsername: loginFor\.get\(employee\.id\)\?\.username/g) || []).length;
  assert.equal(controllerCount - responseField, 1, "controller.js writes Employee.loginUsername somewhere other than account creation");
  assert.equal((USER_ROUTES.match(/loginUsername:/g) || []).length, 1, "user/routes.js writes Employee.loginUsername somewhere other than the profile mirror");
});

test("the owner matcher reads loginUsername off the employee row, not a second query to User", () => {
  const load = MATCHERS.slice(MATCHERS.indexOf("async function load()"), MATCHERS.indexOf("module.exports"));
  // `aliases` beside it since 20260924140000: the names the person gave up, read off the same row.
  assert.match(load, /prisma\.employee\.findMany\(\{ select: \{ id: true, employeeId: true, employeeName: true, loginUsername: true, aliases: true \} \}\)/, "load() no longer selects loginUsername, or is back to joining User for it");
  assert.doesNotMatch(load, /prisma\.user\.findMany/, "load() is joining to User again, which the column on Employee exists to avoid");
});

test("the field is documented as a mirror, not a second source of truth", () => {
  // From the doc comment above the field to just past its own declaration line.
  const start = SCHEMA.indexOf("The login username of the account this employee holds");
  const end = SCHEMA.indexOf("employmentStatus", start);
  const field = SCHEMA.slice(start, end);
  assert.match(field, /loginUsername\s+String\?\s+@unique @map\("login_username"\)/, "loginUsername is no longer a unique column, or moved away from its documentation");
  assert.match(field, /mirrored onto this/i, "the schema no longer explains that this is a mirror rather than an independent field");
  assert.match(field, /Not a second place a username is \*decided\*/, "the schema no longer warns against writing this field directly");
});
