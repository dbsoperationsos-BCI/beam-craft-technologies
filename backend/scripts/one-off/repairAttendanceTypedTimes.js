/**
 * One-off: repair attendance times an administrator TYPED while the server ran on UTC.
 *
 *   node scripts/one-off/repairAttendanceTypedTimes.js            # preview - lists, changes nothing
 *   node scripts/one-off/repairAttendanceTypedTimes.js --apply    # repairs what the preview listed
 *
 * ── Why ───────────────────────────────────────────────────────────────────────────────────────
 *
 * A typed clock time ("18:00") was turned into a stored instant on the SERVER's clock
 * (`wallClockInstant`). On a server left on UTC, "18:00" was stored as 18:00 UTC - 23:30 in the
 * studio. Captured logins and logouts were never affected: they are real instants. Two paths typed
 * a time, and both left an audit row naming what was typed:
 *
 *   - HR editing a day's check-in / check-out: an `ADMIN_EDIT` event whose note reads
 *     "check-in 09:31 → 09:30; check-out none → 18:00 by <name> — <reason>".
 *   - An approved checkout Correction: a `CHECK_OUT_CORRECTED` event "Correction #<id> approved
 *     by <name>.", the time typed being that request's `toTime`.
 *
 * ── Which rows ─────────────────────────────────────────────────────────────────────────────────
 *
 * A stored time is repaired only when it is EXACTLY the typed time read as UTC on that day - the
 * fingerprint of the bug, to the millisecond. So:
 *   - a row saved correctly (a server already on India time, or after the code fix) reads the typed
 *     time on the studio's clock instead, and is left alone;
 *   - a row changed again since (a later edit, a real logout) no longer matches, and is left alone;
 *   - running it twice repairs nothing the second time.
 * It moves the time to the typed time on the studio's clock (`wallClockInstant`, now India's), and a
 * break the bad checkout closed is closed at the repaired one. Each repair adds an `ADMIN_EDIT`
 * event saying what was changed and why; the audit rows already there are never rewritten.
 *
 * Not repaired, and reported to be looked at by hand: nothing else - a login captured between
 * midnight and 5:30 am IST was filed under the previous day by a UTC server, but there is no typed
 * value to prove what was meant, so it is not guessed at.
 */
require("dotenv").config();
const prisma = require("../../src/config/db");
const { calendarDay, formatClockTime, localIsoDate, minutesOfDay, parseClockTime, wallClockInstant } = require("../../src/modules/hrm/attendance/attendanceRules");

const APPLY = process.argv.includes("--apply");

/** The instant a typed time was stored as by a UTC server: that clock time, in UTC, on the day. */
function typedAsUtc(day, minutes) {
  const date = calendarDay(day);
  if (!date || minutes === null) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, minutes));
}

const sameInstant = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();

