// A relative import rather than the `@/` alias, the way `excludedNumbers.js` reaches its
// sibling: these rules are covered by plain `node --test`, which resolves no alias.
import { dayKey, formatMeetingTime } from "./meetings.js";

/**
 * The studio's calendar: what is booked, whatever module booked it.
 *
 * The Meetings calendar used to draw meetings alone, which answered "what is my day" for one
 * person doing one job. A shoot is the studio's day far more than a meeting is, and it was
 * nowhere - so the grid now draws every kind of booking and says which is which by colour.
 *
 * The rules live here rather than in the page because they are the same three questions asked of
 * every entry - which day is it on, what colour is it, what does it say - and a calendar that
 * answered them differently per kind is how one kind ends up on the wrong day.
 */

/**
 * The kinds, in the order the legend reads them.
 *
 * Meetings keep the blue they have always had, so nothing about that part of the calendar changes
 * for somebody who was using it yesterday. The other two take colours far enough from it, and from
 * each other, to be told apart at a glance in a crowded day cell. Each carries a `dot` for the
 * legend as well as the cell's own fill, because a coloured block and a coloured dot need different
 * weights of the same colour to read as the same thing.
 */
export const SCHEDULE_KINDS = [
  {
    /*
     * First, because a holiday is the context the rest of the day is read in rather than one more
     * thing booked in it: "the studio is shut" belongs at the top of the cell, above whatever is
     * still happening that day. Rose, which is the one warm colour far enough from the shoots'
     * amber to be told apart at a glance in a crowded cell.
     */
    value: "holiday",
    label: "Holidays",
    dot: "bg-rose-500",
    cell: "bg-rose-50 text-rose-800 hover:bg-rose-100",
  },
  {
    /*
     * A branch's hours held with nothing booked in them (Calendar → a day's ⋮ → Block Period). Next to
     * the holidays because it is the same kind of fact - time that is not free - and grey, the one
     * colour that reads as "unavailable" rather than as another thing booked.
     */
    value: "block",
    label: "Blocked Periods",
    dot: "bg-gray-500",
    // A step lighter than a chip on the page: the dark themes paint gray-100 as the page itself.
    cell: "bg-slate-200 text-slate-800 hover:bg-slate-300",
  },
  {
    value: "meeting",
    label: "Meetings",
    dot: "bg-blue-500",
    cell: "bg-blue-50 text-blue-800 hover:bg-blue-100",
  },
  {
    value: "shoot",
    label: "Shoots",
    dot: "bg-amber-500",
    cell: "bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    /*
     * A candidate coming in, from the HRM Interview register. Last, because it is the one kind that
     * is nobody's client - and violet, which is the remaining colour far enough from the meetings'
     * blue to be told apart at a glance in a day cell that holds both.
     */
    value: "interview",
    label: "Interviews",
    dot: "bg-violet-500",
    cell: "bg-violet-50 text-violet-900 hover:bg-violet-100",
  },
  {
    /*
     * The signed-in person's own attendance, from the HRM register: a day that was Absent, On leave,
     * a Comp off, Late, a Half day or an Early exit. Only ever one's own, so it is never somebody
     * else's crowd of chips. Each status takes its own colour (`ATTENDANCE_CELLS`); this is the
     * legend's dot and the fallback.
     */
    value: "attendance",
    label: "My Attendance",
    dot: "bg-slate-500",
    cell: "bg-slate-100 text-slate-800 hover:bg-slate-200",
  },
  {
    /*
     * Everybody's absences, for an administrator: **one** chip a day - "Attendance · 5" - with the
     * names behind it in the pop-up, under the status each is counted as.
     *
     * Coloured by status where the day holds only one, as My Attendance is (`ATTENDANCE_CELLS`);
     * a day holding both absences and leaves has no one colour to take and falls back to this,
     * which is deliberately neither of theirs - red over a day that is half leave would read as
     * five absences.
     */
    value: "teamAttendance",
    label: "Team Attendance",
    dot: "bg-red-500",
    cell: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  },
];

/**
 * An attendance chip's colour by its status, so a month reads at a glance: away in red and purple,
 * a day off taken in lieu in teal, and the days that were worked but not fully in the warm colours.
 */
export const ATTENDANCE_CELLS = {
  Absent: "bg-red-50 text-red-800 hover:bg-red-100",
  "On leave": "bg-purple-50 text-purple-800 hover:bg-purple-100",
  "Comp off": "bg-teal-50 text-teal-800 hover:bg-teal-100",
  Late: "bg-amber-50 text-amber-900 hover:bg-amber-100",
  "Half day": "bg-orange-50 text-orange-900 hover:bg-orange-100",
  "Early exit": "bg-pink-50 text-pink-800 hover:bg-pink-100",
};

/*
 * A kind that is not one of these reads as a meeting rather than as the first row of the list.
 *
 * The fallback used to be `SCHEDULE_KINDS[0]`, which was meetings because meetings were written
 * first. Holidays are written first now, so an unrecognised entry would have been drawn - and
 * labelled - as a public holiday, which is a worse thing to be wrong about than a meeting.
 */
