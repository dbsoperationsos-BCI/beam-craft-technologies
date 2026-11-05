const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { employeeVisibility, ONBOARDING_STATUSES } = require("../src/modules/hrm/employees/controller");

/*
 * A hire still being onboarded is visible to everybody who holds the Employee Repository.
 *
 * At **HR Onboarding Pending** or **Employee Submission Pending** there is no branch yet, usually no
 * work location and no reporting line - the form that answers those questions is the one still being
 * filled in. Under the branch rule alone such a row is nobody's: reachable by no branch, named on
 * nobody, and so invisible to every holder of the permission but a Super Admin. The onboarding it is
 * waiting for could not be done by the people whose job it is.
 *
 * They are a queue of work rather than somebody's record, and they stop being an exception the
 * moment the form is completed and the person has a branch like everybody else.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TES-${STAMP}-${name}`;
const F = {};
const req = (userId) => ({ user: { id: userId } });

before(async () => {
  F.branch = await prisma.branch.create({ data: { code: tag("BR"), name: `Onboard Branch ${STAMP}` } });
  const make = (name, data) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Onboard ${name}`, employmentStatus: "Active", ...data } });
  // A reader who reaches nothing and is named on nobody: the hardest case for the rule to hold in.
  F.me = await make("me", {});
  F.hrPending = await make("hr-pending", { employmentStatus: "HR Onboarding Pending" });
  F.submissionPending = await make("submission-pending", { employmentStatus: "Employee Submission Pending" });
  // The control: no branch either, but not onboarding, so no exception applies to them.
  F.strangerNoBranch = await make("stranger-no-branch", {});
  F.strangerInBranch = await make("stranger-in-branch", { branchId: F.branch.id });

  F.user = await prisma.user.create({ data: { name: `Onboard ${STAMP}`, email: `${tag("u")}@test.local`.toLowerCase(), username: tag("u").toLowerCase(), password: "x", role: "EMPLOYEE", linkedEmployeeId: F.me.id } });
  const permission = await prisma.permission.findFirst({ where: { module: "HRM", feature: "Employee Management" }, select: { id: true } });
  F.role = await prisma.role.create({ data: { name: tag("role"), permissions: { create: [{ permissionId: permission.id, accessLevel: "READ" }] } } });
  await prisma.userRole.create({ data: { userId: F.user.id, roleId: F.role.id } });
  F.superAdmin = await prisma.user.create({ data: { name: `Onboard super ${STAMP}`, email: `${tag("sa")}@test.local`.toLowerCase(), username: tag("sa").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
});

after(async () => {
  await prisma.userRole.deleteMany({ where: { userId: F.user?.id } });
  if (F.user) await prisma.user.delete({ where: { id: F.user.id } });
  if (F.role) await prisma.role.delete({ where: { id: F.role.id } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TES-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TES-${STAMP}` } } });
  await prisma.$disconnect();
});

/** The fixture's people this reader's repository lists, by their short name. */
async function listed() {
  const visible = await employeeVisibility(req(F.user.id));
  const rows = await prisma.employee.findMany({
    where: { archivedAt: null, employeeId: { startsWith: `TES-${STAMP}` }, AND: [visible.where] },
    select: { employeeId: true },
  });
  return rows.map((row) => row.employeeId.replace(`TES-${STAMP}-`, "")).sort();
}

test("both onboarding statuses are listed, to a reader who reaches no branch at all", async () => {
  assert.deepEqual(await listed(), ["hr-pending", "me", "submission-pending"]);
});

test("a stranger with no branch is not - it is the status that is the exception, not the missing branch", async () => {
  // Otherwise "no branch yet" would become a way of being visible to everybody, which is the
  // opposite of what the backfill gap needs.
  assert.equal((await listed()).includes("stranger-no-branch"), false);
  assert.equal((await listed()).includes("stranger-in-branch"), false, "and a branch this role does not reach stays out");
});

test("allows() agrees with the list, so an id typed into a URL opens the same people", async () => {
  const visible = await employeeVisibility(req(F.user.id));
  for (const status of ONBOARDING_STATUSES) {
    assert.equal(visible.allows({ id: F.hrPending.id, employmentStatus: status }), true, status);
  }
  assert.equal(visible.allows({ id: F.strangerNoBranch.id, employmentStatus: "Active" }), false);
});

test("a Super Admin is not narrowed by the widening", async () => {
  /*
   * The regression this exists for. An unlimited scope's `where` is `{}` - no condition at all -
   * and `{}` inside an `OR` is not "everything": Prisma contributes nothing for it, so
   * `OR: [{}, onboarding]` collapsed to the onboarding clause and a Super Admin, who is narrowed by
   * nothing, saw only the people being onboarded. Widening a scope must never be able to narrow it.
   */
  const visible = await employeeVisibility(req(F.superAdmin.id));
  assert.equal(visible.scope.unlimited, true);
  const everybody = await prisma.employee.count({ where: { archivedAt: null } });
  const seen = await prisma.employee.count({ where: { archivedAt: null, AND: [visible.where] } });
  assert.equal(seen, everybody, "a Super Admin counts every employee");
  assert.equal(visible.allows({ employmentStatus: "Active", branchId: null }), true);
});

test("finishing the onboarding takes the exception away", async () => {
  // The row stops being a queue item and becomes somebody's record, held to the branch rule like
  // everybody else's - here, out of reach, because this reader reaches no branch.
  await prisma.employee.update({ where: { id: F.hrPending.id }, data: { employmentStatus: "Active" } });
  assert.equal((await listed()).includes("hr-pending"), false);
  await prisma.employee.update({ where: { id: F.hrPending.id }, data: { employmentStatus: "HR Onboarding Pending" } });
  assert.equal((await listed()).includes("hr-pending"), true);
});
