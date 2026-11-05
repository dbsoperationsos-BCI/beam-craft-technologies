const prisma = require("../../../config/db");
const { listAllMeetings } = require("../../sales/crm-meetings/service");
const { projectAccessWhere } = require("../../../services/projectScope");
/*
 * A holiday is a day, and `attendance_holiday.holiday_date` is a `@db.Date`, so the window it is
 * queried with has to be a day too. `calendarDay` is attendance's, because attendance is where the
 * only correct reading of these columns is written — see `hrm/attendance/attendanceRules.js`.
 */
const { calendarDay } = require("../../hrm/attendance/attendanceRules");
/*
 * An interview is set for a day and an hour that are kept as **text** - `interview_date` and
 * `interview_time` are VarChar columns, filled by hand, by a CSV or by a linked Google Sheet - so
 * reading one back is the CRM's job rather than the database's. `toIsoDay` is the one reader of a
 * stored day in this application and `toClockTime` the one reader of a stored hour; the interview
 * register itself writes both columns through the same pair (`hrm/interview/service.js`), which is
 * what stops the calendar having a second opinion about which day a candidate is coming in on.
 */
const { toIsoDay, toClockTime } = require("../../sales/crm-leads/leadDates");
/*
 * The calendar's own reading of who was working, not the HRM register.
 *
 * `hrm/attendance` is the studio's attendance system - login, leave, approvals - and answers per
 * employee. This asks the calendar's question instead: everybody's days across a range, keyed by
 * login, in a couple of queries. See `schedule/attendance/service.js`.
 */

/**
 * The studio's calendar: everything that is booked to happen, from every module that books
 * something.
 *
 * Its own module rather than a branch of Meetings, for the same reason the contact directory is
 * its own: a shoot and a meeting are both things in the diary, and a calendar that could only see
 * one module's would be the meetings list with a grid drawn round it.
 *
 * Nothing is stored. An entry is not a record anybody creates - it is a record that happens to
 * carry a date - so this reads each module's own rows live and a shoot moved in Project Management
 * has moved here.
 *
 * ── Two kinds of when ─────────────────────────────────────────────────────────────────────────
 *
 * A meeting is a **moment**: it has a real start and end instant, booked in somebody's timezone,
 * and the browser decides which local day that falls on - which is what `dayKey` on the client
 * already does for it.
 *
 * A shoot and a project's main event are a **day**: the studio wrote down a date, and how long the
 * shoot runs is a duration rather than a clock time. Those carry `day` as a plain `YYYY-MM-DD`
 * string, taken from the stored date without going near a timezone. Handing the browser
 * `2026-09-01T00:00:00Z` instead would put a 1 September shoot on 31 August for anybody west of
 * Greenwich, which is exactly the fault `dayKey`'s own comment describes.
 *
 * So every entry carries `day` **or** `startAt`, and the client reads `day || dayKey(startAt)`.
 */

/** A stored DateTime read as the calendar day it was written as, never shifted by a timezone. */
const dayOf = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
};

const text = (value) => String(value ?? "").trim();

/** Where a shoot happens, as one line: the place, then the district and state. */
function shootLocation(shoot) {
  const region = [text(shoot.district), text(shoot.state)].filter(Boolean).join(", ");
  return [text(shoot.shootPlace), region].filter(Boolean).join(" — ");
}

/**
 * A stored interview time as `HH:MM` on the 24-hour clock, or "" where the cell holds no time.
 *
 * Only ever sorted by, never shown - the register's own "10:30 am" is what a reader wants and what
 * a sort cannot use, because "03:00 pm" files above "10:00 am" on the alphabet. Built from
 * `toClockTime`, which is what the register normalises the column with on the way in, so the two
 * cannot read the same cell differently.
 *
 * Deliberately not `Date` and `Intl`: a clock time carries no day and no zone, and putting one
 * through a zone-aware formatter would shift it by the offset.
 */
