import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEDULE_KINDS,
  compareScheduleEntries,
  scheduleByDay,
  scheduleEntryCell,
  scheduleEntryDay,
  scheduleEntryLead,
  scheduleKind,
} from "../src/lib/schedule.js";

/*
 * Which day a booking lands on, and what it looks like when it gets there.
 *
 * The calendar draws three kinds of thing that answer "when" in two different ways, and getting
 * that wrong is silent: a shoot on the wrong day still looks like a perfectly good calendar.
 *
 *   * a meeting is a **moment** - a real instant, placed on whatever local day it falls on;
 *   * a shoot and a main event are a **day** - the studio wrote a date down, and the server sends
 *     it as plain `YYYY-MM-DD` text precisely so no timezone can move it.
 *
 * The second is the one worth pinning hardest. `2026-09-01T00:00:00Z` read as an instant is
 * 31 August for anybody west of Greenwich, so a 1 September shoot would be drawn on the wrong day
 * for half the world - which is the same fault `dayKey`'s own comment describes.
 */

const meeting = (id, startAt, title = "Meeting") => ({ id, kind: "meeting", title, startAt, endAt: null, day: null, reference: "DBS-DD-EID-1" });
const shoot = (id, day, title = "Shoot", reference = "DBS-SID-0001") => ({ id, kind: "shoot", title, startAt: null, endAt: null, day, reference });
const mainEvent = (id, day, title = "Main event") => ({ id, kind: "project", title, startAt: null, endAt: null, day, reference: "DBS-EVT-00001" });
// A day *and* an hour, both as text: the register keeps them in two VarChar columns and there is no
// instant behind them for anything to read a local day back from.
const interview = (id, day, title = "Candidate", clock = "10:30 am") => ({
  id, kind: "interview", title, startAt: null, endAt: null, day,
  reference: `DBS-INTV-00000${id.slice(-1)}`, meta: { clock, clock24: "10:30" },
});

/* ------------------------------------------------------------------ which day it belongs on */

test("a booking made by the day keeps its own date, whatever the timezone", () => {
  // The whole point of the server sending `day` as text: midnight UTC read as an instant is the
  // previous day in the Americas, and the shoot would be drawn one cell to the left.
  assert.equal(scheduleEntryDay(shoot("s1", "2026-09-01")), "2026-09-01");
  assert.equal(scheduleEntryDay(mainEvent("p1", "2026-12-31")), "2026-12-31");
});

test("a meeting is placed on the local day its instant falls on", () => {
  // Built from local parts so the assertion holds in any zone: whatever "2 September 2 pm here"
  // is in UTC, it is 2 September here.
  const startAt = new Date(2026, 8, 2, 14, 0);
  assert.equal(scheduleEntryDay(meeting("m1", startAt)), "2026-09-02");
});

test("a booking with neither a day nor an instant is left off the grid", () => {
  // There is no cell to draw it in. It is dropped rather than piled onto today, which would be a
  // quiet lie about when it happens.
  assert.equal(scheduleEntryDay({ kind: "shoot", day: "", startAt: null }), "");
  const days = scheduleByDay([{ id: "x", kind: "shoot", day: "", startAt: null }]);
  assert.equal(days.size, 0);
});

/* ------------------------------------------------------------------------ running order */

test("a day reads in running order: timed bookings first, in clock order", () => {
  const morning = meeting("m1", new Date(2026, 8, 2, 9, 30), "Morning call");
  const afternoon = meeting("m2", new Date(2026, 8, 2, 15, 0), "Afternoon call");
  const days = scheduleByDay([afternoon, morning, shoot("s1", "2026-09-02")]);
  assert.deepEqual(days.get("2026-09-02").map((entry) => entry.id), ["m1", "m2", "s1"]);
});

test("whole-day bookings follow the timed ones, in the legend's order", () => {
  // They have no clock to sort by, so the order is the one the legend reads - and it is stable
  // rather than whatever the two queries happened to return.
  const days = scheduleByDay([mainEvent("p1", "2026-09-02"), shoot("s1", "2026-09-02")]);
  assert.deepEqual(days.get("2026-09-02").map((entry) => entry.kind), ["shoot", "project"]);
});

