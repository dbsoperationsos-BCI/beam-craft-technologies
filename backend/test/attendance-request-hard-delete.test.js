const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { isSuperAdmin } = require("../src/services/administrator");
const { hardDeleteRequestRecord } = require("../src/modules/hrm/attendance/controller");
const { ENTITY_TYPE } = require("../src/modules/hrm/attendance/requestNotifications");

/*
 * A Super Admin's bulk delete takes attendance requests out of the database: the request, its
 * approvals, its history and every notification pointing at it. Super Admins alone - either kind -
 * and only over a selection; the row's own Delete still marks one's own request Deleted and keeps it.
 */

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "routes.js"), "utf8");
// Reserved fixture prefix, swept by scripts/clear-test-fixtures.js if a run dies before `t.after`.
const STAMP = `TRH-${Date.now().toString(36)}`;

test("the bulk delete is a Super Admin's alone, above the single-request route that stays as it was", () => {
  assert.match(ROUTES, /mountBulkDelete\(router, \{ path: "\/requests\/bulk", guard: \[writeRequests, superAdminOnly\], deleteOne: controller\.hardDeleteRequestRecord, noun: "request" \}\);/);
  assert.ok(ROUTES.indexOf('path: "/requests/bulk"') < ROUTES.indexOf('router.delete("/requests/:id", readRequests, controller.deleteRequest);'), "bulk is mounted before /requests/:id");
  assert.match(ROUTES, /if \(await isSuperAdmin\(req\.user\?\.id\)\) return next\(\);/);
});

test("a request deleted outright takes its approvals, history and notifications with it", async (t) => {
  const employee = await prisma.employee.create({ data: { employeeId: `${STAMP}-E`, employeeName: `${STAMP} Employee`, archivedAt: new Date() } });
  t.after(() => prisma.employee.delete({ where: { id: employee.id } }).catch(() => {}));
  const day = new Date("2026-01-05");
  const request = await prisma.attendanceRequest.create({ data: { employeeId: employee.id, type: "LEAVE", fromDate: day, toDate: day, reason: `${STAMP} reason`, status: "APPROVED" } });
  await prisma.attendanceRequestApproval.create({ data: { requestId: request.id, approverEmployeeId: employee.id, decision: "APPROVED" } });
  const reader = await prisma.user.create({ data: { name: `${STAMP} Reader`, email: `${STAMP}-reader@test.local`.toLowerCase(), username: `${STAMP}-reader`.toLowerCase(), password: "x", role: "USER" } });
  t.after(() => prisma.user.delete({ where: { id: reader.id } }));
  await prisma.notification.create({ data: { userId: reader.id, type: "TEST", title: STAMP, entityType: ENTITY_TYPE, entityId: String(request.id) } });
  assert.equal(await prisma.notification.count({ where: { entityType: ENTITY_TYPE, entityId: String(request.id) } }), 1, "the notification is there to be removed");

  await prisma.attendanceRequestEvent.create({ data: { requestId: request.id, action: "CREATED", actorName: STAMP } });
  assert.equal(await prisma.attendanceRequestEvent.count({ where: { requestId: request.id } }), 1, "the history is there to be removed");
  await hardDeleteRequestRecord(String(request.id), { user: { id: reader.id } });

  assert.equal(await prisma.attendanceRequest.count({ where: { id: request.id } }), 0);
  assert.equal(await prisma.attendanceRequestApproval.count({ where: { requestId: request.id } }), 0);
  assert.equal(await prisma.attendanceRequestEvent.count({ where: { requestId: request.id } }), 0);
  assert.equal(await prisma.notification.count({ where: { entityType: ENTITY_TYPE, entityId: String(request.id) } }), 0);
});

test("a request that is not there is refused, not silently counted as deleted", async () => {
  await assert.rejects(() => hardDeleteRequestRecord("999999999"), (error) => error.status === 404);
  // Anything but whole digits is refused outright - never read as the number it starts with.
  for (const loose of ["bulk", "12abc", "1e3", "5.9", "-3", "0", "", " "]) {
    await assert.rejects(() => hardDeleteRequestRecord(loose), (error) => error.status === 404, JSON.stringify(loose));
  }
});

test("Super Admin means the SUPER_ADMIN column or an active SUPER_ADMIN role, and nothing wider", async (t) => {
  const make = async (name, role) => {
    const row = await prisma.user.create({ data: { name: `${STAMP} ${name}`, email: `${STAMP}-${name}@test.local`.toLowerCase(), username: `${STAMP}-${name}`.toLowerCase(), password: "x", role } });
    t.after(async () => { await prisma.userRole.deleteMany({ where: { userId: row.id } }); await prisma.user.delete({ where: { id: row.id } }); });
    return row;
  };
  assert.equal(await isSuperAdmin((await make("column", "SUPER_ADMIN")).id), true);
  const plain = await make("plain", "USER");
  assert.equal(await isSuperAdmin(plain.id), false);
  const superRole = await prisma.role.findFirst({ where: { name: "SUPER_ADMIN", isActive: true }, select: { id: true } });
  if (superRole) {
    await prisma.userRole.create({ data: { userId: plain.id, roleId: superRole.id } });
    assert.equal(await isSuperAdmin(plain.id), true);
  }
});