function clock24(value) {
  const match = /^(\d{2}):(\d{2}) (am|pm)$/.exec(toClockTime(value));
  if (!match) return "";
  const hours = (Number(match[1]) % 12) + (match[3] === "pm" ? 12 : 0);
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/**
 * Whose entry it is.
 *
 * A project names several people - who sold it, who is running it, who is coordinating the
 * pre-production - and the calendar shows the one who owns the day. The project manager where
 * there is one, then the coordinator, and the CRM who sold it as the last resort: a project that
 * has not been staffed yet still belongs to somebody.
 */
const projectOwner = (project) => text(project?.projectManager) || text(project?.preProductionCoordinator) || text(project?.crmName);



/**
 * The three things the studio schedules, and who may see each.
 *
 * `module` / `feature` is the permission the owning module's own API enforces, checked again here:
 * being able to open the calendar is not being able to read Project Management, so a source the
 * viewer cannot open elsewhere is never queried. `anyOf` is a disjunction - the shoot boards are
 * read by whoever holds any one of the production permissions, exactly as the boards themselves
 * are.
 */
const SOURCES = [
  {
    /*
     * ── The studio's declared holidays ────────────────────────────────────────────────────────
     *
     * `always`, and for a different reason from anything else that could be: a holiday is not
     * somebody's record that has to be narrowed to the right viewer - it is the same fact for
     * every person in the studio. The office is shut on the 20th whoever is asking, so there is no
     * scope to apply and nothing a permission here would protect. Gating it would only mean an
     * employee planning their week could not see that the studio is closed.
     *
     * Declared in Settings -> Holidays, behind ADMIN / System Settings, and read here rather than
     * through an endpoint: the list is one table, and a calendar that asked the Settings API for it
     * would need everybody to hold an administrator's permission to see a public holiday.
     *
     * A day, never an instant. `holiday_date` is a `@db.Date`, so `dayOf` slices it as written -
     * handing the browser an instant would put Diwali on the 19th for anybody west of Greenwich.
     */
    key: "holiday",
    always: true,
    async load({ from, to }) {
      const holidayDate = {};
      if (from) holidayDate.gte = calendarDay(from);
      if (to) holidayDate.lte = calendarDay(to);
      const holidays = await prisma.attendanceHoliday.findMany({
        where: Object.keys(holidayDate).length ? { holidayDate } : {},
        orderBy: { holidayDate: "asc" },
      });
      return holidays.map((holiday) => ({
        id: `holiday:${holiday.id}`,
        kind: "holiday",
        title: text(holiday.name) || "Holiday",
        /*
         * No reference, no subject, no owner. A holiday belongs to nobody and refers to nothing:
         * the name *is* the whole entry, and the details panel draws only the fields that have a
         * value, so it reads as the day and what it is called rather than as a booking with most
         * of its fields empty.
         */
        reference: "",
        day: dayOf(holiday.holidayDate),
        startAt: null,
        endAt: null,
        location: "",
        owner: "",
        subject: "",
        meta: {},
      }));
    },
  },
  {
    key: "meeting",
    module: "SALES",
    feature: "CRM Leads",
    async load({ from, to, viewer, permissions }) {
      // Through the meetings module's own reader rather than a query of this module's: the
      // calendar must not have a second opinion about what a meeting is or which lead it is with -
      // nor about whose meetings they are, which is why the viewer travels with the window.
      const meetings = await listAllMeetings({ from, to, includeCancelled: false, reader: { userId: viewer?.userId, permissions } });
      return meetings.map((meeting) => ({
        id: `meeting:${meeting.id}`,
        kind: "meeting",
        title: text(meeting.title) || "Untitled meeting",
        reference: text(meeting.enquiryId),
        // A moment, not a day: the browser places it on its own local date.
        day: null,
        startAt: meeting.startAt || null,
        endAt: meeting.endAt || null,
        location: "",
        // The CRM whose lead it is; the organiser's login stands in where the lead is gone.
        owner: text(meeting.lead?.crm) || text(meeting.organizerEmail),
        subject: text(meeting.lead?.name) || text(meeting.enquiryId),
        meta: { meetLink: text(meeting.meetLink) },
      }));
    },
  },
  {
    key: "shoot",
    anyOf: [
      { module: "PROJECT", feature: "Projects" },
      { module: "PROJECT", feature: "Pre Production" },
      { module: "PROJECT", feature: "Production" },
    ],
    async load({ from, to, viewer, permissions }) {
      const dateCreated = {};
      if (from) dateCreated.gte = from;
      if (to) dateCreated.lte = to;
      // A shoot belongs to its project, so the calendar shows the shoots of the projects this
      // viewer may read - the same rows the project boards would give them, on a different page.
      const shoots = await prisma.projectShoot.findMany({
        where: { deletedAt: null, project: await projectAccessWhere({ userId: viewer?.userId, permissions }), ...(Object.keys(dateCreated).length ? { dateCreated } : {}) },
        include: {
          project: {
            select: {
              eventId: true, whatsappGroupName: true, whatsappGroupNameId: true,
              projectManager: true, preProductionCoordinator: true, crmName: true, vertical: true,
            },
          },
        },
        orderBy: [{ dateCreated: "asc" }],
      });
      return shoots.map((shoot) => ({
        id: `shoot:${shoot.id}`,
        kind: "shoot",
        title: text(shoot.shoot) || "Shoot",
        reference: text(shoot.shootId),
        day: dayOf(shoot.dateCreated),
        // A shoot has an event start and end only when the studio has fixed them; otherwise its
        // length is a duration, which the client formats from the timings below.
        startAt: null,
        endAt: null,
        location: shootLocation(shoot),
        owner: projectOwner(shoot.project),
        subject: text(shoot.project?.eventId),
        meta: {
          // The raw timing fields, so the client can label them with `formatSessionTiming` - the
          // one place that knows "2h 0m" and "10-12 Hours (Full)".
          sessionTiming: text(shoot.sessionTiming),
          sessionTimings: shoot.sessionTimings || null,
          sessionDurationHours: shoot.sessionDurationHours ?? null,
          sessionDurationMinutes: shoot.sessionDurationMinutes ?? null,
          eventStartTime: text(shoot.eventStartTime),
          eventEndTime: text(shoot.eventEndTime),
          isMainEvent: Boolean(shoot.isMainEvent),
          shootType: text(shoot.shootType),
        },
      }));
    },
  },
  {
    key: "project",
    anyOf: [
      { module: "SALES", feature: "Sales Manager" },
      { module: "PROJECT", feature: "Projects" },
    ],
    async load({ from, to, viewer, permissions }) {
      const mainEventDate = { not: null };
      if (from) mainEventDate.gte = from;
      if (to) mainEventDate.lte = to;
      const projects = await prisma.salesProject.findMany({
        where: { deletedAt: null, mainEventDate, AND: [await projectAccessWhere({ userId: viewer?.userId, permissions })] },
        select: {
          id: true, eventId: true, mainEventDate: true, whatsappGroupName: true, whatsappGroupNameId: true,
          projectManager: true, preProductionCoordinator: true, crmName: true, vertical: true,
        },
        orderBy: [{ mainEventDate: "asc" }],
      });
      // The client's name lives on the reserved WhatsApp group name rather than on the project,
      // which is why `projectClientNames` exists; the same fallback is applied here.
      const names = await clientNamesFor(projects);
      return projects.map((project) => ({
        id: `project:${project.id}`,
        kind: "project",
        title: names.get(project.whatsappGroupNameId) || text(project.whatsappGroupName) || "Main event",
        reference: text(project.eventId),
        day: dayOf(project.mainEventDate),
        startAt: null,
        endAt: null,
        location: "",
        owner: projectOwner(project),
        subject: text(project.eventId),
        meta: { mainEvent: true },
      }));
    },
  },
  {
    /*
     * ── The interviews the studio has scheduled ───────────────────────────────────────────────
     *
     * A candidate coming in on Thursday is as much the studio's day as a shoot is, and it was
     * nowhere: HR kept it in the Interview register and everybody else found out when somebody
     * walked through the door. It is a booking like the rest, so it belongs in the one diary.
     *
     * `HRM / Interview` and nothing finer, because that is the whole of the guard the register
     * itself mounts (`hrm/interview/routes.js` - one `requireModule` over every route) and a
     * screen may not be given a finer permission than the endpoint it reads. The register is not
     * scoped by branch or by interviewer either, so neither is this: what the calendar draws is
     * exactly the rows `/api/hrm/interview/candidates` would already hand the same viewer.
     *
     * **A day, never an instant.** `interview_date` and `interview_time` are text columns filled
     * by hand, by a CSV or by a linked sheet, so there is no instant behind them to send - the
     * hour is a clock time with no zone attached, and handing the browser one would move a
     * 10:30 am interview into the previous evening for anybody far enough west. The day is read
     * with `toIsoDay` and the hour travels in `meta` as the text the register shows, which is what
     * the chip leads with in place of the clock a meeting has.
     */
    key: "interview",
    module: "HRM",
    feature: "Interview",
    async load({ from, to }) {
      /*
       * Narrowed in JavaScript rather than in SQL, and that is the honest way round here.
       *
       * `interview_date` is text, so a `gte` / `lte` on the column would be an *alphabetical*
       * comparison: it happens to be right for the ISO days the register writes and quietly wrong
       * for a `09/09/2026` that reached the table before the column was normalised, which would be
       * dropped from every window it actually falls in. `toIsoDay` reads both shapes the same way
       * the register does, and a candidate whose date is not a date at all has no cell to be drawn
       * in and is left off rather than filed under a day nobody chose.
       *
       * Only the columns a chip and its details panel show, and only the rows that name a date -
       * a register is mostly candidates nobody has scheduled yet.
       */
      const candidates = await prisma.hrmInterviewCandidate.findMany({
        where: { deletedAt: null, interviewDate: { not: null } },
        select: {
          id: true, candidateCode: true, name: true, position: true, department: true, branch: true,
          status: true, interviewer: true, interviewDate: true, interviewTime: true, interviewMode: true,
          meetLink: true, phone: true, email: true,
        },
        orderBy: [{ interviewDate: "asc" }],
      });
      const fromDay = dayOf(from);
      const toDay = dayOf(to);
      const entries = [];
      for (const candidate of candidates) {
        const day = toIsoDay(candidate.interviewDate);
        if (!day) continue;
        if (fromDay && day < fromDay) continue;
        if (toDay && day > toDay) continue;
        entries.push({
          id: `interview:${candidate.id}`,
          kind: "interview",
          // The candidate. An interview is read by who is coming in, the way a meeting is read by
          // who it is with - the role they applied for is the subject beside it.
          title: text(candidate.name) || "Candidate",
          reference: text(candidate.candidateCode),
          day,
          startAt: null,
          endAt: null,
          // How and where they are being seen: "Google Meet", "In Person — Dum Dum".
          location: [text(candidate.interviewMode), text(candidate.branch)].filter(Boolean).join(" — "),
          owner: text(candidate.interviewer),
          subject: text(candidate.position),
          meta: {
            // The hour as the register shows it, and the same hour as something that can be sorted.
            clock: toClockTime(candidate.interviewTime) || text(candidate.interviewTime),
            clock24: clock24(candidate.interviewTime),
            mode: text(candidate.interviewMode),
            meetLink: text(candidate.meetLink),
            status: text(candidate.status),
            department: text(candidate.department),
            branch: text(candidate.branch),
            phone: text(candidate.phone),
            email: text(candidate.email),
          },
        });
      }
      return entries;
    },
  },
];

async function clientNamesFor(projects) {
  const ids = [...new Set(projects.map((project) => project.whatsappGroupNameId).filter(Boolean))];
  if (!ids.length) return new Map();
  const groups = await prisma.salesWhatsappGroupName.findMany({ where: { id: { in: ids } }, select: { id: true, clientName: true } });
  return new Map(groups.map((group) => [group.id, text(group.clientName)]));
}

/**
 * Everything booked in a window, from the sources this viewer may read.
 *
 * `can` is an async predicate over `{ module, feature }` - the caller's permission check, passed
 * in rather than imported so this stays a reader and the controller stays the thing that knows
 * about a request.
 *
 * One source failing does not empty the calendar: the others are still returned and the failure is
 * named in `unavailable`, so the page can say "shoots could not be loaded" rather than quietly
 * showing a day with nothing on it. A calendar that silently drops a shoot is worse than one that
 * admits it could not read them.
 */
async function listSchedule({ can, viewer = null, from = null, to = null } = {}) {
  const permitted = [];
  for (const source of SOURCES) {
    /*
     * A source everybody sees the whole of.
     *
     * Holidays are the one: the studio being shut is the same fact for every person in it, so
     * there is no scope to narrow and no permission that would be protecting anything. Every other
     * source names the permission its own module enforces, and a source added here without one is
     * a way around that module's guard - which is what the calendar test pins.
     */
    if (source.always) { permitted.push(source); continue; }
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    const checks = await Promise.all(required.map((permission) => can(permission)));
    if (checks.some(Boolean)) permitted.push(source);
  }

  /*
   * Each source is handed the permissions that let it in, so the ones that reach projects can scope
   * by what this viewer actually holds rather than by the project register's own list - a person on
   * the calendar for Production has no reason to hold Sales Manager.
   */
  const results = await Promise.allSettled(permitted.map((source) => source.load({
    from, to, viewer, can,
    permissions: source.anyOf || [{ module: source.module, feature: source.feature }],
  })));
  const entries = [];
  const unavailable = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") entries.push(...result.value);
    else {
      console.error(`Unable to load ${permitted[index].key} entries for the calendar:`, result.reason?.message);
      unavailable.push(permitted[index].key);
    }
  });

  return { entries, kinds: permitted.map((source) => source.key), unavailable };
}

module.exports = { listSchedule, SOURCES };
