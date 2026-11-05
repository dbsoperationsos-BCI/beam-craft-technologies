/**
 * The date range the Leads & Followups board is read through, and the rule that decides when it is
 * offered at all.
 *
 * Every board on that screen is a list of dated things - a lead arrived on a day, a call came in at
 * a time - and until now the only way to ask "what came in this month" was to type into the Date
 * column filter, which matches text and so cannot express a range at all. This is that question
 * asked once, in the header, for whichever board is on screen.
 *
 * Here rather than inside CRMPage for the reason `crmBoards.js` is: the rule about which tabs may
 * carry a range is a rule, it has already been got wrong once by hand, and it is worth a place
 * `node --test` can read. CRMPage draws the control; this decides what it means.
 */

import { CALLS_BOARD } from "./crmBoards.js";

/** No range: the board as it has always been read. The value the switch opens on. */
export const ALL_TIME = "all";

/** The one option that needs two more answers before it means anything. */
export const CUSTOM_RANGE = "custom";

/*
 * The ranges, in the order they are read - narrowest first, widening to the month, and the one that
 * asks for its own dates last.
 *
 * `All Time` leads them, and it is not padding. A range switch with no way back to the whole board
 * is a filter that cannot be cleared: whoever picked Today would be left reading a board that was
 * quietly missing everything before this morning, with no option on the list that says so. It is
 * also what the control has to open on, because a board that filtered itself the moment it loaded
 * would be a board nobody asked to filter.
 */
export const dateRangeOptions = [
  { value: ALL_TIME, label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: CUSTOM_RANGE, label: "Custom Date" },
];

const dateRangeValues = new Set(dateRangeOptions.map((option) => option.value));

/** Whether this is one of the ranges at all - anything else is read as All Time. */
export const isDateRange = (value) => dateRangeValues.has(String(value || ""));

/*
 * ── Which tabs carry the switch ───────────────────────────────────────────────────────────────
 *
 * Three of the lead tabs are already a date: Today New Leads is the leads that arrived today, and
 * the two pending tabs are the follow-ups owed today and the ones owed yesterday. A range on top of
 * one of those is two answers to one question - "this month" and "today" at once - and the honest
 * result of asking it is an empty board, which reads as a broken filter rather than as a
 * contradiction. So the switch is not offered on them.
 *
 * Written as the tabs that are *already dated* rather than as the tabs that are allowed, so a tab
 * added to a vertical later carries the range without anybody having to remember to list it. The
 * dated three are dated by definition and will not grow.
 */
const DATED_TABS = new Set(["new", "pending", "yesterdayPending"]);

/*
 * The Call Box is the other way round: the range is offered on All and nowhere else.
 *
 * Its other four tabs - Incoming, Outgoing, Connected, Not Connected - are cuts of the *same* list
 * by what the call was, not by when it happened, and each is read as a queue to work through rather
 * than as a period to report on. Narrowing "the calls nobody answered" to this month hides the ones
 * from last month that are still nobody's enquiry, which is precisely the row that tab exists for.
 */
const CALLS_RANGE_TAB = "all";

/**
 * Whether the header offers a date range for this board on this tab.
 *
 * Asked of the board and the tab together, because the two boards answer it by opposite rules -
 * the Call Box allows one tab, the verticals refuse three.
 */
export function showsDateRange(board, tab) {
  const view = String(tab || "");
  if (board === CALLS_BOARD) return view === CALLS_RANGE_TAB;
  return !DATED_TABS.has(view);
}

/** A `Date` as the `YYYY-MM-DD` key every date in this CRM is written and compared as. */
export function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The same day, `days` further on or back, without tripping over month and year ends. */
function shift(date, days) {
  const moved = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return moved;
}

/**
 * The days a range covers, as `{ from, to }` inclusive keys - or `null` for no restriction.
 *
 * `today` is passed in rather than read here so the caller decides which day it is: the board
 * already sends the browser's own day to the server as `today`, and a range worked out against a
 * different one would put "Today" and the Today New Leads tab a day apart.
 *
 * Monday starts the week, which is the week the rest of the application draws - the Meetings
 * calendar's column headings and Employee Attendance's own range picker both begin there.
 *
 * A custom range with only one end filled in is answered as far as it goes: a start with no end is
 * everything from that day on, an end with no start everything up to it. Neither is an error, and
 * refusing both until the second box is filled would make the first one look broken.
 */
export function resolveDateRange(value, { today = new Date(), custom = {} } = {}) {
  const now = today instanceof Date ? today : new Date(`${String(today).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(now.getTime())) return null;

  switch (value) {
    case "today":
      return { from: dayKey(now), to: dayKey(now) };
    case "yesterday": {
      const day = shift(now, -1);
      return { from: dayKey(day), to: dayKey(day) };
    }
    case "week": {
      // getDay() is Sunday-based; Sunday belongs to the week that began six days earlier.
      const weekday = now.getDay();
      const start = shift(now, weekday === 0 ? -6 : 1 - weekday);
      return { from: dayKey(start), to: dayKey(now) };
    }
    case "month":
      return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayKey(now) };
    case CUSTOM_RANGE: {
      const from = String(custom.from || "").slice(0, 10);
      const to = String(custom.to || "").slice(0, 10);
      if (!from && !to) return null;
      // Picked back to front - an end before its start - is read as the range between them rather
      // than as an empty board, which is what the two dates plainly mean.
      if (from && to && to < from) return { from: to, to: from };
      return { from: from || "", to: to || "" };
    }
    default:
      return null;
  }
}
