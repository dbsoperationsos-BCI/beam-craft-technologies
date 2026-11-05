const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { deleteInviteRecord } = require("../src/modules/hrm/offboarding-invites/controller");

/*
 * HR Offboarding List: a form deleted from its ⋮, or the ticked rows together, through one delete -
 * the form goes, a separation it recorded stays.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TOD-${STAMP}-${name}`;
const F = {};
const form = (employeeId, extra = {}) => prisma.employeeOffboardingInvite.create({ data: {
  employeeId, noticePeriodDays: 30, tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86400000), status: "Approved", ...extra,
} });

test.before(async () => {
  F.employee = await prisma.employee.create({ data: { employeeId: tag("emp"), employeeName: `Leaver ${STAMP}`, employmentStatus: "Active" } });
  F.admin = await prisma.user.create({ data: { name: "Delete admin", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.separation = await prisma.employeeSeparation.create({ data: { employeeId: F.employee.id, separationType: "Resignation", separationReason: "Career Change", employmentStatus: "Relieved", proposedLastWorkingDate: new Date(Date.now() + 30 * 86400000) } });
});

test.after(async () => {
  // Their forms and separation go with them (`onDelete: Cascade`), as the fixture sweep relies on.
  await prisma.employee.deleteMany({ where: { id: F.employee.id } });
  await prisma.user.deleteMany({ where: { id: F.admin.id } });
  await prisma.$disconnect();
});

const req = () => ({ user: { id: F.admin.id, role: "SUPER_ADMIN" } });

test("a form is deleted at any status, and the separation it recorded stays", async () => {
  const approved = await form(F.employee.id, { separationId: F.separation.id });
  await deleteInviteRecord(req(), approved.id);
  assert.equal(await prisma.employeeOffboardingInvite.count({ where: { id: approved.id } }), 0);
  assert.equal(await prisma.employeeSeparation.count({ where: { id: F.separation.id } }), 1, "the employee's own record is untouched");
  const submitted = await form(F.employee.id, { status: "Submitted" });
  await deleteInviteRecord(req(), submitted.id);
  assert.equal(await prisma.employeeOffboardingInvite.count({ where: { id: submitted.id } }), 0);
});

test("an id that is no form is not found, and nothing is deleted", async () => {
  await assert.rejects(() => deleteInviteRecord(req(), "no-such-form"), (error) => error.status === 404);
});

test("one from its ⋮ and the ticked rows run the same delete, behind Employee Management and Select All", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "master-data", "routes.js"), "utf8");
  assert.match(routes, /mountBulkDelete\(router, \{ path: "\/offboarding-invites\/bulk", deleteOne: \(id, req\) => offboarding\.deleteInviteRecord\(req, id\), noun: "resignation form" \}\);\nrouter\.delete\("\/offboarding-invites\/:id", offboarding\.deleteInvite\);/);
});
