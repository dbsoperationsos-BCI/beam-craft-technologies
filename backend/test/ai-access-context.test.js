const test = require("node:test");
const assert = require("node:assert");
const { buildAccessContext, AiAccessError } = require("../src/services/ai/accessContext");
const iamService = require("../src/services/iam.service");

/**
 * Who the assistant thinks you are, and what it lets you reach.
 *
 * The identity is read from the database on every request rather than taken from the JWT, and these
 * tests pin that down by lying in every way a caller could. The JWT is signed, so `role` inside it
 * cannot be forged - but it was signed at login and lasts seven days, so a Super Admin demoted this
 * morning still carries SUPER_ADMIN until next week. For the switch that opens every module at
 * once, a week is not an acceptable window.
 *
 * The IAM service is stubbed so these run without a seeded database and without depending on which
 * accounts happen to exist.
 */

function withUser({ role = "USER", permitted = true, branches = [] }, run) {
  const realUser = iamService.getUserWithPermissions;
  const realPerm = iamService.hasPermission;
  const realBranches = iamService.reachableBranchIds;

  iamService.getUserWithPermissions = async () => ({ id: 24, name: "Test User", role });
  iamService.hasPermission = async () => (role === "SUPER_ADMIN" ? true : permitted);
  iamService.reachableBranchIds = async () => (role === "SUPER_ADMIN" ? null : branches);

  return Promise.resolve()
    .then(run)
    .finally(() => {
      iamService.getUserWithPermissions = realUser;
      iamService.hasPermission = realPerm;
      iamService.reachableBranchIds = realBranches;
    });
}

const refusedWith = (code) => (error) => error instanceof AiAccessError && error.code === code;

test("a permitted user gets exactly one module", () => withUser({ permitted: true }, async () => {
  const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
  assert.strictEqual(context.scope, "SALES");
  assert.strictEqual(context.feature, "CRM Leads");
  assert.strictEqual(context.isSuperAdmin, false);
  // One, and only one: a normal session cannot widen past the module it was opened in.
  assert.deepStrictEqual(context.modules, ["SALES"]);
}));

test("a user without the permission is refused their own module", () => withUser({ permitted: false }, async () => {
  await assert.rejects(
    () => buildAccessContext({ userId: 24, requestedModule: "HRM" }),
    refusedWith("AI_MODULE_FORBIDDEN"),
  );
}));

test("a normal user cannot ask for the global scope", () => withUser({ role: "USER", permitted: true }, async () => {
  /*
   * The request the whole file exists to refuse. A browser can put anything in a JSON body; being
   * able to type "GLOBAL" must not be the same as being allowed it.
   */
  await assert.rejects(
    () => buildAccessContext({ userId: 24, requestedModule: "GLOBAL" }),
    refusedWith("AI_MODULE_FORBIDDEN"),
  );
}));

test("a Super Admin gets the global scope and every registered module", () => withUser({ role: "SUPER_ADMIN" }, async () => {
  const context = await buildAccessContext({ userId: 1, requestedModule: "GLOBAL" });
  assert.strictEqual(context.scope, "GLOBAL");
  assert.strictEqual(context.isSuperAdmin, true);
  assert.ok(context.modules.includes("SALES"));
  assert.ok(context.modules.includes("HRM"));
  // Not confined to a branch, which is a different thing from being confined to none.
  assert.strictEqual(context.branchIds, null);
}));

test("a Super Admin opening one module stays in that module", () => withUser({ role: "SUPER_ADMIN" }, async () => {
  // Opening CRM deliberately should not quietly become a cross-module session.
  const context = await buildAccessContext({ userId: 1, requestedModule: "SALES" });
  assert.strictEqual(context.scope, "SALES");
  assert.deepStrictEqual(context.modules, ["SALES"]);
}));

test("an unregistered module is refused before any permission is consulted", () => withUser({ permitted: true }, async () => {
  for (const name of ["TECHNICAL", "CRM", "IMAGESELECTION", "nonsense"]) {
    await assert.rejects(
      () => buildAccessContext({ userId: 24, requestedModule: name }),
      refusedWith("AI_MODULE_UNKNOWN"),
      name,
    );
  }
}));

test("no module named is a refusal, not a default", () => withUser({ permitted: true }, async () => {
  // Defaulting to a module would mean a missing field silently picks one.
  for (const missing of ["", "   ", null, undefined]) {
    await assert.rejects(
      () => buildAccessContext({ userId: 24, requestedModule: missing }),
      refusedWith("AI_MODULE_REQUIRED"),
    );
  }
}));

test("an unauthenticated or deleted account is refused", async () => {
  for (const userId of [undefined, null, "", "abc", NaN]) {
    await assert.rejects(
      () => buildAccessContext({ userId, requestedModule: "SALES" }),
      refusedWith("AI_UNAUTHENTICATED"),
    );
  }

  const real = iamService.getUserWithPermissions;
  iamService.getUserWithPermissions = async () => null;
  try {
    await assert.rejects(
      () => buildAccessContext({ userId: 999999, requestedModule: "SALES" }),
      refusedWith("AI_UNAUTHENTICATED"),
    );
  } finally {
    iamService.getUserWithPermissions = real;
  }
});

test("nothing in the request body can make someone a Super Admin", () => withUser({ role: "USER", permitted: true }, async () => {
  /*
   * The spoofing matrix. Every one of these is a field a browser could send and a naive
   * implementation could read; none of them is read at all.
   */
  const spoofed = {
    userId: 24,
    requestedModule: "GLOBAL",
    isSuperAdmin: true,
    role: "SUPER_ADMIN",
    permissions: ["*"],
    globalAccess: true,
    branchId: null,
    employeeId: 1,
    dataScope: "all",
  };
  await assert.rejects(() => buildAccessContext(spoofed), refusedWith("AI_MODULE_FORBIDDEN"));

  // And the resolved context never carries a claim that came from the caller.
  const context = await buildAccessContext({ ...spoofed, requestedModule: "SALES" });
  assert.strictEqual(context.isSuperAdmin, false);
  assert.strictEqual(context.userId, 24);
}));

test("a failure to resolve branch scope means no branches, not all of them", () => withUser({ permitted: true }, async () => {
  const real = iamService.reachableBranchIds;
  iamService.reachableBranchIds = async () => { throw new Error("database down"); };
  try {
    const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
    // An empty list matches nothing; null would mean "unlimited" and is the Super Admin's value.
    assert.deepStrictEqual(context.branchIds, []);
  } finally {
    iamService.reachableBranchIds = real;
  }
}));
