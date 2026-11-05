const test = require("node:test");
const assert = require("node:assert");
const registry = require("../src/services/ai/tools/registry");
const iamService = require("../src/services/iam.service");
const { buildAccessContext } = require("../src/services/ai/accessContext");

/**
 * The module isolation matrix.
 *
 * Every case here is a normal user trying, one way or another, to read a module their session does
 * not cover. The application currently has one account and it is a Super Admin, so these identities
 * are stubbed - which is the stronger test anyway: it pins the behaviour for the users who do not
 * exist yet, and it does not depend on which accounts happen to be seeded.
 *
 * The assertion that matters most is not the status code. It is `ran`: a denied tool must never
 * reach its execute function, because that function is where a service, a repository and Prisma
 * are. A refusal after the query has run is not a refusal.
 */

let ran = [];

function fixtureTools() {
  registry.resetRegistry();
  ran = [];
  for (const [name, module] of [
    ["sales.getLeads", "SALES"],
    ["hrm.getEmployees", "HRM"],
    ["imageselection.getProjects", "IMAGE_SELECTION"],
    ["asset.getAssets", "ASSET"],
    ["accounts.getSummary", "ACCOUNTS"],
  ]) {
    registry.registerTool({
      name,
      module,
      risk: "READ",
      description: `Test tool for ${module}`,
      // Records that it ran. Nothing else in these tests touches the database.
      execute: async () => { ran.push(name); return { ok: true }; },
    });
  }
}

/** A stubbed identity, resolved the way the real one is - from the service, not the request. */
function asUser({ role = "USER", permittedModules = [] }, run) {
  const real = {
    user: iamService.getUserWithPermissions,
    perm: iamService.hasPermission,
    branches: iamService.reachableBranchIds,
  };
  iamService.getUserWithPermissions = async () => ({ id: 24, name: "Test", role });
  iamService.hasPermission = async (_id, module) =>
    role === "SUPER_ADMIN" || permittedModules.includes(module);
  iamService.reachableBranchIds = async () => (role === "SUPER_ADMIN" ? null : [1]);

  return Promise.resolve().then(run).finally(() => {
    iamService.getUserWithPermissions = real.user;
    iamService.hasPermission = real.perm;
    iamService.reachableBranchIds = real.branches;
  });
}

const TOOL_OF = {
  SALES: "sales.getLeads",
  HRM: "hrm.getEmployees",
  IMAGE_SELECTION: "imageselection.getProjects",
  ASSET: "asset.getAssets",
  ACCOUNTS: "accounts.getSummary",
};
const MODULES = Object.keys(TOOL_OF);

test.beforeEach(fixtureTools);
test.after(() => registry.resetRegistry());

test("a session is offered only its own module's tools", () => asUser({ permittedModules: ["SALES"] }, async () => {
  const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
  const offered = registry.toolDefinitionsFor(context).map((tool) => tool.name);

  assert.deepStrictEqual(offered, ["sales.getLeads"]);
  // The model is never even told the others exist, so it cannot be talked into asking for them.
  for (const name of ["hrm.getEmployees", "asset.getAssets"]) {
    assert.ok(!offered.includes(name), name);
  }
}));

test("every module can use its own tools, and no others", async () => {
  for (const home of MODULES) {
    await asUser({ permittedModules: [home] }, async () => {
      const context = await buildAccessContext({ userId: 24, requestedModule: home });

      // Its own: allowed, and it runs.
      await registry.executeTool(TOOL_OF[home], {}, context);
      assert.ok(ran.includes(TOOL_OF[home]), `${home} should reach its own tool`);

      // Every other module: refused, and nothing runs.
      for (const other of MODULES.filter((m) => m !== home)) {
        const before = [...ran];
        await assert.rejects(
          () => registry.executeTool(TOOL_OF[other], {}, context),
          (error) => error.code === "AI_TOOL_OUT_OF_SCOPE",
          `${home} must not reach ${other}`,
        );
        assert.deepStrictEqual(ran, before, `${home} → ${other} reached the service anyway`);
      }
    });
  }
});

