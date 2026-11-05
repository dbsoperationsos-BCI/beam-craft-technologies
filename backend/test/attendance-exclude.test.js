const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const service = require("../src/modules/hrm/attendance/service");
const controller = require("../src/modules/hrm/attendance/controller");
const employees = require("../src/modules/hrm/employees/controller");
const { calendarDay } = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * Employee Preference → Exclude → Exclude From Attendance: an employee ticked is kept out of the
 * Attendance module - not on the register or the dashboard, not counted, their requests not in
 * anybody's queue, their day and photo not opened by anybody else. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TXA-${STAMP}-${name}`;
const F = {};
const today = calendarDay(new Date());

/** Calls a handler and says what it answered: `{ code, body }`. */
async function answer(handler, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; }, send: () => { out = { code }; } }), json: (body) => { out = { code: 200, body }; } };
  await handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res);
  return out;
}

before(async () => {
  const person = (name, extra = {}) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Exclude ${name} ${STAMP}`, employmentStatus: "Active", ...extra } });
  F.kept = await person("kept");
  F.excluded = await person("excluded", { excludeFromAttendance: true });
  F.admin = await prisma.user.create({ data: { name: "Exclude admin", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.excludedLogin = await prisma.user.create({ data: { name: "Excluded login", email: `${tag("exl")}@test.local`.toLowerCase(), username: tag("exl").toLowerCase(), password: "x", role: "EMPLOYEE", linkedEmployeeId: F.excluded.id } });
  invalidate();
  // Both checked in today, so both would be on the register were it not for the tick.
  const session = (employee) => prisma.attendanceSession.create({ data: { employeeId: employee.id, workDate: today, loginAt: new Date(), lastLoginAt: new Date() } });
  F.keptSession = await session(F.kept);
  F.excludedSession = await session(F.excluded);
  const request = (employee) => prisma.attendanceRequest.create({ data: { employeeId: employee.id, type: "LEAVE", fromDate: today, toDate: today, reason: tag("why") } });
  F.keptRequest = await request(F.kept);
  F.excludedRequest = await request(F.excluded);
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `txa-${STAMP}` } } });
  // Their sessions and requests go with them.
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TXA-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("an excluded employee is off the register, its counts and the dashboard's lists", async () => {
  const off = await service.attendanceOptionalEmployeeIds([F.kept.id, F.excluded.id]);
  assert.ok(off.has(F.excluded.id));
  assert.ok(!off.has(F.kept.id));
  assert.equal(await service.isExcludedFromAttendance(F.excluded.id), true);
  assert.equal(await service.isExcludedFromAttendance(F.kept.id), false);

  const register = await service.attendanceRegister(today);
  const names = register.rows.map((row) => row.employeeName);
  assert.ok(names.includes(`Exclude kept ${STAMP}`), "the employee who is not excluded is listed");
  assert.ok(!names.includes(`Exclude excluded ${STAMP}`), "the excluded employee is not");
});

test("nobody's request queue shows an excluded employee's requests, and they cannot raise one", async () => {
  const where = await service.visibilityFilter({ id: F.admin.id, role: "SUPER_ADMIN" }, "team");
  const listed = await prisma.attendanceRequest.findMany({ where: { AND: [where, { reason: tag("why") }] }, select: { employeeId: true } });
  assert.deepEqual(listed.map((row) => row.employeeId), [F.kept.id]);

  const raised = await answer(controller.createRequest, { user: { id: F.excludedLogin.id, role: "EMPLOYEE", linkedEmployeeId: F.excluded.id }, body: { type: "LEAVE", fromDate: "2026-12-01", toDate: "2026-12-01", reason: "Holiday" } });
  assert.equal(raised.code, 403);
  assert.match(raised.body.message, /not tracked/);

  // Nor is one raised before the tick decided by its id - it is off the queue, so it is not on file.
  const approved = await answer(controller.approveRequest, { user: { id: F.admin.id, role: "SUPER_ADMIN" }, params: { id: String(F.excludedRequest.id) } });
  assert.equal(approved.code, 404);
  assert.equal((await prisma.attendanceRequest.findUnique({ where: { id: F.excludedRequest.id } })).status, "PENDING");
});

test("an excluded employee's day is not on file to anybody else, nor editable", async () => {
  const user = { id: F.admin.id, role: "SUPER_ADMIN" };
  const opened = await answer(controller.getRegisterDetail, { user, params: { sessionId: String(F.excludedSession.id) } });
  assert.equal(opened.code, 404);
  const edited = await answer(controller.editAttendance, { user, params: { sessionId: String(F.excludedSession.id) }, body: { checkInAt: "09:30", reason: "test" } });
  assert.ok([404, 400].includes(edited.code), JSON.stringify(edited));
  if (edited.code === 400) assert.doesNotMatch(JSON.stringify(edited.body), /updated/);
  // The employee who is not excluded still opens as before.
  const kept = await answer(controller.getRegisterDetail, { user, params: { sessionId: String(F.keptSession.id) } });
  assert.equal(kept.code, 200);
});

test("the dashboard's employee filter leaves them out; other pickers do not", async () => {
  const forAttendance = await answer(employees.employeeDirectory, { query: { for: "attendance" } });
  const everywhere = await answer(employees.employeeDirectory, { query: {} });
  const has = (out, employee) => out.body.data.some((row) => row.id === employee.id);
  assert.equal(has(forAttendance, F.excluded), false);
  assert.equal(has(forAttendance, F.kept), true);
  assert.equal(has(everywhere, F.excluded), true, "Assets and Client Storage still list them");
});
