const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const dataScope = require("../src/services/dataScope.service");
const assetRead = require("../src/modules/assets/assets.read.service");

/*
 * Whose rows a request gets, proven on Assets - the one table that already carried both a branch
 * reference and the people named on it, so it needed no conversion to be the proof.
 *
 * The rule under test is the studio's only one: **your name, and your team's**. What matters most
 * here are the two cases the settings model got wrong and this one exists for - an asset in a branch
 * you do not reach, with your name on it, is yours; and an asset a colleague holds in the branch you
 * work in is not.
 *
 * Real rows rather than a fake repository: the point of the resolver is the `where` it hands to
 * Prisma and the recursive query it runs, and neither is worth anything asserted against a stub.
 * Everything created here carries the TDS prefix and is removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TDS-${STAMP}-${name}`;
const COLUMNS = assetRead.ASSET_SCOPE_COLUMNS;
const F = {};

async function employee(name, reportsToEmployeeId = null) {
  return prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Scope ${name}`, reportsToEmployeeId } });
}

async function login(name, { branchId, linkedEmployeeId = null, role = "ADMIN" } = {}) {
  const user = await prisma.user.create({ data: { name: `Scope ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role, branchId, linkedEmployeeId } });
  F.users.push(user.id);
  return user;
}

/** Runs `body` with `user` holding Asset Management, reaching `reachBranchIds` besides their own branch. */
async function withGrant(user, reachBranchIds, body, { administersBranches = false } = {}) {
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 6)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: F.permission.id, accessLevel: "READ" } });
  if (administersBranches) await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: F.branchAdmin.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  try {
    return await body(await resolveFor(user));
  } finally {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  }
}

const resolveFor = (user) => dataScope.resolve({ userId: user.id, module: "ASSET", feature: "Asset Management", columns: COLUMNS });

/** The TDS assets a scope lets through, by name, as the list would return them. */
async function listedCodes(scope) {
  const rows = await prisma.asset.findMany({ where: { isDeleted: false, assetCode: { startsWith: `TDS-${STAMP}` }, AND: [scope.where] }, select: { assetCode: true } });
  return rows.map((row) => row.assetCode.replace(`TDS-${STAMP}-`, "")).sort();
}