const MEETING_KIND = SCHEDULE_KINDS.find((entry) => entry.value === "meeting");

export const scheduleKind = (kind) => SCHEDULE_KINDS.find((entry) => entry.value === kind) || MEETING_KIND;


/**
 * The classes a chip is drawn with: its kind's colour, except attendance, which is coloured by the
 * day's status - an Absent and a Late are both "attendance" and mean quite different things.
 */
export function scheduleEntryCell(entry) {
  if (entry?.kind === "attendance") return ATTENDANCE_CELLS[entry.title] || scheduleKind("attendance").cell;
  if (entry?.kind === "teamAttendance") return ATTENDANCE_CELLS[entry.meta?.status] || scheduleKind("teamAttendance").cell;
  // A month day's shoots, counted: the shoots' own colour.
  if (entry?.kind === "shootCount") return scheduleKind("shoot").cell;
  return scheduleKind(entry?.kind).cell;
}

/**
 * Which day an entry belongs on.
 *
 * Two kinds of "when", and the difference is the whole reason this function exists. A meeting is a
 * *moment* - a real instant, which the browser places on its own local date. A shoot and a main
 * event are a *day*: the studio wrote a date down, and the server sends it as plain text precisely
 * so it cannot be shifted by a timezone on the way here.
 *
 * Reading `day` first is what keeps a 1 September shoot on 1 September for a viewer west of
 * Greenwich, where the same date as an instant would land on 31 August.
 */
export function scheduleEntryDay(entry) {
  return entry?.day || dayKey(entry?.startAt);
}

/** Earliest first within a day: timed entries in clock order, then the day-long ones. */
export function compareScheduleEntries(left, right) {
  const leftAt = left?.startAt ? new Date(left.startAt).getTime() : Number.POSITIVE_INFINITY;
  const rightAt = right?.startAt ? new Date(right.startAt).getTime() : Number.POSITIVE_INFINITY;
  if (leftAt !== rightAt) return leftAt - rightAt;
  // Whole-day entries have no clock to sort by, so they read in the legend's order and then by
  // their own reference - a stable order, rather than whatever the two queries happened to return.
  const kinds = SCHEDULE_KINDS.map((kind) => kind.value);
  const byKind = kinds.indexOf(left?.kind) - kinds.indexOf(right?.kind);
  return byKind || String(left?.reference || "").localeCompare(String(right?.reference || ""));
}

/**
 * The entries of a window, filed by day and in running order inside each.
 *
 * `kinds` is the set currently switched on in the legend; an entry of a kind that is off is left
 * out entirely rather than drawn faintly, because a calendar is read by what is on it.
 */
export function scheduleByDay(entries = [], kinds = null) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (kinds && !kinds.has(entry?.kind)) continue;
    const key = scheduleEntryDay(entry);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  for (const list of map.values()) list.sort(compareScheduleEntries);
  return map;
}

/*
 * ── The month itself ──────────────────────────────────────────────────────────────────────────
 */

/** The column headings, Monday first — which is the week the studio's own week starts on. */
export const SCHEDULE_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weeks of a month, as a flat list of days.
 *
 * Always whole weeks, so the grid is a rectangle: the run-up from the previous month and the
 * tail into the next are included and marked `outside`, which is what lets a booking on the
 * 1st of a month that falls on a Thursday still be seen in its proper column.
 *
 * Here rather than in the page because two screens draw a month now — the studio calendar and
 * Settings → Holidays — and a second copy of this is how one of them ends up putting a Monday in
 * the Sunday column for the one week of the year the two disagree about.
 */
export function monthGrid(monthStart) {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();

  // getDay() is Sunday-based; shifted so Monday is 0 to match the column headings.
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const first = new Date(year, month, 1 - leading);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (unused, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    return { date, key: dayKey(date), outside: date.getMonth() !== month };
  });
}

/**
 * A calendar's shoots as the Shoot Board's shoot window reads them (`ShootRunDialog`): the project
 * they belong to, and each shoot as a card - name, Shoot ID, Main Event, times, venue and who is
 * going. The shoots are one project's, so the first names it.
 */
export function shootRunOf(entries = []) {
  const first = entries[0] || {};
  const label = String(first.meta?.projectName || first.subject || "").trim();
  return {
    project: { label, eventId: String(first.subject || "").trim() },
    run: {
      shoots: entries.map((entry) => ({
        id: entry.id,
        shoot: entry.title,
        shootId: entry.reference,
        /*
         * The production record's id, which is what the Production panel opens on; null where
         * production has not been raised, and then the card has nothing to open.
         *
         * It used to be set to the calendar *entry's* id - "shoot:7" - so that the dialog's
         * `onOpen && shoot.productionShootId` guard would be truthy and the card would open the
         * Projects board. A field holding something other than what its name says is a trap for
         * whoever reads it next; the dialog asks `canOpen` now, so the stand-in is gone.
         */
        productionShootId: entry.productionShootId ?? null,
        // The shoot's own record and the board it is on now, which the card's ⋮ opens it by.
        shootRecordId: entry.meta?.shootRecordId || null,
        stage: entry.meta?.stage || null,
        boards: entry.meta?.boards || [],
        hasPreProduction: Boolean(entry.meta?.hasPreProduction),
        isMainEvent: Boolean(entry.meta?.isMainEvent),
        clientName: label,
        eventId: entry.subject,
        startTime: entry.meta?.eventStartTime || null,
        endTime: entry.meta?.eventEndTime || null,
        shootPlace: entry.location,
        shootDate: entry.day,
        /*
         * Who is going, as the Shoot Board's card words it: the Production Coordinator, the
         * Production Team and each service with its person. The card has always drawn them; the
         * calendar simply never sent them, so a shoot opened from the diary said where and when it
         * was and nothing about who was on it.
         */
        coordinator: entry.meta?.coordinator || null,
        team: entry.meta?.team || [],
        crew: entry.meta?.crew || [],
      })),
    },
  };
}

