const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { findRepairs, repair } = require("../scripts/one-off/repairAttendanceTypedTimes");

/*
 * The one-off repair for attendance times HR typed while the server ran on UTC.
 *
 * A typed "18:00" was stored as 18:00 UTC - 23:30 in the studio. The repair moves exactly those rows
 * to the typed time on the studio's clock, and nothing else: a row saved right, or changed since, is
 * left alone, and a second run finds nothing. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TTR-${STAMP}-${name}`;
const F = {};
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

before(async () => {
  F.employee = await prisma.employee.create({ data: { employeeId: tag("emp"), employeeName: `Repair ${STAMP}` } });
  const session = (iso, data) => prisma.attendanceSession.create({ data: { employeeId: F.employee.id, workDate: day(iso), ...data } });
  const event = (sessionRow, type, locationNote) => prisma.attendanceEvent.create({ data: { sessionId: sessionRow.id, employeeId: F.employee.id, type, capturedAt: new Date(), locationNote } });

  // 1. HR typed check-in 09:30 and check-out 18:00 on a UTC server: stored as 09:30Z and 18:00Z.
  F.edited = await session("2026-09-01", { loginAt: new Date("2026-09-01T09:30:00.000Z"), logoutAt: new Date("2026-09-01T18:00:00.000Z") });
  await event(F.edited, "ADMIN_EDIT", "check-in 15:01 → 09:30; check-out none → 18:00 by HR — forgot");

  // 2. An approved correction to 18:30 on a UTC server, which also closed a running break there.
  F.request = await prisma.attendanceRequest.create({ data: { employeeId: F.employee.id, type: "CORRECTION", fromDate: day("2026-09-02"), toDate: day("2026-09-02"), reason: "forgot", toTime: "18:30", status: "APPROVED" } });
  F.corrected = await session("2026-09-02", { loginAt: new Date("2026-09-02T04:00:00.000Z"), logoutAt: new Date("2026-09-02T18:30:00.000Z") });
  await event(F.corrected, "CHECK_OUT_CORRECTED", `Correction #${F.request.id} approved by HR.`);
  F.break = await prisma.attendanceBreak.create({ data: { sessionId: F.corrected.id, employeeId: F.employee.id, startedAt: new Date("2026-09-02T08:00:00.000Z"), endedAt: new Date("2026-09-02T18:30:00.000Z") } });

  // 4. A short day whose checkout was corrected (15:00) before HR edited its check-in (12:00): both
  //    stored as UTC. The check-in has to be repaired first, or the repaired checkout (09:30Z) would
  //    look earlier than the still-wrong login (12:00Z).
  F.shortRequest = await prisma.attendanceRequest.create({ data: { employeeId: F.employee.id, type: "CORRECTION", fromDate: day("2026-09-04"), toDate: day("2026-09-04"), reason: "forgot", toTime: "15:00", status: "APPROVED" } });
  F.short = await session("2026-09-04", { loginAt: new Date("2026-09-04T12:00:00.000Z"), logoutAt: new Date("2026-09-04T15:00:00.000Z") });
  await event(F.short, "CHECK_OUT_CORRECTED", `Correction #${F.shortRequest.id} approved by HR.`);
  await event(F.short, "ADMIN_EDIT", "check-in 13:00 → 12:00 by HR — came in at noon");

  // 5. Only the check-in was edited; the REASON reads like a check-out change. It is not one.
  F.reason = await session("2026-09-05", { loginAt: new Date("2026-09-05T09:30:00.000Z"), logoutAt: new Date("2026-09-05T18:00:00.000Z") });
  await event(F.reason, "ADMIN_EDIT", "check-in 10:00 → 09:30 by HR — the check-out 17:00 → 18:00 is right");

  // 3. Saved right - 18:00 in the studio is 12:30Z - and so left alone.
  F.right = await session("2026-09-03", { loginAt: new Date("2026-09-03T04:00:00.000Z"), logoutAt: new Date("2026-09-03T12:30:00.000Z") });
  await event(F.right, "ADMIN_EDIT", "check-in 09:30 → 09:30; check-out none → 18:00 by HR — forgot");
});

after(async () => {
  // The sessions, their events and breaks, and the request all go with the employee.
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TTR-${STAMP}` } } });
  await prisma.$disconnect();
});

const ours = (repairs) => repairs.filter((entry) => entry.session.employeeId === F.employee.id);

test("the repair finds only the times a UTC server saved from what HR typed", async () => {
  const found = ours(await findRepairs()).map((entry) => [entry.session.id, entry.field, entry.typed, entry.to.toISOString()]).sort();
  assert.deepEqual(found, [
    [F.edited.id, "loginAt", "09:30", "2026-09-01T04:00:00.000Z"],
    [F.edited.id, "logoutAt", "18:00", "2026-09-01T12:30:00.000Z"],
    [F.corrected.id, "logoutAt", "18:30", "2026-09-02T13:00:00.000Z"],
    [F.short.id, "loginAt", "12:00", "2026-09-04T06:30:00.000Z"],
    [F.short.id, "logoutAt", "15:00", "2026-09-04T09:30:00.000Z"],
    // The reason's "check-out 17:00 → 18:00" is not read: only the check-in is.
    [F.reason.id, "loginAt", "09:30", "2026-09-05T04:00:00.000Z"],
  ].sort());
  // Within a day, the check-in comes first.
  const short = ours(await findRepairs()).filter((entry) => entry.session.id === F.short.id).map((entry) => entry.field);
  assert.deepEqual(short, ["loginAt", "logoutAt"]);
});

test("applying it moves those times to the studio's clock, closes the break there, notes it, and a second run finds nothing", async () => {
  for (const entry of ours(await findRepairs())) await repair(entry);

  const edited = await prisma.attendanceSession.findUnique({ where: { id: F.edited.id } });
  assert.equal(edited.loginAt.toISOString(), "2026-09-01T04:00:00.000Z", "09:30 in the studio");
  assert.equal(edited.logoutAt.toISOString(), "2026-09-01T12:30:00.000Z", "18:00 in the studio");
  const corrected = await prisma.attendanceSession.findUnique({ where: { id: F.corrected.id } });
  assert.equal(corrected.logoutAt.toISOString(), "2026-09-02T13:00:00.000Z", "18:30 in the studio");
  const closed = await prisma.attendanceBreak.findUnique({ where: { id: F.break.id } });
  assert.equal(closed.endedAt.toISOString(), "2026-09-02T13:00:00.000Z", "the break ends at the repaired checkout");
  // The row saved right is untouched.
  const short = await prisma.attendanceSession.findUnique({ where: { id: F.short.id } });
  assert.deepEqual([short.loginAt.toISOString(), short.logoutAt.toISOString()], ["2026-09-04T06:30:00.000Z", "2026-09-04T09:30:00.000Z"], "12:00 to 15:00 in the studio");
  const reason = await prisma.attendanceSession.findUnique({ where: { id: F.reason.id } });
  assert.equal(reason.logoutAt.toISOString(), "2026-09-05T18:00:00.000Z", "a time in the reason is never acted on");
  const right = await prisma.attendanceSession.findUnique({ where: { id: F.right.id } });
  assert.equal(right.logoutAt.toISOString(), "2026-09-03T12:30:00.000Z");

  // Each repair says what it did; the audit rows already there are not rewritten.
  const notes = (await prisma.attendanceEvent.findMany({ where: { employeeId: F.employee.id, locationNote: { startsWith: "Time-zone repair" } }, select: { locationNote: true } })).map((row) => row.locationNote);
  assert.equal(notes.length, 6);
  assert.ok(notes.some((text) => /check-out 23:30 → 18:00/.test(text)), notes.join(" | "));

  assert.deepEqual(ours(await findRepairs()), [], "nothing is left to repair, so running it again changes nothing");
});