/** Every repair the audit trail proves is needed: `{ session, field, typed, from, to, source }`. */
async function findRepairs() {
  const events = await prisma.attendanceEvent.findMany({
    where: { type: { in: ["ADMIN_EDIT", "CHECK_OUT_CORRECTED"] } },
    select: { id: true, type: true, locationNote: true, sessionId: true },
    orderBy: { id: "asc" },
  });
  const requestIds = events
    .filter((event) => event.type === "CHECK_OUT_CORRECTED")
    .map((event) => Number(/Correction #(\d+)/.exec(event.locationNote || "")?.[1]))
    .filter(Boolean);
  const requests = new Map((await prisma.attendanceRequest.findMany({
    where: { id: { in: [...new Set(requestIds)] } },
    select: { id: true, toTime: true },
  })).map((request) => [request.id, request]));
  const sessions = new Map((await prisma.attendanceSession.findMany({
    where: { id: { in: [...new Set(events.map((event) => event.sessionId))] } },
    select: { id: true, employeeId: true, workDate: true, loginAt: true, logoutAt: true, employee: { select: { employeeId: true, employeeName: true } } },
  })).map((session) => [session.id, session]));

  // What each event says was typed, per session and field - the latest edit wins, as it did.
  const typed = new Map();
  const note = (session, field, value, source) => typed.set(`${session.id}:${field}`, { session, field, value, source });
  for (const event of events) {
    const session = sessions.get(event.sessionId);
    if (!session) continue;
    if (event.type === "CHECK_OUT_CORRECTED") {
      const request = requests.get(Number(/Correction #(\d+)/.exec(event.locationNote || "")?.[1]));
      if (request?.toTime) note(session, "logoutAt", request.toTime, `Correction #${request.id}`);
      continue;
    }
    // Only the changes, never the reason: the note is "<changes> by <name> — <reason>", and a reason
    // that happens to read "check-out 17:00 → 18:00" must not be taken for what was typed.
    const changes = String(event.locationNote || "").split(" by ")[0];
    const checkIn = /^check-in [^;→]*→ (\d{1,2}:\d{2})(?:;|$)/.exec(changes)?.[1];
    const checkOut = /(?:^|; )check-out [^;→]*→ (\d{1,2}:\d{2})(?:;|$)/.exec(changes)?.[1];
    if (checkIn) note(session, "loginAt", checkIn, `HR edit (event ${event.id})`);
    if (checkOut) note(session, "logoutAt", checkOut, `HR edit (event ${event.id})`);
  }

  const repairs = [];
  for (const { session, field, value, source } of typed.values()) {
    const minutes = parseClockTime(value);
    const wrong = typedAsUtc(session.workDate, minutes);
    if (!sameInstant(session[field], wrong)) continue;
    const right = wallClockInstant(session.workDate, minutes);
    if (sameInstant(wrong, right)) continue; // A server on UTC with a studio on UTC: nothing to move.
    repairs.push({ session, field, typed: value, from: wrong, to: right, source });
  }
  // A day's check-in before its check-out: a repaired checkout is judged against the login as it
  // will be, which a check-in repair can only move earlier.
  repairs.sort((a, b) => (a.session.id - b.session.id) || (a.field === "loginAt" ? -1 : 1) - (b.field === "loginAt" ? -1 : 1));
  for (const entry of repairs.filter((item) => item.field === "logoutAt")) {
    const loginRepair = repairs.find((item) => item.session.id === entry.session.id && item.field === "loginAt");
    const login = loginRepair ? loginRepair.to : entry.session.loginAt;
    // A repaired checkout that would not be after its login is not guessed at: it is listed for a
    // person to look at, and left as it is.
    if (login && entry.to <= login) entry.byHand = "the repaired checkout would not be after the login";
  }
  return repairs;
}

async function repair({ session, field, typed, from, to, source, byHand }) {
  if (byHand) return false;
  let repaired = false;
  await prisma.$transaction(async (tx) => {
    // Read again inside the transaction: if anything moved the time since the preview, leave it.
    const current = await tx.attendanceSession.findUnique({ where: { id: session.id }, select: { loginAt: true, logoutAt: true } });
    if (!sameInstant(current?.[field], from)) return;
    const next = field === "loginAt" ? { loginAt: to } : { logoutAt: to };
    if (field === "logoutAt" && current.loginAt && to <= current.loginAt) {
      throw new Error(`the repaired checkout ${typed} would not be after the login - look at it by hand.`);
    }
    await tx.attendanceSession.update({ where: { id: session.id }, data: next });
    repaired = true;
    if (field === "logoutAt") {
      // A break the bad checkout closed is closed at the repaired one (never before it started).
      const closed = await tx.attendanceBreak.findMany({ where: { sessionId: session.id, endedAt: from }, select: { id: true, startedAt: true } });
      for (const row of closed) {
        await tx.attendanceBreak.update({ where: { id: row.id }, data: { endedAt: row.startedAt > to ? row.startedAt : to } });
      }
    }
    await tx.attendanceEvent.create({
      data: {
        sessionId: session.id,
        employeeId: session.employeeId,
        type: "ADMIN_EDIT",
        capturedAt: new Date(),
        locationNote: `Time-zone repair: ${field === "loginAt" ? "check-in" : "check-out"} ${formatClockTime(minutesOfDay(from))} → ${typed}, as typed in ${source} (it was saved on the server's UTC clock).`.slice(0, 255),
      },
    });
  });
  return repaired;
}

async function main() {
  const repairs = await findRepairs();
  console.log(`${APPLY ? "Repairing" : "Preview - nothing is changed. Run with --apply to repair"}: ${repairs.length} time${repairs.length === 1 ? "" : "s"} saved on the server's UTC clock.\n`);
  let failed = 0;
  for (const entry of repairs) {
    const who = `${entry.session.employee?.employeeName || "?"} (${entry.session.employee?.employeeId || entry.session.employeeId})`;
    const flag = entry.byHand ? ` · LOOK AT BY HAND: ${entry.byHand}` : "";
    console.log(`  session ${entry.session.id} · ${localIsoDate(entry.session.workDate)} · ${who} · ${entry.field === "loginAt" ? "check-in " : "check-out"} reads ${formatClockTime(minutesOfDay(entry.from))} → ${entry.typed} · from ${entry.source}${flag}`);
    if (!APPLY) continue;
    // One row that cannot be repaired does not stop the rest; it is said, and the run ends in error.
    try {
      await repair(entry);
    } catch (error) {
      failed += 1;
      console.error(`    session ${entry.session.id}: not repaired - ${error.message}`);
    }
  }
  const byHand = repairs.filter((entry) => entry.byHand).length;
  if (byHand) console.log(`\n${byHand} listed to look at by hand - ${APPLY ? "left as they were" : "--apply leaves them as they are"}.`);
  if (failed) { console.error(`${failed} could not be repaired - see above.`); process.exitCode = 1; }
  if (APPLY && repairs.length && !failed) console.log("\nDone. Run the preview again: it should list only what was left to look at by hand.");
}

// Run from the command line; required by a test, it only hands over its two steps.
if (require.main === module) {
  main()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}

module.exports = { findRepairs, repair };
