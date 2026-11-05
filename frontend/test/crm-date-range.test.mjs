import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ALL_TIME, CUSTOM_RANGE, dateRangeOptions, resolveDateRange, showsDateRange } from "../src/lib/crmDateRange.mjs";
import { CALLS_BOARD } from "../src/lib/crmBoards.js";

/*
 * The date range on the Leads & Followups header.
 *
 * Two rules worth holding to account, and they are the two that were asked for by name. Which tabs
 * carry the switch at all - the Call Box on All alone, the three verticals everywhere except the
 * tabs that are already a date - and what each range resolves to, because a range that is a day out
 * is a filter that silently drops a day's work and says nothing about it.
 */

// A fixed Wednesday, so "this week" has days on both sides of it and the Monday start is testable.
const WEDNESDAY = new Date(2026, 8, 9);

test("the switch offers exactly the five ranges, and a way back to the whole board", () => {
  assert.deepEqual(dateRangeOptions.map((option) => option.label), [
    "All Time", "Today", "Yesterday", "This Week", "This Month", "Custom Date",
  ]);
  /*
   * All Time leads them, and it is not padding: a range switch with no way back is a filter that
   * cannot be cleared. Whoever picked Today would be left on a board quietly missing everything
   * before this morning, with nothing on the list that says so.
   */
  assert.equal(dateRangeOptions[0].value, ALL_TIME);
  assert.equal(resolveDateRange(ALL_TIME, { today: WEDNESDAY }), null);
  // And anything the switch has never heard of reads the same way, rather than as an empty board.
  assert.equal(resolveDateRange("last-quarter", { today: WEDNESDAY }), null);
});

test("each range is the days its name says", () => {
  assert.deepEqual(resolveDateRange("today", { today: WEDNESDAY }), { from: "2026-09-09", to: "2026-09-09" });
  assert.deepEqual(resolveDateRange("yesterday", { today: WEDNESDAY }), { from: "2026-09-08", to: "2026-09-08" });
  // Monday to today, which is the week the rest of the application draws - the Meetings calendar's
  // column headings and Employee Attendance's own picker both begin there.
  assert.deepEqual(resolveDateRange("week", { today: WEDNESDAY }), { from: "2026-09-07", to: "2026-09-09" });
  assert.deepEqual(resolveDateRange("month", { today: WEDNESDAY }), { from: "2026-09-01", to: "2026-09-09" });
});

test("a Sunday belongs to the week that began six days earlier, not to the one starting tomorrow", () => {
  /*
   * `getDay()` is Sunday-based, so the naive `1 - weekday` puts Sunday's week start on the *next*
   * day - a range whose start is after its end, which answers with nothing. This is the one day of
   * the week that gets it wrong, which is why it is worth its own test rather than a comment.
   */
  const sunday = new Date(2026, 8, 13);
  assert.deepEqual(resolveDateRange("week", { today: sunday }), { from: "2026-09-07", to: "2026-09-13" });
});

test("a range crossing a month or a year end is still the days it means", () => {
  // The 1st of a month: "yesterday" is the last day of the previous one, not the 0th of this.
  assert.deepEqual(resolveDateRange("yesterday", { today: new Date(2026, 8, 1) }), { from: "2026-08-31", to: "2026-08-31" });
  assert.deepEqual(resolveDateRange("yesterday", { today: new Date(2026, 0, 1) }), { from: "2025-12-31", to: "2025-12-31" });
  // And a week that starts in the previous month carries on into this one.
  assert.deepEqual(resolveDateRange("week", { today: new Date(2026, 8, 2) }), { from: "2026-08-31", to: "2026-09-02" });
});

test("a custom range takes what it has been given, and either end alone is a range", () => {
  const custom = (from, to) => resolveDateRange(CUSTOM_RANGE, { today: WEDNESDAY, custom: { from, to } });
  assert.deepEqual(custom("2026-08-01", "2026-08-31"), { from: "2026-08-01", to: "2026-08-31" });
  // One end filled in is answered as far as it goes. Refusing both until the second box is filled
  // would make the first one look broken.
  assert.deepEqual(custom("2026-08-01", ""), { from: "2026-08-01", to: "" });
  assert.deepEqual(custom("", "2026-08-31"), { from: "", to: "2026-08-31" });
  // Neither: no restriction, which is what an untouched Custom Date has to mean.
  assert.equal(custom("", ""), null);
  // Picked back to front, which the two pickers make hard but not impossible, is read as the range
  // between the two days rather than as an empty board.
  assert.deepEqual(custom("2026-08-31", "2026-08-01"), { from: "2026-08-01", to: "2026-08-31" });
});

test("the Call Box carries the range on All and on none of its other tabs", () => {
  /*
   * Incoming, Outgoing, Connected and Not Connected are cuts of the same list by what the call *was*,
   * and each is read as a queue to work through rather than as a period to report on. Narrowing "the
   * calls nobody answered" to this month hides the ones from last month that are still nobody's
   * enquiry, which is precisely the row that tab exists for.
   */
  assert.equal(showsDateRange(CALLS_BOARD, "all"), true);
  for (const tab of ["incoming", "outgoing", "connected", "notConnected"]) {
    assert.equal(showsDateRange(CALLS_BOARD, tab), false, `the Call Box offers a range on ${tab}`);
  }
});

