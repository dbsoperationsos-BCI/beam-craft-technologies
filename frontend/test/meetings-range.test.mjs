import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEETING_TAB,
  MEETING_TABS,
  MEETING_TAB_IDS,
  dayRange,
  inMeetingTab,
  meetingRange,
  meetingTabEmptyMessage,
  meetingTabSortDirection,
} from "../src/lib/meetings.js";

/*
 * Which tab of the Meetings list a booking belongs to.
 *
 * The list is read through four questions - everything there is, what is on today, what is coming,
 * what has been - and the last three have to be a clean split: every dated row in exactly one of
 * them, or a row is either listed twice or lost between two tabs with nothing on screen to say so.
 *
 * The split is by calendar day rather than by the clock, which is the decision worth pinning down:
 * a meeting that started an hour ago is still one of today's.
 */

const TODAY = "2026-09-02";

/*
 * Meetings are built from local `Date` parts rather than from an ISO string with an offset on it.
 *
 * `dayKey` answers in local time - deliberately, so a 9pm meeting in India is not filed under
 * tomorrow - which means a fixed-offset string lands on a different day depending on where the
 * test is run. These dates are the same day in every zone.
 */
const meetingAt = (year, month, day, hour = 14, minute = 0) => ({ startAt: new Date(year, month - 1, day, hour, minute) });

const dayOf = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

test("today holds the whole of today, including meetings already over", () => {
  assert.equal(meetingRange(meetingAt(2026, 9, 2, 9, 0), TODAY), "today");
  assert.equal(meetingRange(meetingAt(2026, 9, 2, 23, 30), TODAY), "today");
  // The point of splitting by day: a meeting that ran this morning is what somebody has just come
  // out of, and dropping it into Past at the moment it began empties the day out from under them.
  assert.equal(meetingRange(meetingAt(2026, 9, 2, 0, 5), TODAY), "today");
});

test("tomorrow onwards is upcoming, yesterday back is past", () => {
  assert.equal(meetingRange(meetingAt(2026, 9, 3, 9, 0), TODAY), "upcoming");
  assert.equal(meetingRange(meetingAt(2027, 1, 1, 9, 0), TODAY), "upcoming");
  assert.equal(meetingRange(meetingAt(2026, 9, 1, 23, 59), TODAY), "past");
  assert.equal(meetingRange(meetingAt(2025, 12, 31, 9, 0), TODAY), "past");
});

test("a project's day answers the same question, without going near a clock", () => {
  // A project carries a written-down date rather than an instant, so the tabs read it as text. The
  // rule has to be the same one, or the same week reads differently for a wedding and a meeting.
  assert.equal(dayRange("2026-09-02", TODAY), "today");
  assert.equal(dayRange("2026-09-03", TODAY), "upcoming");
  assert.equal(dayRange("2026-09-01", TODAY), "past");
  assert.equal(dayRange("", TODAY), "");
});

test("the three dated tabs are a clean split - one home each, and no row with none", () => {
  const days = [[2026, 8, 30], [2026, 9, 1], [2026, 9, 2], [2026, 9, 3], [2026, 11, 20]];
  const dated = MEETING_TABS.filter((entry) => entry.id !== "all");
  for (const [year, month, day] of days) {
    const key = dayOf(year, month, day);
    const homes = dated.filter((entry) => inMeetingTab(key, entry.id, TODAY));
    assert.equal(homes.length, 1, `${key} belongs in ${homes.length} tabs rather than exactly one`);
    // And All holds everything, which is what makes it All.
    assert.equal(inMeetingTab(key, "all", TODAY), true);
  }
});

test("a row with no readable date is listed under All alone", () => {
  // It belongs to no day. Before All existed it was shown under every range instead, which was the
  // only way to stop a broken record living solely in the export; All is that home now, and one
  // home is enough - counted in three tabs it would inflate every number on the strip.
  for (const empty of ["", "not a date", null, undefined]) {
    assert.equal(inMeetingTab(empty, "all", TODAY), true);
    assert.equal(inMeetingTab(empty, "today", TODAY), false);
    assert.equal(inMeetingTab(empty, "upcoming", TODAY), false);
    assert.equal(inMeetingTab(empty, "past", TODAY), false);
  }
  assert.equal(meetingRange({ startAt: "" }, TODAY), "");
});

test("each tab reads from the end anybody would start at", () => {
  // Soonest first for what is ahead; most recent first for what is behind. Past sorted the other
  // way would put the oldest booking the studio ever took at the top of the page.
  assert.equal(meetingTabSortDirection("all"), "asc");
  assert.equal(meetingTabSortDirection("today"), "asc");
  assert.equal(meetingTabSortDirection("upcoming"), "asc");
  assert.equal(meetingTabSortDirection("past"), "desc");
});

test("the tabs are offered in time order, and the list opens on today", () => {
  // Left to right is a line through time, with everything at the head of it.
  assert.deepEqual(MEETING_TAB_IDS, ["all", "today", "upcoming", "past"]);
  // Today, because the schedule is read to work the day rather than to plan the month.
  assert.equal(DEFAULT_MEETING_TAB, "today");
  // Each says its own empty state, so a blank table names which part of the schedule is empty
  // rather than leaving the reader hunting for a filter they never set.
  for (const entry of MEETING_TABS) {
    assert.ok(entry.label, `${entry.id} has no label`);
    assert.ok(entry.empty, `${entry.id} has nothing to say when it holds nothing`);
    assert.equal(meetingTabEmptyMessage(entry.id), entry.empty);
  }
});
