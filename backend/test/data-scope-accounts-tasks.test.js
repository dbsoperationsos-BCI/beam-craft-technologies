const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const dataScope = require("../src/services/dataScope.service");
const { invalidate } = require("../src/services/referenceMatchers");
const cashRead = require("../src/modules/accounts/cash-entries/read.service");
const tasks = require("../src/modules/hrm/tasks/service");

/*
 * Cash entries, payment requests and tasks on the studio's one rule - your name, your team's, your
 * branches, ORed - and the module rules that sit on top of it: a payment request is the requester's
 * own until somebody who may decide it looks, and a task is always readable by the two people it is
 * between whatever else is true.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TDA-${STAMP}-${name}`;
const F = {};

async function grant(user, module, feature, { level = "READ", reachBranchIds = [] } = {}) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: level } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

before(async () => {
  F.br1 = await prisma.branch.create({ data: { code: tag("BR1"), name: `Accounts Scope Branch ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("BR2"), name: `Accounts Scope Other ${STAMP}` } });
  /*
   * The work base is set alongside the branch on purpose. `data-scope-backfill.test.js` replays
   * every employee in the database through the matcher and asserts the reference agrees with the
   * text it is derived from, so a fixture carrying a branch with no work location fails a test in
   * another file - which is the invariant doing its job.
   */
  const person = (name, branch, extra = {}) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Accounts Scope ${name} ${STAMP}`, branchId: branch.id, workBaseLocation: branch.name, ...extra } });
  F.manager = await person("mgr", F.br1);
  F.report = await person("rep", F.br2, { reportsToEmployeeId: F.manager.id });
  F.stranger = await person("str", F.br1);
  const login = (name, employee, branch) => prisma.user.create({ data: { name: `Accounts scope ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "ADMIN", branchId: branch.id, linkedEmployeeId: employee?.id ?? null } });
  F.me = await login("me", F.manager, F.br1);
  F.reportUser = await login("rep", F.report, F.br2);
  F.noEmployee = await login("none", null, F.br1);
  invalidate();
  const entry = (name, branch, handler) => prisma.cashEntry.create({ data: {
    entryId: tag(name), entryType: "Spent", clientName: "Client", category: "Other", amount: "10.00", entryDate: new Date(),
    branch: branch.name, branchId: branch.id, paymentMode: "Cash", handlerName: handler?.employeeName || "Other", handlerEmployeeId: handler?.id ?? null,
  } });
  await entry("cash-mine", F.br1, F.manager);
  await entry("cash-report", F.br2, F.report);
  await entry("cash-stranger", F.br1, F.stranger);
  const task = (name, branch, assignee) => prisma.hrmTask.create({ data: {
    taskCode: tag(name), title: `Task ${name}`, description: "d", taskType: "Client",
    branch: branch.name, branchId: branch.id, status: "PENDING",
    assignedToUserId: assignee.id, assignedToName: assignee.name, ownerEmployeeId: assignee.linkedEmployeeId ?? null,
    assignedByUserId: F.noEmployee.id, assignedByName: F.noEmployee.name,
  } });
  await task("task-mine", F.br1, F.me);
  await task("task-report", F.br2, F.reportUser);
  await task("task-nobody", F.br1, F.noEmployee);
});

