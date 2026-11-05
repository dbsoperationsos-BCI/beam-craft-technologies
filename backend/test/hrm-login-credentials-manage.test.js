const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { credentialUpdateSchema } = require("../src/modules/hrm/employees/controller");

/*
 * Looking after an account that already exists, from Edit Employee.
 *
 * The page is the same one onboarding shows, doing the other half of the job: onboarding issues an
 * account, this changes what an existing one may do and who covers the person while they are away.
 *
 * The line between the two is the whole point, and it is a line about *who owns what*. An identity —
 * username, email, password — belongs to Admin → User Management, which is the one screen that owns
 * accounts. Two screens writing an identity is how the two end up disagreeing about who somebody is,
 * and a password field here would be a second way to take an account over. So the schema below must
 * not accept any of the three, whatever the browser sends.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "master-data", "routes.js"), "utf8");

test("the update takes what the account may do, and who covers for the person", () => {
  const parsed = credentialUpdateSchema.safeParse({
    roleIds: ["role-a", "role-b"],
    alternative1EmployeeId: "6",
    leaveApprover1EmployeeId: "7",
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.roleIds, ["role-a", "role-b"]);
  // Ids arrive as the strings the form holds and come back as numbers, the same way the draft does.
  assert.equal(parsed.data.alternative1EmployeeId, 6);
  assert.equal(parsed.data.leaveApprover1EmployeeId, 7);
});

test("an account may be stripped of every role, which is a decision rather than an omission", () => {
  // Sent as an empty list, not as nothing: the page shows the roles it is about to save, so a
  // reader who removed the last one means the account to have none.
  const parsed = credentialUpdateSchema.safeParse({ roleIds: [] });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.roleIds, []);
  // And a payload that names no roles at all still says "no roles" rather than leaving them alone,
  // because the write replaces them.
  assert.deepEqual(credentialUpdateSchema.safeParse({}).data.roleIds, []);
});

test("the sign-in identity cannot be changed through this endpoint", () => {
  /*
   * Dropped rather than refused: zod strips what it does not declare, so a browser sending them
   * changes nothing. Asserted on the parsed output, because that is what the handler writes from.
   */
  const parsed = credentialUpdateSchema.safeParse({
    roleIds: [],
    username: "someone.else",
    email: "someone.else@dbs.in",
    temporaryPassword: "hunter2",
    password: "hunter2",
  });
  assert.equal(parsed.success, true);
  for (const field of ["username", "email", "temporaryPassword", "password"]) {
    assert.equal(parsed.data[field], undefined, `${field} reached the update payload`);
  }
});

test("both routes are behind User Management, like the draft beside them", () => {
  /*
   * The router carries a blanket pass for signed-in readers because it serves departments and
   * branches. Who may sign in as whom is not reference data, so these two carry their own guard in
   * the controller — the same one the draft endpoints carry, and for the same reason.
   */
  assert.match(ROUTES, /router\.get\("\/employees\/:id\/login-credentials", getLoginCredentials\)/);
  assert.match(ROUTES, /router\.patch\("\/employees\/:id\/login-credentials", updateLoginCredentials\)/);
  const read = CONTROLLER.slice(CONTROLLER.indexOf("async function getLoginCredentials(req, res)"), CONTROLLER.indexOf("const credentialUpdateSchema"));
  assert.match(read, /if \(!\(await mayHandleCredentials\(req, res\)\)\) return undefined;/);
  const write = CONTROLLER.slice(CONTROLLER.indexOf("async function updateLoginCredentials(req, res)"), CONTROLLER.indexOf("The draft as it will be filled back into the page"));
  assert.match(write, /if \(!\(await mayHandleCredentials\(req, res\)\)\) return undefined;/);
});

test("roles and cover are written together or not at all", () => {
  /*
   * They live in two places — roles on the account, cover and leave approval on the employee — and
   * an account left carrying roles nobody asked for because the second write failed is the state
   * `createLoginCredentials` already takes a transaction to avoid.
   */
  const write = CONTROLLER.slice(CONTROLLER.indexOf("async function updateLoginCredentials(req, res)"), CONTROLLER.indexOf("The draft as it will be filled back into the page"));
  assert.match(write, /await prisma\.\$transaction\(async \(transaction\) => \{/);
  assert.match(write, /transaction\.userRole\.deleteMany\(\{ where: \{ userId: user\.id \} \}\)/);
  assert.match(write, /transaction\.employee\.update\(/);
  // An employee with no account is not quietly given one here: creating is the other endpoint.
  assert.match(write, /This employee has no login credentials yet\./);
});

test("reading answers null for an employee with no login, rather than 404", () => {
  // The employee exists; it is the account that does not. A 404 would read as "no such employee"
  // and the page would have nothing to show, when what it should show is the create form.
  const start = CONTROLLER.indexOf("async function getLoginCredentials(req, res)");
  const read = CONTROLLER.slice(start, CONTROLLER.indexOf("\n}", start));
  assert.match(read, /if \(!user\) return res\.json\(\{ data: null \}\);/);
  // And the identity it does return carries no password, hashed or otherwise: the row holds a
  // bcrypt hash, and a hash is still the thing that opens the account to anyone who can grind it.
  assert.doesNotMatch(read, /password/i, "the account read hands back something about a password");
});