/** "18:30" → "6:30 pm"; "" for anything that is not a time of day. */
export function blockClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "am" : "pm"}`;
}

/**
 * The lead line of an entry in a day cell: the clock time for a meeting, the reference for
 * anything booked by the day.
 *
 * A shoot has no time to show - it has a date and a length - so its own id is the thing worth
 * putting first. "DBS-SID-DD-ERD-000003" is how the studio names that day's work.
 */
export function scheduleEntryLead(entry) {
  if (entry?.startAt) return formatMeetingTime(entry.startAt);
  // A blocked period leads with the time it starts, written as the 12-hour clock the rest read in.
  if (entry?.kind === "block") return blockClock(entry.meta?.startTime);
  /*
   * A booking kept as a day can still state an hour.
   *
   * An interview is set for 10:30 am on a date, in two text columns with no instant behind them -
   * so there is no `startAt` to read a clock off, and the hour is sent as the text the register
   * shows. It is what the day is called by, exactly as a meeting's time is, so it leads the chip.
   */
  if (entry?.meta?.clock) return String(entry.meta.clock).trim();
  return String(entry?.reference || "").trim();
}

/*
 * ── A week, or a day ──────────────────────────────────────────────────────────────────────────
 *
 * The calendar's other two periods, as the same cells the month is made of - so a day is drawn,
 * opened and booked on exactly as it is in the month. A week runs Monday to Sunday, as the month's
 * rows do.
 */

export const SCHEDULE_PERIODS = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const dayAt = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** The Monday of the week holding `date`. */
export function weekStartOf(date) {
  const day = dayAt(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** The cells of a period: the month's weeks, the week's seven days, or the one day. */
export function periodCells(period, anchor) {
  if (period === "week") {
    const monday = weekStartOf(anchor);
    return Array.from({ length: 7 }, (unused, index) => {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
      return { date, key: dayKey(date), outside: false };
    });
  }
  if (period === "day") {
    const date = dayAt(anchor);
    return [{ date, key: dayKey(date), outside: false }];
  }
  return monthGrid(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
}

/** One step back (-1) or on (+1): a month, a week or a day. */
export function stepPeriod(period, anchor, direction) {
  if (period === "week") return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + (7 * direction));
  if (period === "day") return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

/** The heading over a period: "October 2026", "12 - 18 Oct 2026", "Wednesday, 14 October 2026". */
export function periodLabel(period, anchor) {
  if (period === "week") {
    const monday = weekStartOf(anchor);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const short = { day: "numeric", month: "short" };
    return `${new Intl.DateTimeFormat("en-GB", short).format(monday)} - ${new Intl.DateTimeFormat("en-GB", { ...short, year: "numeric" }).format(sunday)}`;
  }
  if (period === "day") return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(anchor);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(anchor);
}

/**
 * A month day's shoots as one chip - "Shoots · 6" - in place of a chip per shoot, the shoots kept on
 * it (`meta.shoots`) for the pop-up it opens: the projects, then a project's shoots, then a shoot's
 * form. Placed where the first shoot was, so the day keeps its order. Week and Day keep each shoot.
 */
export function monthShootCounts(entries = []) {
  const shoots = entries.filter((entry) => entry?.kind === "shoot");
  if (!shoots.length) return entries;
  const day = shoots[0].day || "";
  const counted = { id: `shoots:${day}`, kind: "shootCount", title: `Shoots · ${shoots.length}`, reference: "", day, location: "", meta: { shoots } };
  const first = entries.indexOf(shoots[0]);
  return [...entries.slice(0, first).filter((entry) => entry?.kind !== "shoot"), counted, ...entries.slice(first).filter((entry) => entry?.kind !== "shoot")];
}

/**
 * A day's shoots by project, for the pop-up's first list: each project with its name, event ID and
 * shoots in the order they happen, projects in the order their first shoot does.
 */
export function shootsByProject(shoots = []) {
  const projects = new Map();
  for (const shoot of shoots) {
    const key = String(shoot?.subject || shoot?.meta?.projectName || shoot?.id);
    if (!projects.has(key)) projects.set(key, { key, eventId: String(shoot?.subject || ""), name: String(shoot?.meta?.projectName || shoot?.subject || "Project"), shoots: [] });
    projects.get(key).shoots.push(shoot);
  }
  return [...projects.values()];
}