after(async () => {
  await prisma.hrmTaskActivity.deleteMany({ where: { task: { taskCode: { startsWith: `TDA-${STAMP}` } } } }).catch(() => {});
  await prisma.hrmTask.deleteMany({ where: { taskCode: { startsWith: `TDA-${STAMP}` } } });
  await prisma.cashEntry.deleteMany({ where: { entryId: { startsWith: `TDA-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.me.id, F.reportUser.id, F.noEmployee.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.me.id, F.reportUser.id, F.noEmployee.id] } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TDA-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TDA-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

// The screen's own columns, imported rather than restated, so the two cannot drift apart.
const { CASH_SCOPE_COLUMNS } = require("../src/modules/accounts/cash-entries/controller");
const cashScope = (userId) => dataScope.resolve({ userId, module: "ACCOUNTS", feature: "Cash Management", columns: CASH_SCOPE_COLUMNS });
const entries = async (scope) => (await prisma.cashEntry.findMany({ where: { deletedAt: null, entryId: { startsWith: `TDA-${STAMP}` }, AND: [scope.where] }, select: { entryId: true } }))
  .map((row) => row.entryId.replace(`TDA-${STAMP}-`, "")).sort();

test("cash entries: my own, my team's wherever they are, and nobody else's", async () => {
  const undo = await grant(F.me, "ACCOUNTS", "Cash Management");
  try {
    const resolved = await cashScope(F.me.id);
    // Mine is in branch 1; my report's is in branch 2 and is mine because they report to me. The
    // stranger's is in branch 1, which I reach, and is still not mine - somebody else handled it.
    assert.deepEqual(await entries(resolved), ["cash-mine", "cash-report"]);
    // The record answers the same as the list, which is what read-one and edit are held to.
    for (const [code, expected] of [["cash-mine", true], ["cash-report", true], ["cash-stranger", false]]) {
      const row = await prisma.cashEntry.findFirst({ where: { entryId: tag(code) } });
      assert.equal(resolved.allows(row), expected, code);
    }
  } finally { await undo(); }
});

test("an entry nobody handled belongs to whoever recorded it, not to the branch", async () => {
  const make = (name, createdBy) => prisma.cashEntry.create({ data: {
    entryId: tag(name), entryType: "Spent", clientName: "Client", category: "Other", amount: "10.00", entryDate: new Date(),
    branch: F.br1.name, branchId: F.br1.id, paymentMode: "Cash", handlerName: "Other", handlerEmployeeId: null, createdBy,
  } });
  const theirs = await make("cash-theirs", F.reportUser.id + 100000);
  const ours = await make("cash-ours", F.me.id);
  const undo = await grant(F.me, "ACCOUNTS", "Cash Management");
  try {
    const resolved = await cashScope(F.me.id);
    assert.equal(resolved.allows(ours), true, "I recorded it, so it is mine to see");
    assert.equal(resolved.allows(theirs), false, "somebody else recorded it, and sharing a branch is not a claim on it");
  } finally {
    await undo();
    await prisma.cashEntry.deleteMany({ where: { id: { in: [theirs.id, ours.id] } } });
  }
});

test("an entry in a branch I do not reach, handled by nobody I manage, is not mine", async () => {
  const outsider = await prisma.employee.create({ data: { employeeId: tag("out"), employeeName: `Accounts Scope Outsider ${STAMP}` } });
  const entry = await prisma.cashEntry.create({ data: {
    entryId: tag("cash-outside"), entryType: "Spent", clientName: "Client", category: "Other", amount: "10.00", entryDate: new Date(),
    branch: F.br2.name, branchId: F.br2.id, paymentMode: "Cash", handlerName: outsider.employeeName, handlerEmployeeId: outsider.id,
  } });
  const undo = await grant(F.me, "ACCOUNTS", "Cash Management");
  try {
    const resolved = await cashScope(F.me.id);
    assert.equal(resolved.allows(entry), false);
    assert.ok(!(await entries(resolved)).includes("cash-outside"));
  } finally {
    await undo();
    await prisma.cashEntry.delete({ where: { id: entry.id } });
    await prisma.employee.delete({ where: { id: outsider.id } });
  }
});

test("the assistant's cash reads count through the same rule", async () => {
  const undo = await grant(F.me, "ACCOUNTS", "Cash Management");
  try {
    const scope = await cashScope(F.me.id);
    // The search sets its own OR; the rule sits under AND, so the two cannot collide.
    const found = await cashRead.searchEntries({ search: `TDA-${STAMP}`, limit: 50, scope });
    assert.equal(found.total, 2, "mine and my report's; the stranger's is not mine though we share a branch");
    const own = await cashRead.getCashSummary({ scope });
    const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
    const all = await cashRead.getCashSummary({ scope: await cashScope(superAdmin.id) });
    assert.ok(all.entries >= own.entries, "a Super Admin counts at least as many");
  } finally { await undo(); }
});

/*
 * Reassigning moves the task's owner as well as its holder.
 *
 * `ownerEmployeeId` is the employee behind whoever holds the task, and it is what the team and self
 * limbs above read. A reassignment that moved the assignee and left the owner behind would keep the
 * task in the previous holder's manager's list and drop it out of the new holder's — with nothing on
 * screen to suggest why, which is exactly the kind of scoping fault that is only ever noticed as
 * "why can I not see this".
 */
test("reassigning a task moves its owner to the new holder's employee", async () => {
  const before = await prisma.hrmTask.findFirst({ where: { taskCode: `TDA-${STAMP}-task-mine` } });
  assert.equal(before.ownerEmployeeId, F.manager.id, "starts owned by the holder's employee");

  await tasks.transition(before.id, "reassign", { id: F.me.id, name: F.me.name }, {
    reason: "Handing this to my report",
    assignToUserId: F.reportUser.id,
  });

  const after = await prisma.hrmTask.findUnique({ where: { id: before.id } });
  assert.equal(after.assignedToUserId, F.reportUser.id, "the holder moved");
  assert.equal(after.ownerEmployeeId, F.report.id, "and the owner moved with them");
  assert.equal(after.status, "REASSIGNED");
  // Both people are kept, which is what puts the task in front of everybody who has held it.
  const holders = await prisma.hrmTaskHolder.findMany({ where: { taskId: before.id }, orderBy: { heldAt: "asc" } });
  assert.deepEqual(holders.map((holder) => holder.userId).sort(), [F.me.id, F.reportUser.id].sort());

  // Put it back, so the tests around this one still read the fixture they were written against.
  await prisma.hrmTask.update({ where: { id: before.id }, data: { assignedToUserId: before.assignedToUserId, assignedToName: before.assignedToName, ownerEmployeeId: before.ownerEmployeeId, status: before.status, reassignedAt: null, reassignReason: null, reassignedFromUserId: null, reassignedFromName: null } });
  await prisma.hrmTaskHolder.deleteMany({ where: { taskId: before.id, userId: F.reportUser.id } });
});

test("a task you are on is yours whatever else is true, and All Tasks follows the rule", async () => {
  const codes = (rows) => rows.filter((row) => row.taskCode.startsWith(`TDA-${STAMP}`)).map((row) => row.taskCode.replace(`TDA-${STAMP}-`, "")).sort();
  // My Tasks is not narrowed at all: a task given to you is yours to see.
  assert.deepEqual(codes(await tasks.listTasks({ scope: "mine", userId: F.me.id })), ["task-mine"]);

  const undo = await grant(F.me, "HRM", "All Tasks");
  try {
    /*
     * All Tasks under the rule: my own, and my report's in another branch. Not the one given to a
     * login with no employee - a task always names the two people it is between, so it is somebody's
     * even when that somebody has no employee record, and sharing a branch with it is not enough.
     */
    assert.deepEqual(codes(await tasks.listTasks({ scope: "all", userId: F.me.id })), ["task-mine", "task-report"]);
    // A task's owner is the employee behind its assignee, which is what the team limb reads.
    const rows = await prisma.hrmTask.findMany({ where: { taskCode: { startsWith: `TDA-${STAMP}` } }, select: { taskCode: true, ownerEmployeeId: true, assignedTo: { select: { linkedEmployeeId: true } } } });
    for (const row of rows) assert.equal(row.ownerEmployeeId, row.assignedTo?.linkedEmployeeId ?? null, row.taskCode);
  } finally { await undo(); }

  // A task in a branch nobody reaches, given to somebody outside the team, is not readable.
  const outsiderLogin = await prisma.user.create({ data: { name: "Task outsider", email: `${tag("out")}@test.local`.toLowerCase(), username: tag("out").toLowerCase(), password: "x", role: "ADMIN" } });
  const far = await prisma.branch.create({ data: { code: tag("BR3"), name: `Accounts Scope Far ${STAMP}` } });
  const hidden = await prisma.hrmTask.create({ data: { taskCode: tag("task-far"), title: "Far", description: "d", taskType: "Client", branch: far.name, branchId: far.id, status: "PENDING", assignedToUserId: outsiderLogin.id, assignedToName: "Task outsider", assignedByUserId: outsiderLogin.id, assignedByName: "Task outsider" } });
  const undoAgain = await grant(F.me, "HRM", "All Tasks");
  try {
    assert.ok(!codes(await tasks.listTasks({ scope: "all", userId: F.me.id })).includes("task-far"));
    await assert.rejects(() => tasks.getTask(hidden.id, F.me.id, true), (error) => error.status === 404);
  } finally {
    await undoAgain();
    await prisma.hrmTask.delete({ where: { id: hidden.id } });
    await prisma.branch.delete({ where: { id: far.id } });
    await prisma.user.delete({ where: { id: outsiderLogin.id } });
  }
});

test("a payment request is the requester's own, and a decider is narrowed by the scope", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payment-requests", "controller.js"), "utf8");
  // A requester's own rule is untouched by the scope: their own is their own.
  assert.match(controller, /if \(!\(await canDecide\(user\)\)\) return \{ requestedById: employeeId \|\| -1 \};/);
  // A decider gets the rule, ANDed so it can only narrow what the ownership rule already allowed.
  assert.match(controller, /return \{ AND: \[\(await requestScope\(user\)\)\.where\] \};/);
  // And every record endpoint is held to the same visibility as the list, which none was before.
  assert.equal((controller.match(/deletedAt: null, \.\.\.\(await visibilityWhere\(req\.user\)\)/g) || []).length, 5, "list, get, approve, reject, update and withdraw");
  assert.equal((controller.match(/branchId: \(await referenceLookups\(\)\)\.branchId\(branch\)/g) || []).length, 2, "create and update store the branch reference");
});

test("every accounts and task read is held to the scope", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const cash = read("modules", "accounts", "cash-entries", "controller.js");
  assert.match(cash, /AND: \[scope\.where\]/, "the cash list must carry the scope");
  assert.equal((cash.match(/await scopedEntry\(req, id/g) || []).length, 3, "get, update and delete read the entry through the scope");
  assert.equal((cash.match(/await branchReference\(data\.branch\)/g) || []).length, 2, "create and update store the branch reference");
  for (const tool of ["accounts.js", "hrm.js", "project.js", "assets.js"]) {
    assert.doesNotMatch(read("services", "ai", "tools", tool), /session\?\.branchIds/, `${tool} still narrows by the session's raw reach`);
  }
  // The rule's `where` is an OR, so a read service that spread it beside a search's own OR would be
  // replacing the rule with the search. Every one of them puts it under AND.
  for (const service of [["modules", "assets", "assets.read.service.js"], ["modules", "accounts", "cash-entries", "read.service.js"], ["modules", "sales", "projects", "read.service.js"]]) {
    assert.match(read(...service), /return \{ AND: \[/, `${service.join("/")} spreads the rule instead of ANDing it`);
  }
  const groupNames = read("modules", "sales", "whatsapp-group-names", "controller.js");
  assert.match(groupNames, /branchId: location\.id/, "a saved group name stores the branch it was generated for");
});
