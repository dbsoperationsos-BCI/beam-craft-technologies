const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const iamService = require("../src/services/iam.service");
const router = require("../src/modules/sales/projects/routes");

/*
 * A project's Payments section is on Edit Project and on the Production and Pre Production project
 * panels. Reading it asks ACCOUNTS / Cash Management (Read) every time - a board alone shows no money -
 * and one of PROJECT / Projects, Production or Pre Production (Read). Recording cash stays on Accounts'
 * own routes (Cash Management, Read / Write) and raising an extra on the extra quotations' own routes
 * (PROJECT / Projects, Read / Write), unchanged.
 */

const READ_LEVELS = { READ: ["READ", "READ_WRITE"], READ_WRITE: ["READ_WRITE"] };

/** Runs the route's own guards - not a copy of them - for a caller holding `grants` ("MODULE/Feature/LEVEL"). */
async function reaches(grants) {
  const layer = router.stack.find((entry) => entry.route?.path === "/projects/:id/payments" && entry.route.methods.get);
  assert.ok(layer, "the route exists");
  const handlers = layer.route.stack.map((entry) => entry.handle);
  const held = new Set(grants);
  const original = iamService.hasPermission;
  iamService.hasPermission = async (_userId, module, feature, level) => READ_LEVELS[level || "READ"].some((wanted) => held.has(`${module}/${feature}/${wanted}`));
  try {
    // Every handler but the last (the controller) is a guard; the request reaches the controller or is refused.
    for (const handler of handlers.slice(0, -1)) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
      let passed = false;
      await handler({ user: { id: 1 }, params: { id: "p1" } }, res, (error) => { passed = !error; });
      if (!passed) return res.statusCode;
    }
    return "allowed";
  } finally {
    iamService.hasPermission = original;
  }
}

test("Production or Pre Production with Cash Management Read may read a project's payments", async () => {
  assert.equal(await reaches(["PROJECT/Production/READ", "ACCOUNTS/Cash Management/READ"]), "allowed");
  assert.equal(await reaches(["PROJECT/Pre Production/READ", "ACCOUNTS/Cash Management/READ"]), "allowed");
  // Edit Project, as before.
  assert.equal(await reaches(["PROJECT/Projects/READ", "ACCOUNTS/Cash Management/READ"]), "allowed");
  assert.equal(await reaches(["PROJECT/Production/READ_WRITE", "ACCOUNTS/Cash Management/READ_WRITE"]), "allowed");
});

test("a board alone, Cash Management alone, or nothing is refused", async () => {
  assert.equal(await reaches(["PROJECT/Production/READ"]), 403, "a board shows no money without Accounts");
  assert.equal(await reaches(["PROJECT/Pre Production/READ"]), 403);
  assert.equal(await reaches(["ACCOUNTS/Cash Management/READ"]), 403, "Accounts alone opens no project");
  assert.equal(await reaches(["PROJECT/CRD Documents/READ", "ACCOUNTS/Cash Management/READ"]), 403, "only the three project screens");
  assert.equal(await reaches([]), 403);
});

test("the read is narrowed to the projects the reader can reach; the writes keep their own guards", () => {
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function listProjectPayments("), CONTROLLER.indexOf("async function listProjectPayments(") + 600);
  assert.match(body, /AND: \[await projectAccessWhere\(\{ userId: Number\(req\.user\.id\) \}\)\]/);
  // Recording cash is Accounts' own write; an extra is written under PROJECT / Projects.
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "cash-entries", "routes.js"), "utf8"), /router\.use\(requireModule\("ACCOUNTS", "Cash Management"\)\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "extra-quotations", "routes.js"), "utf8"), /router\.use\(requireModule\("PROJECT", "Projects"\)\);/);
});