test("a denied tool never reaches its execute function", () => asUser({ permittedModules: ["SALES"] }, async () => {
  /*
   * Stated on its own because it is the whole point. Everything past `execute` is a real service, a
   * real repository and a real query; a check that happens after that has already leaked the data.
   */
  const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
  await assert.rejects(() => registry.executeTool("hrm.getEmployees", {}, context));
  await assert.rejects(() => registry.executeTool("accounts.getSummary", {}, context));
  assert.deepStrictEqual(ran, [], "a refused tool ran");
}));

test("a normal user cannot open the global scope", () => asUser({ permittedModules: MODULES }, async () => {
  // Permitted in every module individually, and still not permitted to hold them all at once.
  await assert.rejects(
    () => buildAccessContext({ userId: 24, requestedModule: "GLOBAL" }),
    (error) => error.code === "AI_MODULE_FORBIDDEN",
  );
}));

test("a Super Admin's global session reaches every module", () => asUser({ role: "SUPER_ADMIN" }, async () => {
  const context = await buildAccessContext({ userId: 1, requestedModule: "GLOBAL" });
  const offered = registry.toolDefinitionsFor(context).map((tool) => tool.name);
  assert.strictEqual(offered.length, MODULES.length);

  for (const module of MODULES) {
    await registry.executeTool(TOOL_OF[module], {}, context);
  }
  assert.strictEqual(ran.length, MODULES.length, "global should reach all modules");
}));

test("a Super Admin who opened one module stays inside it", () => asUser({ role: "SUPER_ADMIN" }, async () => {
  /*
   * Opening CRM deliberately must not quietly become a cross-module session - otherwise an admin
   * asking a CRM question could be answered with HR data they did not ask to mix in.
   */
  const context = await buildAccessContext({ userId: 1, requestedModule: "SALES" });
  assert.deepStrictEqual(registry.toolDefinitionsFor(context).map((t) => t.name), ["sales.getLeads"]);

  await assert.rejects(
    () => registry.executeTool("hrm.getEmployees", {}, context),
    (error) => error.code === "AI_TOOL_OUT_OF_SCOPE",
  );
  assert.deepStrictEqual(ran, []);
}));

test("losing the permission mid-session stops the next tool call", () => asUser({ permittedModules: ["SALES"] }, async () => {
  /*
   * A conversation can outlive a permission change. The context was built when the session opened;
   * the permission is read again at execution, so the answer follows the permission rather than the
   * session.
   */
  const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
  await registry.executeTool("sales.getLeads", {}, context);
  assert.deepStrictEqual(ran, ["sales.getLeads"]);

  iamService.hasPermission = async () => false;
  await assert.rejects(
    () => registry.executeTool("sales.getLeads", {}, context),
    (error) => error.code === "AI_TOOL_FORBIDDEN",
  );
  assert.deepStrictEqual(ran, ["sales.getLeads"], "it ran again after the permission was withdrawn");
}));

test("an invented tool name is refused and tells the caller nothing", () => asUser({ permittedModules: ["SALES"] }, async () => {
  const context = await buildAccessContext({ userId: 24, requestedModule: "SALES" });
  for (const name of ["hrm.getSalaries", "sales.runSql", "", "../../etc/passwd", "sales.getLeads "]) {
    await assert.rejects(
      () => registry.executeTool(name, {}, context),
      (error) => error.code === "AI_TOOL_UNKNOWN" || error.code === "AI_TOOL_OUT_OF_SCOPE",
      JSON.stringify(name),
    );
  }
  assert.deepStrictEqual(ran, []);
}));

test("a spoofed context cannot widen its own scope", () => asUser({ permittedModules: ["SALES"] }, async () => {
  /*
   * If something downstream ever hands `executeTool` a hand-built context, the module list still
   * decides - and the permission is still re-read. A forged `isSuperAdmin` buys nothing because
   * nothing reads it here.
   */
  const forged = { userId: 24, modules: ["SALES", "HRM", "ACCOUNTS"], isSuperAdmin: true, scope: "GLOBAL" };
  await assert.rejects(
    () => registry.executeTool("hrm.getEmployees", {}, forged),
    // The module list lets it past scope, and the real permission check stops it.
    (error) => error.code === "AI_TOOL_FORBIDDEN",
  );
  assert.deepStrictEqual(ran, []);
}));
