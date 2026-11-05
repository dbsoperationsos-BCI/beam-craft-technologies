const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const dataScope = require("../src/services/dataScope.service");
const { EMPLOYEE_SCOPE_COLUMNS } = require("../src/modules/hrm/employees/controller");
const { retrying } = require("./helpers/retrying");

/*
 * The Employee Repository on the resolver.
 *
 * This screen is the one deliberate exception to "reaching a branch is not a claim on the records in
 * it" - `branchOnReach` on `EMPLOYEE_SCOPE_COLUMNS`. Everywhere else that rule holds, because a
 * colleague's leads are not yours because you both file against Erode. A register of *who works
 * here* is not that kind of record: it is the studio's own shape, which is why the employee
 * directory needs no permission at all. So:
 *
 *   * **anybody holding the permission** gets the people in the branches their roles reach, plus
 *     themselves and everybody reporting to them, at any depth - no `ADMIN / Branch Administration`
 *     needed, and ticking every branch shows everybody who has one;
 *   * a **branch administrator** gets the same here; the permission still decides every *other*
 *     module, and is neither required nor narrowing on this one;
 *   * a **Super Admin** is narrowed by nothing.
 *
 * The fixture is that rule in miniature, against real rows. Its sharp edge is `posted`: somebody
 * based in one branch and working in another. `referenceColumnsFor` derives `branchId` as Work Base
 * Location *or else* Current Work Location, so that row's reference names the base branch alone -
 * a branch limb reading the reference would hide them from the branch they actually work in, which
 * is the whole reason the scope names all three columns.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TDE-${STAMP}-${name}`;
const F = {};

/** Runs `body` with a role granting Employee Management (and optionally Branch Administration). */
async function withGrant(user, { branchIds = [], administersBranches = false } = {}, body) {
  const role = await retrying(() => prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 6)}`) } }));
  const grants = [{ roleId: role.id, permissionId: F.employeePermission.id, accessLevel: "READ" }];
  if (administersBranches) grants.push({ roleId: role.id, permissionId: F.branchAdminPermission.id, accessLevel: "READ" });
  await retrying(() => prisma.rolePermission.createMany({ data: grants }));
  await retrying(() => prisma.userRole.create({ data: { userId: user.id, roleId: role.id } }));
  if (branchIds.length) await retrying(() => prisma.roleBranch.createMany({ data: branchIds.map((id) => ({ roleId: role.id, branchId: id })) }));
  try {
    return await body(await dataScope.resolve({ userId: user.id, module: "HRM", feature: "Employee Management", columns: EMPLOYEE_SCOPE_COLUMNS }));
  } finally {
    await prisma.userRole.deleteMany({ where: { roleId: role.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.role.delete({ where: { id: role.id } });
  }
}

/** The fixture's employees the scope returns, by their short name. */
async function seen(scope) {
  const rows = await prisma.employee.findMany({
    where: { AND: [scope.where], employeeId: { startsWith: `TDE-${STAMP}` } },
    select: { employeeId: true },
  });
  return rows.map((row) => row.employeeId.replace(`TDE-${STAMP}-`, "")).sort();
}

before(async () => {
  F.employeePermission = await prisma.permission.findFirst({ where: { module: "HRM", feature: "Employee Management" }, select: { id: true } });
  F.branchAdminPermission = await prisma.permission.findFirst({ where: { module: "ADMIN", feature: "Branch Administration" }, select: { id: true } });
  assert.ok(F.employeePermission, "the seed no longer has HRM / Employee Management");
  assert.ok(F.branchAdminPermission, "the seed no longer has ADMIN / Branch Administration");

  F.br = await retrying(() => prisma.branch.create({ data: { code: tag("BR"), name: `Emp Scope Branch ${STAMP}` } }));
  F.other = await retrying(() => prisma.branch.create({ data: { code: tag("OTHER"), name: `Emp Scope Other ${STAMP}` } }));
  const make = (name, data) => retrying(() => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Emp Scope ${name} ${STAMP}`, ...data } }));

  // The reader, based in the other branch: their own row must reach them wherever they sit.
  F.me = await make("me", { branchId: F.other.id, workBaseLocation: F.other.name });
  // Reporting to them, in a branch they do not reach - a report is theirs by name, not by branch.
  F.report = await make("report", { branchId: F.other.id, workBaseLocation: F.other.name, reportsToEmployeeId: null });
  F.deepReport = await make("deep-report", { branchId: F.other.id, workBaseLocation: F.other.name });
  // In the administered branch by each of the three columns.
  F.byId = await make("by-id", { branchId: F.br.id });
  F.byBase = await make("by-base", { workBaseLocation: F.br.name });
  F.byCurrent = await make("by-current", { currentWorkLocation: F.br.name });
  // Based elsewhere, posted here: `branchId` names the base, and only the text names this branch.
  F.posted = await make("posted", { branchId: F.other.id, workBaseLocation: F.other.name, currentWorkLocation: F.br.name });
  // Neither name nor branch: nobody's but a Super Admin's.
  F.stranger = await make("stranger", { branchId: F.other.id, workBaseLocation: F.other.name });

  await prisma.employee.update({ where: { id: F.report.id }, data: { reportsToEmployeeId: F.me.id } });
  await prisma.employee.update({ where: { id: F.deepReport.id }, data: { reportsToEmployeeId: F.report.id } });

  F.user = await retrying(() => prisma.user.create({ data: { name: "Emp scope me", email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "EMPLOYEE", branchId: null, linkedEmployeeId: F.me.id } }));
  F.superAdmin = await retrying(() => prisma.user.create({ data: { name: "Emp scope super", email: `${tag("sa")}@test.local`.toLowerCase(), username: tag("sa").toLowerCase(), password: "x", role: "SUPER_ADMIN" } }));
});

