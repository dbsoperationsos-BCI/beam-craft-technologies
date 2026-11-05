const test = require("node:test");
const assert = require("node:assert");
const prisma = require("../src/config/db");
const { AI_MODULES, findModule, permissionModuleFor, isGlobal, isKnownScope, moduleIds } = require("../src/services/ai/modules");

/**
 * The AI module registry, against the permission table it mirrors.
 *
 * This is the test that matters most in Phase 1. An AI scope whose `module`+`feature` pair was
 * never seeded cannot be checked - `checkPermission` looks that pair up, finds nothing, and the
 * result depends on which helper was called rather than on what the user may do. A registry that
 * drifts from the database is an access control system that has quietly stopped working, and
 * nothing about it looks broken.
 */

test("every registered AI module is a real permission", async () => {
  const rows = await prisma.permission.findMany({ select: { module: true, feature: true } });
  const real = new Set(rows.map((row) => `${row.module}::${row.feature}`));

  for (const entry of Object.values(AI_MODULES)) {
    /*
     * The pair actually checked, which is not always the scope's own id: PROJECT is a screen
     * governed by SALES / Project Management. Asserting `entry.id` would pass for scopes named
     * after their permission and quietly miss the one that is not.
     */
    const permissionModule = permissionModuleFor(entry);
    assert.ok(
      real.has(`${permissionModule}::${entry.feature}`),
      `AI module ${entry.id} is checked against ${permissionModule}/${entry.feature}, which is not in the permission table`,
    );
  }
});

test("the modules that do not exist are not registered", () => {
  /*
   * Named individually because each was in the original specification and none of them exists:
   * there is no TECHNICAL permission at all, and "project"/"crm" are features of other modules
   * rather than modules. Registering any of them would advertise a scope with nothing behind it.
   */
  for (const absent of ["TECHNICAL", "CRM", "IMAGESELECTION"]) {
    assert.strictEqual(findModule(absent), null, `${absent} should not be registered`);
  }
});

test("ADMIN is registered but has no tools", () => {
  /*
   * Present so the assistant appears on every signed-in screen, and toolless on purpose: this is
   * the module that grants every other module, and role and user management is not work an
   * assistant should be reasoning about. It can talk there and read nothing.
   */
  const admin = findModule("ADMIN");
  assert.ok(admin, "ADMIN should be a registered scope");
  const registry = require("../src/services/ai/tools/registry");
  require("../src/services/ai/tools").registerAllTools();
  assert.deepStrictEqual(
    registry.toolsFor({ modules: ["ADMIN"] }),
    [],
    "no tool may be registered against ADMIN",
  );
});

test("PROJECT is checked against a permission that exists", () => {
  /*
   * A scope checked against a `module`/`feature` pair the seed never created would match nothing,
   * and the check would pass or fail depending on which helper was used - which is how an access
   * control system ends up open.
   *
   * This asserted `SALES / Project Management` until that pair was removed from the catalogue by
   * the IAM restructure. It kept passing on databases seeded before the change and failed on fresh
   * ones, so the pair is named here *and* checked against the live table by the first test above.
   */
  const project = findModule("PROJECT");
  assert.strictEqual(permissionModuleFor(project), "PROJECT");
  assert.strictEqual(project.feature, "Projects");
});
test("a module name is matched however it is written", () => {
  assert.strictEqual(findModule("sales").id, "SALES");
  assert.strictEqual(findModule("  Sales  ").id, "SALES");
  assert.strictEqual(findModule("IMAGE_SELECTION").id, "IMAGE_SELECTION");
});

test("GLOBAL is a scope but never a permission", async () => {
  assert.ok(isGlobal("global"));
  assert.ok(isKnownScope("GLOBAL"));
  // It must not be registered as a module, or a permission check could appear to grant it.
  assert.strictEqual(findModule("GLOBAL"), null);
  assert.ok(!moduleIds().includes("GLOBAL"));

  const seeded = await prisma.permission.findFirst({ where: { module: "GLOBAL" } });
  assert.strictEqual(seeded, null, "GLOBAL must never be seeded as a permission");
});

test("an unknown scope is not known", () => {
  for (const name of ["", "   ", "nonsense", "sales; drop table", null, undefined]) {
    assert.ok(!isKnownScope(name), JSON.stringify(name));
  }
});