test("two shoots on one day keep a stable order rather than the query's", () => {
  const first = shoot("a", "2026-09-02", "A", "DBS-SID-0001");
  const second = shoot("b", "2026-09-02", "B", "DBS-SID-0003");
  assert.ok(compareScheduleEntries(first, second) < 0);
  assert.ok(compareScheduleEntries(second, first) > 0);
});

/* ------------------------------------------------------------------------- the legend */

test("a kind switched off is left out of the grid entirely", () => {
  // Not drawn faintly: a calendar is read by what is on it, and a half-visible booking would be
  // read as a booking.
  const entries = [meeting("m1", new Date(2026, 8, 2, 9, 0)), shoot("s1", "2026-09-02")];
  const days = scheduleByDay(entries, new Set(["meeting"]));
  assert.deepEqual(days.get("2026-09-02").map((entry) => entry.id), ["m1"]);
});

test("with no kinds named, everything is drawn", () => {
  // The calendar's own default, before anybody has touched the legend.
  const entries = [meeting("m1", new Date(2026, 8, 2, 9, 0)), shoot("s1", "2026-09-02")];
  assert.equal(scheduleByDay(entries).get("2026-09-02").length, 2);
});

test("every kind has a colour, a legend label and a cell fill", () => {
  assert.deepEqual(SCHEDULE_KINDS.map((kind) => kind.value), ["holiday", "meeting", "shoot", "project", "interview"]);
  for (const kind of SCHEDULE_KINDS) {
    assert.ok(kind.label, `${kind.value} has no legend label`);
    assert.ok(kind.dot, `${kind.value} has no legend colour`);
    assert.ok(kind.cell, `${kind.value} has no cell fill`);
  }
  // Meetings keep the blue they have always had, so nothing changes for somebody who was using
  // this calendar yesterday.
  assert.match(scheduleKind("meeting").cell, /blue/);
  // And they are told apart by colour, which is the whole point of the legend.
  assert.equal(new Set(SCHEDULE_KINDS.map((kind) => kind.dot)).size, SCHEDULE_KINDS.length);
  /*
   * Attendance is not one of them, and is not coming back. It was drawn grey behind the rest
   * because it was the background of a day rather than a thing in it — and a chip per person per
   * day is what finally took it off the calendar altogether. Who was at work is the register's
   * question.
   *
   * Holidays are the one kind that is not a booking, and they are here for the opposite reason:
   * the studio being shut is the same fact for everybody, and it is the whole of what an employee
   * holding no other permission sees on this calendar.
   */
  assert.equal(SCHEDULE_KINDS.find((kind) => kind.value === "attendance"), undefined, "attendance is on the calendar again");
  assert.match(scheduleKind("holiday").cell, /rose/);
});

test("a chip takes its kind's colour and nothing varies it", () => {
  /*
   * Attendance was the one kind that coloured itself by its own contents, meaning two opposite
   * things — here and not here — that had to be told apart at a glance. It is no longer drawn, so
   * every remaining kind means exactly one thing and a chip is a lookup again.
   */
  for (const kind of ["holiday", "meeting", "shoot", "project", "interview"]) {
    assert.equal(scheduleEntryCell({ kind, meta: { status: "ABSENT" } }), scheduleKind(kind).cell);
  }
});

test("a day is ordered meetings, then shoots, then main events", () => {
  // `SCHEDULE_KINDS` order is what a day is sorted by, so a cell that can show three shows the
  // three most specific things booked on it.
  const day = scheduleByDay([
    { id: "p1", kind: "project", day: "2026-09-02", reference: "DBS-SID-0003" },
    { id: "s1", kind: "shoot", day: "2026-09-02", reference: "DBS-SID-DD-ERD-000003" },
    { id: "m1", kind: "meeting", day: "2026-09-02", startAt: "2026-09-02T04:00:00.000Z" },
  ]).get("2026-09-02");
  assert.deepEqual(day.map((entry) => entry.kind), ["meeting", "shoot", "project"]);
});