after(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: `tde-${STAMP}` } } });
  await prisma.employee.updateMany({ where: { employeeId: { startsWith: `TDE-${STAMP}` } }, data: { reportsToEmployeeId: null } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TDE-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TDE-${STAMP}` } } });
  await prisma.$disconnect();
});

test("the branches on the role open this register on their own, with no Branch Administration", async () => {
  await withGrant(F.user, { branchIds: [F.br.id] }, async (scope) => {
    assert.equal(scope.administersBranches, false, "held by nobody here, and not needed");
    // Everyone in the branch by any of the three columns, plus the people this reader is named on.
    assert.deepEqual(await seen(scope), ["by-base", "by-current", "by-id", "deep-report", "me", "posted", "report"]);
  });
});

test("a role reaching no branch still gets the reader and their own reports", async () => {
  // The floor the branch limb sits on: without a branch there is nothing for it to open, and the
  // honest answer is the work this person is named on rather than everybody.
  await withGrant(F.user, { branchIds: [] }, async (scope) => {
    assert.deepEqual(await seen(scope), ["deep-report", "me", "report"]);
  });
});

test("a branch administrator sees the same here - the permission neither adds nor narrows", async () => {
  await withGrant(F.user, { branchIds: [F.br.id], administersBranches: true }, async (scope) => {
    assert.equal(scope.administersBranches, true);
    assert.deepEqual(await seen(scope), ["by-base", "by-current", "by-id", "deep-report", "me", "posted", "report"]);
  });
});

test("somebody posted into the branch is reached though their derived branchId names their base", async () => {
  await withGrant(F.user, { branchIds: [F.br.id], administersBranches: true }, async (scope) => {
    const rows = await seen(scope);
    assert.ok(rows.includes("posted"), "the current work location is read beside the reference");
    // The same row, from the other side: a branch administrator of the base branch reaches them too.
    assert.equal(scope.allows({ id: F.posted.id, branchId: F.other.id, workBaseLocation: F.other.name, currentWorkLocation: F.br.name }), true);
  });
});

test("allows() reads the same three columns as the list, so a write is held to the same rows", async () => {
  await withGrant(F.user, { branchIds: [F.br.id], administersBranches: true }, async (scope) => {
    const row = (employee, extra = {}) => ({ id: employee.id, branchId: null, workBaseLocation: null, currentWorkLocation: null, ...extra });
    assert.equal(scope.allows(row(F.byId, { branchId: F.br.id })), true, "the reference");
    assert.equal(scope.allows(row(F.byBase, { workBaseLocation: F.br.name })), true, "the base location");
    assert.equal(scope.allows(row(F.byCurrent, { currentWorkLocation: F.br.name })), true, "the current location");
    assert.equal(scope.allows(row(F.report, { branchId: F.other.id })), true, "a report, by name rather than branch");
    assert.equal(scope.allows(row(F.stranger, { branchId: F.other.id, workBaseLocation: F.other.name })), false);
    // A location that is not a branch name is not a branch: the match is exact, as the query is.
    assert.equal(scope.allows(row(F.stranger, { workBaseLocation: `${F.br.name} Annexe` })), false);
  });
});

test("a branch administrator reaching no branch is left with their own name", async () => {
  await withGrant(F.user, { branchIds: [], administersBranches: true }, async (scope) => {
    assert.deepEqual(await seen(scope), ["deep-report", "me", "report"]);
  });
});

test("a Super Admin is narrowed by nothing", async () => {
  const scope = await dataScope.resolve({ userId: F.superAdmin.id, module: "HRM", feature: "Employee Management", columns: EMPLOYEE_SCOPE_COLUMNS });
  assert.equal(scope.unlimited, true);
  assert.deepEqual(await seen(scope), ["by-base", "by-current", "by-id", "deep-report", "me", "posted", "report", "stranger"]);
});

test("a reader who does not hold the permission at all gets nobody", async () => {
  const scope = await dataScope.resolve({ userId: F.user.id, module: "HRM", feature: "Employee Management", columns: EMPLOYEE_SCOPE_COLUMNS });
  assert.deepEqual(await seen(scope), []);
});

test("the branch limb is the only thing a text column widens - a module declaring none is unchanged", async () => {
  // The same fixture through the columns the screen used before this change: no text, so somebody
  // posted into the branch is missed. Held so the addition is visibly the thing that fixes it.
  await withGrant(F.user, { branchIds: [F.br.id], administersBranches: true }, async () => {
    const idOnly = await dataScope.resolve({ userId: F.user.id, module: "HRM", feature: "Employee Management", columns: { employee: "id", branch: "branchId" } });
    assert.equal((await seen(idOnly)).includes("posted"), false);
  });
});
