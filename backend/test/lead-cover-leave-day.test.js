const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { loadCoverContext, buildCoverResolver, startOfToday } = require("../src/services/leadCover");
const { workingEmployeeStatuses } = require("../src/services/employeeOptionLists");
const { studioDateKey } = require("../src/services/studioTime");

/*
 * A leave is seen on every day it covers - its first day and a one-day leave included - on the
 * studio's calendar, whatever zone the server runs in.
 *
 * "Today" was the server's local midnight. On a machine set to India that reached MySQL as 18:30 UTC
 * the day before, so "the leave starts on or before today" was false on the first day of every leave
 * and a one-day leave was never seen: the absent person went on receiving the sheet's leads.
 */

const STAMP = `TLC-${Date.now().toString(36)}`;

test("today is the studio's calendar day, held the way a @db.Date holds one", () => {
  const today = startOfToday();
  assert.equal(today.toISOString(), `${studioDateKey()}T00:00:00.000Z`);
});

test("a one-day leave approved for today sends the rule's leads to the alternative", async (t) => {
  const [status] = await workingEmployeeStatuses();
  const make = (name, extra = {}) => prisma.employee.create({
    data: { employeeId: `${STAMP}-${name}`, employeeName: `${STAMP} ${name}`, employmentStatus: status, ...extra },
    select: { id: true },
  });
  const cover = await make("cover");
  const away = await make("away", { alternative1EmployeeId: cover.id });
  t.after(async () => {
    await prisma.attendanceRequest.deleteMany({ where: { employeeId: { in: [away.id, cover.id] } } });
    await prisma.employee.deleteMany({ where: { employeeId: { startsWith: STAMP } } });
  });
  const today = startOfToday();
  await prisma.attendanceRequest.create({
    data: { employeeId: away.id, type: "LEAVE", status: "APPROVED", fromDate: today, toDate: today, reason: `${STAMP} one day` },
  });

  const resolve = buildCoverResolver(await loadCoverContext());
  const answer = resolve(away.id);
  assert.equal(answer?.employeeId, cover.id, "the leave starting today was not seen");
  assert.equal(answer.covering, true);
  assert.equal(answer.reason, "on leave today");
  // The alternative, who is in, takes their own leads as usual.
  assert.deepEqual(resolve(cover.id), { employeeId: cover.id, name: `${STAMP} cover`, covering: false });
});
