/*
 * What a permission guard says when the check could not be made at all.
 *
 * There are two different failures behind one `catch`, and they had one answer between them. A
 * guard that cannot reach the database is a server fault: 500, nothing let through. A token that
 * names an account which no longer exists is not - it is the session being over, and the client
 * already knows what to do with a 401 (clear the token, sign the person out, show the login page).
 *
 * Answering that with a 500 is what produced the loop this pins: the browser kept the dead token,
 * every request came back "Permission check failed", and the screen sat there repeating it with no
 * way to reach login. `protect` cannot catch it - it verifies the signature and deliberately never
 * queries the user - so the guard is the first thing that can, and must say 401.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const iamService = require("../src/services/iam.service");
const { checkPermission, checkAnyPermission, checkBranchAccess } = require("../src/middleware/permissionMiddleware");
const prisma = require("../src/config/db");

/** A response that records what a guard said to it instead of writing to a socket. */
function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

/** Runs one guard against a request, with `iamService` answering however the case needs. */
async function runGuard(guard, answer, req = { user: { id: 1 }, method: "GET", query: {}, params: {} }) {
  const original = { hasPermission: iamService.hasPermission, canAccessBranch: iamService.canAccessBranch };
  iamService.hasPermission = answer;
  iamService.canAccessBranch = answer;
  const res = fakeResponse();
  let passed = false;
  try {
    await guard(req, res, () => { passed = true; });
  } finally {
    Object.assign(iamService, original);
  }
  return { res, passed };
}

const sessionGone = () => {
  const error = new Error("Your session is no longer valid. Please sign in again.");
  error.status = 401;
  error.code = "USER_NOT_FOUND";
  throw error;
};

test("a token whose account is gone is answered 401, not 500", async () => {
  const { res, passed } = await runGuard(checkPermission("SALES", "CRM Leads", "READ"), sessionGone);
  assert.equal(res.statusCode, 401, "a dead session is the session's fault, not the server's");
  assert.equal(res.body.code, "USER_NOT_FOUND");
  assert.match(res.body.message, /sign in again/i, "the message is the one the person reads");
  assert.equal(passed, false, "and nothing is let through");
});

test("every guard answers it the same way", async () => {
  const guards = [
    ["checkAnyPermission", checkAnyPermission([{ module: "SALES", feature: "CRM Leads", level: "READ" }])],
    // Branch reach is per-permission, so this guard now has to be told which permission it guards -
    // see `checkBranchAccess`. It refuses to be built without one rather than falling back to the
    // union, which would fail open on a write.
    ["checkBranchAccess", checkBranchAccess("branchId", { module: "ASSET", feature: "Asset Management" })],
  ];
  for (const [name, guard] of guards) {
    const req = { user: { id: 1 }, method: "GET", query: { branchId: "2" }, params: {} };
    const { res, passed } = await runGuard(guard, sessionGone, req);
    assert.equal(res.statusCode, 401, `${name} answered ${res.statusCode}`);
    assert.equal(passed, false, `${name} let the request through`);
  }
});

test("a check that genuinely failed is still a 500, and says nothing about why", async () => {
  // The other half of the pair: a database that cannot be reached is a server fault, and its
  // message stays in the log rather than going to the caller.
  const { res, passed } = await runGuard(checkPermission("SALES", "CRM Leads", "READ"), () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:3306");
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Permission check failed");
  assert.doesNotMatch(JSON.stringify(res.body), /ECONNREFUSED/, "internals do not go to the caller");
  assert.equal(passed, false);
});

test("the service is what carries the 401: an id nothing owns", async () => {
  // Read through the service itself, so the status is pinned where it is set rather than only where
  // it is honoured. No such user can exist - ids are assigned, and this one is beyond any of them.
  await assert.rejects(
    () => iamService.getUserWithPermissions(2_147_483_600),
    (error) => error.status === 401 && error.code === "USER_NOT_FOUND",
    "getUserWithPermissions must mark a missing account as an expired session",
  );
  await prisma.$disconnect();
});