test("a vertical carries the range everywhere except the tabs that are already a date", () => {
  /*
   * Today New Leads is the leads that arrived today; the two pending tabs are the follow-ups owed
   * today and owed yesterday. A range on top of one of them is two answers to one question, and the
   * honest result of asking it is an empty board - which reads as a broken filter rather than as a
   * contradiction.
   */
  for (const board of ["Dum Dum", "Qua Qua", "Corp"]) {
    for (const tab of ["new", "pending", "yesterdayPending"]) {
      assert.equal(showsDateRange(board, tab), false, `${board} offers a range on ${tab}`);
    }
    for (const tab of ["all", "yetToConnect", "overallPending", "rejected", "newborns", "birthdays"]) {
      assert.equal(showsDateRange(board, tab), true, `${board} refuses a range on ${tab}`);
    }
  }
});

test("the three dated tabs are named by the ids the board actually uses", () => {
  /*
   * The rule above is written against tab ids, and a typo in one of them would be silent: the switch
   * would simply appear on a tab it must not, which nothing else would report. So the ids are read
   * back out of CRMPage's own tab lists.
   */
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  const tabs = source.slice(source.indexOf("const FOLLOWUP_TABS = ["), source.indexOf("const CALL_TABS = ["));
  assert.match(tabs, /\{ id: "new", label: "Today New Leads" \}/);
  assert.match(tabs, /\{ id: "pending", label: "Today Pending Followups" \}/);
  assert.match(tabs, /\{ id: "yesterdayPending", label: "Yesterday Pending Followups" \}/);
});

test("Custom Date's two ends are labelled From and To, not left as placeholders", () => {
  /*
   * They were unlabelled `compact` fields carrying the words as placeholders, on the reasoning that
   * three controls of the same height read as one control. What that produced on the header was two
   * bare calendar icons: a placeholder is the first thing a narrow box truncates, so the pair said
   * nothing about which end each was - and a range picker whose two ends cannot be told apart is a
   * range picker nobody can set.
   *
   * A label above each is two words that cannot be truncated away, and it is how every other pair of
   * dates in this application is drawn. The row aligns on `items-end` so the switch beside them sits
   * level with the boxes rather than with the labels above them.
   */
  const control = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "shared", "DateRangeSwitch.js"),
    "utf8",
  );
  assert.match(control, /label="From"/);
  assert.match(control, /label="To"/);
  assert.match(control, /items-end/, "the switch no longer sits level with the date boxes");
  // `DateField` has no label-less mode left to fall back into, so this cannot quietly regress by a
  // prop being passed again: the label is the only thing the field draws above its box.
  const field = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "shared", "DateField.js"),
    "utf8",
  );
  assert.doesNotMatch(field, /\bcompact\b/, "DateField has grown a mode that hides its label again");
  /*
   * And each end is bounded by the other, so a start after its end is refused in the calendar rather
   * than accepted and answered with an empty board.
   */
  assert.match(control, /maxDate=\{custom\.to \|\| ""\}/);
  assert.match(control, /minDate=\{custom\.from \|\| ""\}/);
});

test("on Custom Date the two days come first and the switch follows them", () => {
  /*
   * The switch leads the row every other time, because there is nothing else on it and it is what
   * the reader presses. Once Custom Date is chosen the row reads left to right as the answer - from
   * this day, to that day - and the control that chose the mode belongs after it rather than in
   * front of two boxes it is no longer the subject of.
   */
  const control = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "shared", "DateRangeSwitch.js"),
    "utf8",
  );
  assert.match(control, /\{isCustom \? <>\{range\}\{switcher\}<\/> : switcher\}/, "the switch sits in front of the calendars again");
  // The two ends are still bounded by each other, so a start after its end is refused in the
  // calendar rather than accepted and answered with an empty board.
  assert.match(control, /maxDate=\{custom\.to \|\| ""\}/);
  assert.match(control, /minDate=\{custom\.from \|\| ""\}/);
});

test("the range is drawn ahead of Nebula and only where it applies", () => {
  /*
   * "Near the left of the Nebula AI icon", which is a slot of its own on the module header rather
   * than a place in the actions after it: everything from Nebula rightwards does something - asks a
   * question, imports a file, adds a lead - and this only changes what is being looked at.
   */
  const header = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "layout", "ModulePageHeader.js"),
    "utf8",
  );
  // The page's actions are conditional now - a table with rows ticked takes the row over - so what
  // is pinned here is the order of the three slots rather than the expression in the last of them.
  assert.match(header, /\{leadingActions\}<NebulaHeaderButton \/>\{[^<]*actions\}/, "the leading slot no longer sits ahead of Nebula");

  const page = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
    "utf8",
  );
  /*
   * The slot holds two things now - the "My Leads" switch and the range - so the condition sits on
   * the range itself rather than on the whole slot, which would have taken the switch off screen
   * with it on the tabs that are already a date.
   */
  assert.match(
    page,
    /\{rangeApplies && \(\s*\n\s*<DateRangeSwitch/,
    "the CRM header draws the range unconditionally",
  );
  // And the range that is actually sent is the choice crossed with where it may apply, so a range
  // chosen elsewhere can never narrow a tab whose control is not on screen to say so.
  assert.match(page, /rangeApplies \? resolveDateRange\(dateRange, \{ custom: customRange \}\) : null/);
});
