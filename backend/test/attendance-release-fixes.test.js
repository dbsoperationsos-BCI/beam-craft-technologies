const { studioDateKey } = require("../src/services/studioTime");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { wallClockInstant, minutesOfDay, localIsoDate, parseClockTime } = require("../src/modules/hrm/attendance/attendanceRules");
const { outcomeOf, DECISIONS } = require("../src/modules/hrm/attendance/approvals");

/*
 * The fixes made in the pre-release review of the attendance module: a correction that never
 * applied, times read in the wrong zone, decisions and breaks that could race, breaks left running
 * on a closed day, a refuser named to the person refused, and photos that could be outside links.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");
const SERVICE = fs.readFileSync(path.join(MODULE, "service.js"), "utf8");
const EVENTS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "events", "controller.js"), "utf8");

test("a correction keeps the checkout it proposes, so approving it has a time to apply", () => {
  assert.match(CONTROLLER, /toTime: input\.type === "PERMISSION" \|\| input\.type === "CORRECTION" \? input\.toTime : null,/);
});

test("a typed time is that time on the studio's clock, not in UTC", () => {
  // Whatever zone the tests run in, the instant reads back as the time and day that were asked for.
  for (const [day, time] of [["2026-09-26", "18:00"], ["2026-09-26", "09:30"], ["2026-01-01", "00:05"], ["2026-12-31", "23:59"]]) {
    const at = wallClockInstant(day, parseClockTime(time));
    assert.equal(minutesOfDay(at), parseClockTime(time), `${time} on ${day} did not read back as ${time}`);
    // The day, as the studio reads it - not as the machine running the tests does.
    assert.equal(studioDateKey(at), day);
  }
  assert.equal(wallClockInstant(null, 60), null);
  assert.equal(wallClockInstant("2026-09-26", null), null);
  // The correction check, the correction itself and an HR edit all build their instants this way.
  assert.match(CONTROLLER, /const checkOutAt = wallClockInstant\(day, minutes\);/);
  assert.match(CONTROLLER, /return wallClockInstant\(request\.fromDate, minutes\);/);
  assert.match(CONTROLLER, /const instant = \(time\) => wallClockInstant\(session\.workDate, parseClockTime\(time\)\);/);
  assert.equal(localIsoDate("2026-09-26"), "2026-09-26");
});

test("a single-approver ask is settled by the first yes, a leave still needs everybody", () => {
  const rows = (...decisions) => decisions.map((decision, index) => ({ approverEmployeeId: index + 1, decision }));
  assert.equal(outcomeOf(rows("APPROVED", "PENDING"), "PERMISSION"), DECISIONS.APPROVED);
  assert.equal(outcomeOf(rows("PENDING", "APPROVED", "PENDING"), "CORRECTION"), DECISIONS.APPROVED);
  assert.equal(outcomeOf(rows("APPROVED", "PENDING"), "LEAVE"), DECISIONS.PENDING);
  assert.equal(outcomeOf(rows("APPROVED", "PENDING"), "COMP_OFF"), DECISIONS.PENDING);
  assert.equal(outcomeOf(rows("APPROVED", "REJECTED"), "PERMISSION"), DECISIONS.REJECTED, "a refusal still settles it");
  assert.equal(outcomeOf(rows("APPROVED", "PENDING")), DECISIONS.PENDING, "no type reads as the strict rule, as before");
  assert.equal(outcomeOf([], "PERMISSION"), DECISIONS.PENDING, "nobody asked is never an approval");
});

test("decisions on one request are taken one at a time, and never overwrite an answer", () => {
  const decide = CONTROLLER.slice(CONTROLLER.indexOf("async function decide("), CONTROLLER.indexOf("async function approveRequest("));
  const lock = decide.indexOf("SELECT id FROM attendance_request WHERE id = ${request.id} FOR UPDATE");
  assert.ok(lock > -1, "the request row is not locked");
  assert.ok(lock < decide.indexOf("recordApproverDecision"), "the lock comes after the decision is written");
  /*
   * Asked again **inside** the lock, of the rows as they are after it - which is the whole of the
   * race fix. It used to read `current.status !== "PENDING"`; the question is `mayAnswer` now,
   * because a rejection may be changed to an approval and a status check would refuse every reversal
   * at the last moment. Same property, one place: the second presser is told the request moved.
   */
  assert.match(decide, /if \(!mayAnswer\(current, mine, status\)\) \{/);
  assert.match(decide, /This request has changed since you opened it/);
  /*
   * And the row is written by **whose** it is, no longer by `decision: "PENDING"` as well.
   *
   * That clause used to be what stopped an answer being overwritten; `mayAnswer` holds that rule
   * now, above and inside the lock. Left here it would silently drop the one reversal allowed -
   * `updateMany` matching nothing writes nothing and reports no error, so the request would be
   * recomputed from rows that never changed and a reversal would appear to do nothing at all.
   */
  assert.match(SERVICE, /where: \{ requestId: request\.id, approverEmployeeId \},/);
  assert.match(SERVICE, /return outcomeOf\(rows, request\.type\);/);
});

test("a break is written with its day locked, so two cannot open and none lands after the logout", () => {
  assert.match(CONTROLLER, /SELECT id FROM attendance_session WHERE id = \$\{sessionId\} FOR UPDATE/);
  const start = CONTROLLER.slice(CONTROLLER.indexOf("async function startBreak("), CONTROLLER.indexOf("async function endBreak("));
  const end = CONTROLLER.slice(CONTROLLER.indexOf("async function endBreak("), CONTROLLER.indexOf("async function getBreaks("));
  for (const [name, body] of [["Break In", start], ["Break Off", end]]) {
    const lock = body.indexOf("await lockOpenSession(tx, session.id);");
    assert.ok(lock > -1, `${name} does not lock the day`);
    assert.ok(lock < body.indexOf("tx.attendanceBreak.findFirst"), `${name} checks for a running break before locking`);
  }
});

test("a day closed by a correction or an HR edit leaves no break running", () => {
  assert.match(SERVICE, /async function closeOpenBreaks\(client, sessionId, at\)/);
  const apply = SERVICE.slice(SERVICE.indexOf("async function applyCorrection("));
  assert.match(apply.slice(0, 400), /await closeOpenBreaks\(client, session\.id, checkOutAt\);/);
  assert.match(CONTROLLER, /if \(nextOut\) await service\.closeOpenBreaks\(tx, session\.id, nextOut\);/);
});

test("the person refused is not told who refused them", () => {
  assert.match(SERVICE, /const anonymous = forRequester && !requesterMaySeeApprovers\(request\.status\);/);
  assert.match(SERVICE, /decidedByName: anonymous \? "" : /);
  assert.match(SERVICE, /actorName: anonymous && \["APPROVED", "REJECTED"\]\.includes\(event\.action\) \? "" : event\.actorName,/);
});

test("an event's photos are pictures sent with it, never links, and its date is a real day", async () => {
  assert.match(EVENTS, /\.regex\(\/\^data:image\\\/\(jpeg\|png\|webp\|gif\);base64,\/i/);
  assert.match(EVENTS, /images: z\.array\(photoSchema\)/);
  assert.match(EVENTS, /image: photoSchema\.optional\(\),/);
  assert.match(EVENTS, /\.refine\(\(value\) => localIsoDate\(calendarDay\(value\)\) === value/);
  assert.equal(localIsoDate(require("../src/modules/hrm/attendance/attendanceRules").calendarDay("2026-02-31")) === "2026-02-31", false, "31 February is not a day");
});
