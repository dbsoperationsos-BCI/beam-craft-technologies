import test from "node:test";
import assert from "node:assert/strict";

import { meetingCountdown, meetingFinished, meetingNotices } from "../src/lib/meetings.js";

/*
 * What the topbar's bell says about meetings.
 *
 * The bell is on every screen, so it is the thing most likely to be believed and least likely to
 * be checked against the Meetings page. It therefore has to answer with the same rules that page
 * does - the same idea of which day a meeting is on, and the same idea of whether it is over.
 *
 * Dates are built from local parts rather than from ISO strings with an offset, because `dayKey`
 * answers in local time: a fixed-offset string would land on a different day depending on where
 * these run.
 */

const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute);
const NOW = at(2026, 9, 2, 10, 0);

const meeting = (id, start, { end = null, status = "SCHEDULED", title = "Meeting", lead = null } = {}) => ({
  id,
  title,
  status,
  startAt: start,
  endAt: end,
  lead,
});

/* ------------------------------------------------------------------- what is on the bell */

test("today comes first, in running order, and the whole day is on it", () => {
  const notices = meetingNotices([
    meeting("late", at(2026, 9, 2, 16, 0)),
    meeting("done", at(2026, 9, 2, 8, 0), { end: at(2026, 9, 2, 8, 30) }),
    meeting("soon", at(2026, 9, 2, 10, 20)),
  ], { now: NOW });

  // A meeting that has just finished is exactly what somebody checks the bell to confirm, so it
  // stays on it - the day's schedule, not what is left of it.
  assert.deepEqual(notices.today.map((entry) => entry.id), ["done", "soon", "late"]);
});

test("the badge counts what is still to come, so it clears as the day is worked", () => {
  const notices = meetingNotices([
    meeting("done", at(2026, 9, 2, 8, 0), { end: at(2026, 9, 2, 8, 30) }),
    meeting("soon", at(2026, 9, 2, 10, 20)),
    meeting("late", at(2026, 9, 2, 16, 0)),
  ], { now: NOW });
  assert.equal(notices.pending, 2);

  // Once the day is done the badge is gone, rather than sitting on three for ever.
  const afterwards = meetingNotices([
    meeting("done", at(2026, 9, 2, 8, 0), { end: at(2026, 9, 2, 8, 30) }),
  ], { now: at(2026, 9, 2, 23, 0) });
  assert.equal(afterwards.pending, 0);
  assert.equal(afterwards.today.length, 1, "and the meeting is still listed");
});

test("what is coming is a few of the next days, not the whole diary", () => {
  const many = Array.from({ length: 9 }, (unused, index) => meeting(`d${index}`, at(2026, 9, 3 + index, 11, 0)));
  const notices = meetingNotices(many, { now: NOW, upcomingLimit: 5 });
  assert.equal(notices.upcoming.length, 5);
  assert.deepEqual(notices.upcoming.map((entry) => entry.id), ["d0", "d1", "d2", "d3", "d4"]);
  // The bell answers "what is coming"; the Meetings screen answers "what is booked".
  assert.equal(notices.today.length, 0);
});

test("yesterday's meetings are not notifications", () => {
  const notices = meetingNotices([meeting("old", at(2026, 9, 1, 15, 0))], { now: NOW });
  assert.equal(notices.today.length, 0);
  assert.equal(notices.upcoming.length, 0);
  assert.equal(notices.pending, 0);
});

test("a cancelled meeting is left off entirely", () => {
  // A cancellation is not news that needs chasing, and a badge counting one would send somebody
  // to a meeting that is not happening.
  const notices = meetingNotices([
    meeting("off", at(2026, 9, 2, 11, 0), { status: "CANCELLED" }),
    meeting("on", at(2026, 9, 2, 12, 0)),
  ], { now: NOW });
  assert.deepEqual(notices.today.map((entry) => entry.id), ["on"]);
  assert.equal(notices.pending, 1);
});

test("a meeting with no readable start is not put on the bell", () => {
  // It cannot be placed on a day or counted down, so announcing it would say nothing useful.
  const notices = meetingNotices([meeting("broken", ""), meeting("also", null)], { now: NOW });
  assert.equal(notices.today.length, 0);
  assert.equal(notices.pending, 0);
});

test("nothing at all is an empty bell rather than a crash", () => {
  for (const input of [[], null, undefined, "not a list"]) {
    const notices = meetingNotices(input, { now: NOW });
    assert.deepEqual(notices, { today: [], upcoming: [], pending: 0 });
  }
});

/* -------------------------------------------------------------------- how a row reads */

test("within the hour, a meeting is announced by how long is left", () => {
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 10, 12)), NOW), "in 12 minutes");
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 10, 1)), NOW), "in 1 minute");
});

test("beyond the hour the time beside it says it better than a count of minutes", () => {
  // "in 95 minutes" is not how anybody reads a schedule.
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 16, 0)), NOW), "");
});

test("the two states worth being told about are named", () => {
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 10, 0)), NOW), "starting now");
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 9, 50), { end: at(2026, 9, 2, 10, 30) }), NOW), "under way");
  assert.equal(meetingCountdown(meeting("a", at(2026, 9, 2, 9, 0), { end: at(2026, 9, 2, 9, 30) }), NOW), "finished");
});

test("a meeting with no end time is over once it has started", () => {
  // There is nothing else to go on, and treating it as running for ever would keep it on the badge.
  assert.equal(meetingFinished(meeting("a", at(2026, 9, 2, 9, 0)), NOW), true);
  assert.equal(meetingFinished(meeting("a", at(2026, 9, 2, 11, 0)), NOW), false);
});