before(async () => {
  F.permission = await prisma.permission.findFirst({ where: { module: "ASSET", feature: "Asset Management" }, select: { id: true } });
  assert.ok(F.permission, "the seed no longer has ASSET / Asset Management");
  F.branchAdmin = await prisma.permission.findFirst({ where: { module: "ADMIN", feature: "Branch Administration" }, select: { id: true } });
  assert.ok(F.branchAdmin, "the seed no longer has ADMIN / Branch Administration - reseed");
  F.users = [];
  F.br1 = await prisma.branch.create({ data: { code: tag("BR1"), name: `Scope Branch 1 ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("BR2"), name: `Scope Branch 2 ${STAMP}` } });

  // A manager with two reports, one of whom has a report of their own, and a stranger outside it.
  F.manager = await employee("manager");
  F.reportA = await employee("reportA", F.manager.id);
  F.reportB = await employee("reportB", F.manager.id);
  F.grandchild = await employee("grandchild", F.reportA.id);
  F.stranger = await employee("stranger");

  F.me = await login("me", { branchId: F.br1.id, linkedEmployeeId: F.manager.id });
  F.superAdmin = await login("super", { branchId: null, role: "SUPER_ADMIN" });
  F.nobody = await login("nobody", { branchId: F.br1.id });

  // `createdBy` is one of the names: whoever registered an asset keeps sight of it. A stranger
  // registered these, so nothing here is this person's by creation.
  const make = (name, branchId, assignedPersonId, managerId = null) => prisma.asset.create({ data: { assetCode: tag(name), assetName: `Scope asset ${name}`, branchId, assignedPersonId, managerId, createdBy: F.superAdmin.id } });
  await make("br1-mine", F.br1.id, F.manager.id);
  await make("br1-report", F.br1.id, F.reportA.id);
  await make("br1-grandchild", F.br1.id, F.grandchild.id);
  // In the branch I reach, but held by somebody who is not mine: not my business.
  await make("br1-stranger", F.br1.id, F.stranger.id);
  // Nobody holds it. That is what the branch answers - it has to be visible to be assigned at all.
  await make("br1-unheld", F.br1.id, null);
  // The cases the branch list must not take away: my own work, and my team's, in a branch I do not reach.
  await make("br2-mine", F.br2.id, F.manager.id);
  await make("br2-report", F.br2.id, F.reportB.id);
  await make("br2-i-manage", F.br2.id, F.stranger.id, F.manager.id);
  await make("br2-stranger", F.br2.id, F.stranger.id);
  await make("br2-unheld", F.br2.id, null);
});

after(async () => {
  await prisma.asset.deleteMany({ where: { assetCode: { startsWith: `TDS-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: F.users } } });
  await prisma.user.deleteMany({ where: { id: { in: F.users } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TDS-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TDS-${STAMP}` } } });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ the subtree walk */

test("everyone below a manager, at any depth, in one query", async () => {
  const ids = (await dataScope.subtreeEmployeeIds(F.manager.id)).sort((a, b) => a - b);
  assert.deepEqual(ids, [F.reportA.id, F.reportB.id, F.grandchild.id].sort((a, b) => a - b));
  // A report's own team is only what is under them.
  assert.deepEqual(await dataScope.subtreeEmployeeIds(F.reportA.id), [F.grandchild.id]);
  // Nobody below the stranger, and nobody at all for an id that is not an employee.
  assert.deepEqual(await dataScope.subtreeEmployeeIds(F.stranger.id), []);
  assert.deepEqual(await dataScope.subtreeEmployeeIds(0), []);
  assert.deepEqual(await dataScope.subtreeEmployeeIds("nope"), []);
});

test("a loop in the reporting line ends where it began, and nobody is listed twice", async () => {
  // The form refuses to write this; a database edit or a bad import can still leave it.
  const x = await employee("cycle-x");
  const y = await employee("cycle-y", x.id);
  await prisma.employee.update({ where: { id: x.id }, data: { reportsToEmployeeId: y.id } });
  assert.deepEqual(await dataScope.subtreeEmployeeIds(x.id), [y.id]);
  assert.deepEqual(await dataScope.subtreeEmployeeIds(y.id), [x.id]);
});

test("a chain deeper than the cap is cut at the cap rather than followed", async () => {
  const cap = dataScope.SUBTREE_DEPTH_CAP;
  let above = await employee("deep-0");
  const root = above;
  for (let level = 1; level <= cap + 5; level += 1) above = await employee(`deep-${level}`, above.id);
  const ids = await dataScope.subtreeEmployeeIds(root.id);
  assert.equal(ids.length, cap, `expected the ${cap} levels the cap allows, got ${ids.length}`);
});

/* ------------------------------------------------------------------ the rule */

test("the name decides, and the branch on its own decides nothing", async () => {
  /*
   * The whole point of the rule, in one assertion. Reaching branch 1 only, this person gets their
   * own work and their team's wherever it is, including in branch 2 - and nothing else, not the
   * colleague's asset in their own branch and not the one nobody holds, because reaching a branch
   * is not a claim on what is in it.
   */
  await withGrant(F.me, [], async (scope) => {
    assert.deepEqual(await listedCodes(scope), ["br1-grandchild", "br1-mine", "br1-report", "br2-i-manage", "br2-mine", "br2-report"]);
    assert.equal(scope.allows({ branchId: F.br1.id, assignedPersonId: F.stranger.id, managerId: null, createdBy: null }), false, "a colleague's asset in my own branch is not mine");
    assert.equal(scope.allows({ branchId: F.br1.id, assignedPersonId: null, managerId: null, createdBy: null }), false, "nor is one nobody holds");
  });
});

test("whoever registered an asset keeps sight of it, held by somebody else or by nobody", async () => {
  const mine = await prisma.asset.create({ data: { assetCode: tag("br2-i-made"), assetName: "Scope asset br2-i-made", branchId: F.br2.id, assignedPersonId: null, createdBy: F.me.id } });
  try {
    await withGrant(F.me, [], async (scope) => {
      assert.equal(scope.allows(mine), true, "I entered it, so it is mine to see even before anybody is on it");
      assert.ok((await listedCodes(scope)).includes("br2-i-made"));
    });
  } finally { await prisma.asset.delete({ where: { id: mine.id } }); }
});

test("managing an asset counts as being named on it", async () => {
  // The reported fault: an asset assigned to somebody else but managed by this person did not
  // appear on their screen, because only the holder counted.
  const managed = await prisma.asset.findFirst({ where: { assetCode: tag("br2-i-manage") } });
  await withGrant(F.me, [], async (scope) => assert.equal(scope.allows(managed), true));
  assert.deepEqual(COLUMNS.employee, ["assignedPersonId", "managerId"]);
});

test("a manager sees their team's records, at any depth and in any branch", async () => {
  await withGrant(F.me, [], async (scope) => {
    assert.deepEqual([...scope.employeeIds].sort((a, b) => a - b), [F.manager.id, F.reportA.id, F.reportB.id, F.grandchild.id].sort((a, b) => a - b));
    assert.equal(scope.allows({ assignedPersonId: F.grandchild.id }), true, "two levels down is still my team");
    assert.equal(scope.allows({ assignedPersonId: F.stranger.id }), false);
  });
});

test("adding a branch to a role changes nothing on its own", async () => {
  // A branch list says where a person may file records and which branches a picker offers. It is
  // not a claim on the work in those branches, so widening it shows nobody anything new.
  const own = await withGrant(F.me, [], listedCodes);
  const both = await withGrant(F.me, [F.br2.id], listedCodes);
  assert.deepEqual(both, own);
});

test("administering a branch is what shows a person the whole of it", async () => {
  /*
   * `ADMIN / Branch Administration`, deliberately granted, **and the role says which branch**.
   *
   * Those are two different things and it takes both: administering is the switch - may you see work
   * your name is not on at all - and the role's branch list is where. The branch used to come free
   * from `user.branch_id` whatever the roles said, which is what made a branch restriction
   * unenforceable: a role saying "branch 2 only" still showed a branch-1 person the whole of branch
   * 1. Reach is per-permission now and comes from the roles alone, so a role that administers and
   * names no branch administers nowhere.
   *
   * Every asset in branch 1, colleagues' and unheld alike - and still nothing in branch 2 but the
   * work that names this person.
   */
  await withGrant(F.me, [F.br1.id], async (scope) => {
    assert.equal(scope.administersBranches, true);
    assert.deepEqual(await listedCodes(scope), ["br1-grandchild", "br1-mine", "br1-report", "br1-stranger", "br1-unheld", "br2-i-manage", "br2-mine", "br2-report"]);
  }, { administersBranches: true });
  // And with both branches on the role, the whole of both - which is every asset in the fixture.
  await withGrant(F.me, [F.br1.id, F.br2.id], async (scope) => {
    const seen = await listedCodes(scope);
    const all = (await prisma.asset.findMany({ where: { assetCode: { startsWith: `TDS-${STAMP}` } }, select: { assetCode: true } }))
      .map((row) => row.assetCode.replace(`TDS-${STAMP}-`, "")).sort();
    assert.deepEqual(seen, all);
  }, { administersBranches: true });
});

test("a Super Admin is narrowed by nothing, and callers can tell", async () => {
  const scope = await resolveFor(F.superAdmin);
  assert.equal(scope.unlimited, true);
  assert.deepEqual(scope.where, {});
  assert.equal(scope.allows({ branchId: 999, assignedPersonId: 999 }), true);
  /*
   * `unlimited` is the flag callers key their fast paths off - the bulk-action id check skips its
   * lookup on it, and the assistant decides on it whether to tell the model its figures are
   * narrowed. It was briefly a string compared against a value that no longer existed, which made
   * both of those answer wrongly for a Super Admin and nothing failed.
   */
  await withGrant(F.me, [], async (narrowed) => assert.equal(narrowed.unlimited, false));
  assert.equal((await resolveFor(F.nobody)).unlimited, false, "an unheld permission is not unlimited");
});

test("a login with no employee sees what it created, and otherwise nothing", async () => {
  await withGrant(F.nobody, [], async (scope) => {
    assert.deepEqual(scope.employeeIds, [], "it is named on nothing by employee id");
    assert.deepEqual(await listedCodes(scope), []);
  });
  const its = await prisma.asset.create({ data: { assetCode: tag("br1-nobody-made"), assetName: "Scope asset made by a login with no employee", branchId: F.br1.id, createdBy: F.nobody.id } });
  try {
    await withGrant(F.nobody, [], async (scope) => assert.deepEqual(await listedCodes(scope), ["br1-nobody-made"]));
  } finally { await prisma.asset.delete({ where: { id: its.id } }); }
});

test("the list and the record agree, for every asset", async () => {
  // The whole reason `allows` exists: an id typed into a URL must reach exactly what the list shows.
  const assets = await prisma.asset.findMany({ where: { assetCode: { startsWith: `TDS-${STAMP}` } } });
  for (const reach of [[], [F.br2.id]]) {
    await withGrant(F.me, reach, async (scope) => {
      const listed = new Set(await listedCodes(scope));
      for (const asset of assets) {
        const code = asset.assetCode.replace(`TDS-${STAMP}-`, "");
        assert.equal(scope.allows(asset), listed.has(code), `${code} is ${listed.has(code) ? "listed but refused" : "refused but listed"}`);
      }
    });
  }
});

test("a permission that is not held, or a module that declares nothing, answers no rows", async () => {
  // No grant attached: this login holds nothing on Asset Management.
  const unheld = await resolveFor(F.me);
  assert.ok(unheld.closed, "an unheld permission must answer closed");
  assert.deepEqual(await listedCodes(unheld), []);
  assert.equal(unheld.allows({ branchId: F.br1.id, assignedPersonId: F.manager.id }), false);

  await withGrant(F.me, [], async () => {
    const nothing = await dataScope.resolve({ userId: F.me.id, module: "ASSET", feature: "Asset Management", columns: {} });
    assert.ok(nothing.closed, "a module declaring no column must fail closed");
    assert.deepEqual(await listedCodes(nothing), []);
  });
});

test("a screen opened by several permissions answers to whichever of them is held", async () => {
  await withGrant(F.me, [], async () => {
    const either = await dataScope.resolve({ userId: F.me.id, permissions: [{ module: "ASSET", feature: "Vendor Management" }, { module: "ASSET", feature: "Asset Management" }], columns: COLUMNS });
    assert.ok(!either.closed, "holding one of the two is enough");
    const neither = await dataScope.resolve({ userId: F.me.id, permissions: [{ module: "ASSET", feature: "Vendor Management" }], columns: COLUMNS });
    assert.ok(neither.closed);
  });
});

test("the same rule answers as a SQL fragment, with the same ids the Prisma where carries", async () => {
  await withGrant(F.me, [], async (scope) => {
    // The name columns only: without branch administration the branch contributes no clause at all.
    const { clause, params } = scope.sql({ branch: "`a`.`branch_id`", employee: ["`a`.`assigned_person_id`", "`a`.`manager_id`"] });
    assert.match(clause, /^\(`a`\.`assigned_person_id` IN \((\?, )*\?\) OR `a`\.`manager_id` IN \((\?, )*\?\)\)$/);
    assert.deepEqual(params, [...scope.employeeIds, ...scope.employeeIds]);
    // A query that names none of the columns cannot honour the rule, so it answers nothing.
    assert.deepEqual(scope.sql({}), { clause: "1=0", params: [] });
  });
  // The branch the **role** names, since that is where reach comes from now - `user.branch_id` no
  // longer contributes, so a branch administrator whose role named none would add no clause at all.
  await withGrant(F.me, [F.br1.id], async (scope) => {
    const { clause, params } = scope.sql({ branch: "`a`.`branch_id`", employee: "`a`.`assigned_person_id`" });
    assert.match(clause, /OR `a`\.`branch_id` IN \(\?\)\)$/, "a branch administrator's branches reach the query too");
    assert.deepEqual(params.slice(-1), [F.br1.id]);
  }, { administersBranches: true });
  assert.deepEqual((await resolveFor(F.superAdmin)).sql({ branch: "x" }), { clause: "1=1", params: [] });
});

/* ------------------------------------------------------------------ the read path the assistant uses */

test("the assistant's asset reads are narrowed by the same rule", async () => {
  await withGrant(F.me, [], async (scope) => {
    const found = await assetRead.searchAssets({ search: `TDS-${STAMP}`, limit: 50, scope });
    assert.deepEqual(found.items.map((item) => item.assetCode.replace(`TDS-${STAMP}-`, "")).sort(), ["br1-grandchild", "br1-mine", "br1-report", "br2-i-manage", "br2-mine", "br2-report"]);
    const own = await assetRead.getAssetSummary({ scope });
    const all = await assetRead.getAssetSummary({ scope: await resolveFor(F.superAdmin) });
    assert.ok(all.total > own.total, "the summary hides what the list hides");
  });
});

/* ------------------------------------------------------------------ the controllers, held to it */

test("every asset endpoint reads through the rule, and none through an unscoped fetch", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const controller = read("modules", "assets", "assets.controller.js");
  assert.doesNotMatch(controller, /activeAsset\(/, "an unscoped fetch-by-id survives in the assets controller");
  assert.doesNotMatch(controller, /prisma\.asset\.findUnique\(\{ where: \{ id: assetId \} \}\)/, "changeStatus reads the asset without the rule");
  assert.match(controller, /AND: \[scope\.where\]/, "the list must carry the rule where nothing in the query can replace it");
  assert.equal((controller.match(/await scopedAsset\(req, assetId\)/g) || []).length, 4, "custody, update, delete and status each go through scopedAsset");
  const inspections = read("modules", "assets", "inspections.controller.js");
  assert.equal((inspections.match(/findScopedAsset\(req, assetId/g) || []).length, 2, "both inspection endpoints read the asset through the rule");
  const tools = read("services", "ai", "tools", "assets.js");
  assert.doesNotMatch(tools, /branchIds/, "the assistant's asset tools must not narrow by reachable branches on their own");
  assert.equal((tools.match(/scope: await scopeFor\(session\)/g) || []).length, 2);
});