test("a holiday leads the day it falls on, above whatever is still booked in it", () => {
  /*
   * The studio being shut is the context the rest of the day is read in rather than one more thing
   * in it, so it is first in `SCHEDULE_KINDS` and therefore first in the cell. A timed meeting
   * still sorts above it - it has a clock, and the sort reads clock times first - which is right:
   * something happening at 09:30 on a holiday is the more surprising fact of the two.
   */
  const day = scheduleByDay([
    { id: "s1", kind: "shoot", day: "2026-10-20", reference: "DBS-SID-0003" },
    { id: "h1", kind: "holiday", day: "2026-10-20", title: "Diwali", reference: "" },
  ]).get("2026-10-20");
  assert.deepEqual(day.map((entry) => entry.kind), ["holiday", "shoot"]);
});

test("a holiday's cell reads as its name, with nothing in the lead", () => {
  // It refers to nothing and belongs to nobody, so the server sends no reference and the chip is
  // the name alone - "Diwali", not "— Diwali".
  assert.equal(scheduleEntryLead({ kind: "holiday", day: "2026-10-20", title: "Diwali", reference: "" }), "");
});

test("an unknown kind falls back to a drawable one rather than crashing the grid", () => {
  // A kind added on the server and not yet known here must not take the calendar down with it.
  assert.ok(scheduleKind("something-new").cell);
  // And it falls back to a meeting rather than to the first kind in the list, which is now a
  // holiday: drawing an unrecognised entry as "the studio is closed" is a worse thing to be wrong
  // about than drawing it as a meeting.
  assert.equal(scheduleKind("something-new").value, "meeting");
});

/* --------------------------------------------------------------- what a cell leads with */

test("a meeting leads with its clock time; a shoot leads with its id", () => {
  // A shoot has no time to show - it has a date and a length - and "DBS-SID-0003" is how the
  // studio names that day's work.
  assert.match(scheduleEntryLead(meeting("m1", new Date(2026, 8, 2, 9, 30))), /09:30/);
  assert.equal(scheduleEntryLead(shoot("s1", "2026-09-02", "ZZ Dur Shoot", "DBS-SID-0003")), "DBS-SID-0003");
  assert.equal(scheduleEntryLead(mainEvent("p1", "2026-09-02")), "DBS-EVT-00001");
});

/* ───────────────────────────────────────────────── an interview: a day with an hour on it ── */

test("an interview leads with the hour it is set for, not with the candidate's id", () => {
  /*
   * The third way of answering "when". An interview is a **day** - `interview_date` and
   * `interview_time` are text columns with no instant behind them, so the server sends no
   * `startAt` and no timezone can move it - and it is also the one day-booked kind that states an
   * hour. "10:30 am" is what the day is called by, exactly as a meeting's time is, so the chip
   * leads with it rather than with "DBS-INTV-000004".
   */
  const candidate = interview("i1", "2026-09-02", "Asha R", "10:30 am");
  assert.equal(scheduleEntryDay(candidate), "2026-09-02");
  assert.equal(scheduleEntryLead(candidate), "10:30 am");
  // And one with no hour set falls back to the candidate's own id, the way a shoot does.
  assert.equal(scheduleEntryLead(interview("i2", "2026-09-02", "Asha R", "")), "DBS-INTV-000002");
});

test("an interview is drawn in its own colour and sorts after the studio's own bookings", () => {
  // Violet, told apart from the meetings' blue at a glance in a cell that holds both.
  assert.match(scheduleKind("interview").cell, /violet/);
  /*
   * Last in `SCHEDULE_KINDS`, so last among the whole-day entries of a day: a shoot and a main
   * event are the studio's work and an interview is somebody visiting it. A *timed* meeting still
   * sorts above all of them, because the sort reads clock times first.
   */
  const day = scheduleByDay([
    interview("i1", "2026-09-02", "Asha R", "10:30 am"),
    shoot("s1", "2026-09-02"),
    mainEvent("p1", "2026-09-02"),
  ]).get("2026-09-02");
  assert.deepEqual(day.map((entry) => entry.kind), ["shoot", "project", "interview"]);
});
