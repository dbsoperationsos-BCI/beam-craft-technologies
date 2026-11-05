const prisma = require("../../../config/db");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { listAllMeetings } = require("../../sales/crm-meetings/service");
const { projectAccessWhere } = require("../../../services/projectScope");
const { PRODUCTION_TEAM_SELECT, productionTeam } = require("../../../services/productionTeam");
/*
 * A holiday is a day, and `attendance_holiday.holiday_date` is a `@db.Date`, so the window it is
 * queried with has to be a day too. `calendarDay` is attendance's, because attendance is where the
 * only correct reading of these columns is written — see `hrm/attendance/attendanceRules.js`.
 */
const { calendarDay, eachDateInRange, localIsoDate } = require("../../hrm/attendance/attendanceRules");
const hrmAttendance = require("../../hrm/attendance/service");
const { loadHolidays, scopeOf, appliesToBranch, branchForUser, scopeLabel } = require("../../../services/holidayCalendar");
const calendarBlocks = require("../blocks/service");
// Whose shoot it is, answered once: the project's roles, the coordinator, the team and the crew.
const { boardWhere } = require("../../project-management/shoot-board/read");

/**
 * The shoots a production team member is on **themselves**, for the calendar: its Production
 * Coordinator, its Production Team or a service's crew - or its project's Production Manager or
 * Project Manager, who run its shoots. Not the project's other roles (a Creative Manager is not on
 * the shoot day) and not the shoots of the people reporting to them, which the Shoot Board's
 * `boardWhere` does add: the calendar is the person's own diary. Somebody whose `boardWhere` is the
 * whole board (a Super Admin, Show All Projects) still sees every shoot. Null - no shoots - for a
 * login with no employee behind it.
 */
async function ownShootsWhere(userId) {
  const board = await boardWhere(userId);
  if (!board || !Object.keys(board).length) return board;
  const account = await prisma.user.findUnique({ where: { id: Number(userId) || 0 }, select: { linkedEmployeeId: true } });
  const me = account?.linkedEmployeeId || null;
  if (!me) return null;
  return {
    OR: [
      { project: { productionManagerEmployeeId: me } },
      { project: { projectManagerEmployeeId: me } },
      { production: { productionCoordinatorEmployeeId: me } },
      { production: { teamMembers: { some: { employeeId: me } } } },
      { production: { serviceCrew: { some: { employeeId: me } } } },
    ],
  };
}
const { boardsForProjects } = require("../../../services/projectBoards");

/** The day statuses the calendar shows a person - every one that was not simply on time. */
const ATTENDANCE_SHOWN = ["Absent", "On leave", "Comp off", "Late", "Half day", "Early exit"];
/** At most this many days of attendance at once - a quarter, more than any calendar view spans. */
const ATTENDANCE_MAX_DAYS = 92;
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
 * A shoot is a **day**: the studio wrote down a date, and how long the
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
 * The things the studio schedules or holds, and who may see each.
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
    async load({ from, to, viewer }) {
      /*
       * The viewer's own holidays: the studio's, and their branch's - never a holiday declared for
       * another branch alone, which is that branch's day off and not this person's. Which branch is
       * theirs is `branchForUser`: their employee record's, else their login's, else none - and a
       * person with none sees the studio-wide holidays only. Still `always` - no permission gates
       * it, since nothing here is anybody's record - but no longer the whole list for everybody.
       */
      const [holidays, branchId] = await Promise.all([
        loadHolidays({ from, to }),
        branchForUser(viewer?.userId),
      ]);
      return holidays.filter((holiday) => appliesToBranch(scopeOf(holiday), branchId)).map((holiday) => ({
        id: `holiday:${holiday.id}`,
        kind: "holiday",
        title: text(holiday.name) || "Holiday",
        /*
         * Whose it is stands where a booking's reference does, so the cell reads "Diwali · All
         * branches" or "Pongal · Madurai": a holiday belongs to nobody and refers to nothing, and
         * the one thing worth saying beside its name is which branches are shut.
         */
        reference: scopeLabel(holiday),
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
    /*
     * ── The periods a branch's hours are blocked ──────────────────────────────────────────────
     *
     * Calendar → a day's ⋮ → Block Period. Read through the blocks module, so the branches a viewer
     * sees blocked are the ones `SALES / Block Period` reaches for them - the same answer the
     * blocks API gives. A day and two clock times kept as text, never an instant.
     */
    key: "block",
    module: "SALES",
    feature: "Block Period",
    async load({ from, to, viewer }) {
      const blocks = await calendarBlocks.listBlocks({
        userId: viewer?.userId,
        from: from ? dayOf(calendarDay(from)) : null,
        to: to ? dayOf(calendarDay(to)) : null,
      });
      return blocks.map((block) => ({
        branchId: block.branchId,
        id: `block:${block.id}`,
        kind: "block",
        title: block.reason,
        reference: "",
        day: block.date,
        startAt: null,
        endAt: null,
        location: "",
        owner: block.createdBy,
        subject: "",
        meta: { blockId: block.id, startTime: block.startTime, endTime: block.endTime },
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
      // The branch is the lead's: read once for every enquiry on the page.
      const enquiryIds = [...new Set(meetings.map((meeting) => meeting.enquiryId).filter(Boolean))];
      const leads = enquiryIds.length ? await prisma.salesCrmLead.findMany({ where: { enquiryId: { in: enquiryIds } }, select: { enquiryId: true, branchId: true } }) : [];
      const leadBranch = new Map(leads.map((lead) => [lead.enquiryId, lead.branchId]));
      return meetings.map((meeting) => ({
        branchId: leadBranch.get(meeting.enquiryId) ?? null,
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
    /*
     * ── The studio's shoots ───────────────────────────────────────────────────────────────────
     *
     * **Who sees which shoots, by what they hold.** The studio's rule, in three readings:
     *
     *   - **Projects, Pre Production or Bookings & Converted** - the permissions that are about the
     *     studio's work as a whole - see every shoot. Where the cameras are going on Saturday is
     *     the question those screens exist to answer.
     *   - **Production alone** sees the shoots they are **named on**, and no others: a shooter's
     *     calendar is their roster, and the rest of the studio's diary is not theirs to read.
     *   - **Neither** sees no shoots at all. The calendar still carries their own things - the
     *     holidays, their attendance, their meetings - but somebody with no part in a shoot has no
     *     reason to be told about it.
     *
     * `always` was the previous answer, on the grounds that a driver or somebody in accounts should
     * be able to see that a team was out. The studio's own decision is the one above.
     *
     * "Named on" is the person's own shoots (`ownShootsWhere`): its coordinator, its team, a
     * service's crew, or its project's Production Manager or Project Manager - not the project's
     * other roles, and not their reports' shoots, which the Shoot Board's wider `boardWhere` adds.
     * The calendar is their own diary.
     *
     * **Seeing is not opening.** The window a shoot opens into is still the owning module's, and
     * answers to its own permission; the calendar sends what decides that (`productionShootId`,
     * and the project's Event ID) and the screen offers nothing it would be refused.
     */
    key: "shoot",
    anyOf: [
      { module: "PROJECT", feature: "Projects" },
      { module: "PROJECT", feature: "Pre Production" },
      { module: "SALES", feature: "Sales Manager" },
      { module: "PROJECT", feature: "Production" },
    ],
    async load({ from, to, viewer, can }) {
      /*
       * The wide three first: holding any of them is the whole board, with no narrowing. Only a
       * viewer who holds none of them - Production and nothing else - is narrowed to their own, and
       * `boardWhere` answering `null` (a login with no employee behind it) means no shoots rather
       * than every shoot.
       */
      const wide = await Promise.all([
        can({ module: "PROJECT", feature: "Projects" }),
        can({ module: "PROJECT", feature: "Pre Production" }),
        can({ module: "SALES", feature: "Sales Manager" }),
      ]);
      let named = {};
      if (!wide.some(Boolean)) {
        named = await ownShootsWhere(viewer?.userId);
        if (!named) return [];
      }
      const dateCreated = {};
      if (from) dateCreated.gte = from;
      if (to) dateCreated.lte = to;
      const shoots = await prisma.projectShoot.findMany({
        // Neither a deleted shoot nor one of a deleted project, and - for a Production-only viewer -
        // only the shoots they are named on (`named`, which is `{}` for the wider permissions).
        where: { deletedAt: null, project: { deletedAt: null }, ...named, ...(Object.keys(dateCreated).length ? { dateCreated } : {}) },
        include: {
          project: {
            select: {
              eventId: true, whatsappGroupName: true, whatsappGroupNameId: true,
              projectManager: true, preProductionCoordinator: true, crmName: true, vertical: true, branchId: true,
              projectStatus: true, preProductionStatus: true,
            },
          },
          // Which board the shoot is being worked on now - see `shootStage`.
          preProduction: { select: { id: true } },
          /*
           * The plan's own date, and who is going. The window this opens into is the Shoot Board's
           * card, which says the Production Coordinator, the Production Team and each service's
           * people - and said none of them here, because the calendar never read them.
           * `PRODUCTION_TEAM_SELECT` is the Shoot Board's own, so the two cannot come to differ.
           */
          production: { select: { id: true, planSubmittedAt: true, ...PRODUCTION_TEAM_SELECT({ select: { employeeName: true } }) } },
        },
        orderBy: [{ dateCreated: SHOOT_DATE_ASC }],
      });
      // The boards each shoot's project is on, for the card's ⋮ Navigate to - the rule every board's own uses.
      const boardsOf = await boardsForProjects(shoots.map((shoot) => shoot.projectId));
      return shoots.map((shoot) => ({
        branchId: shoot.project?.branchId ?? null,
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
        // What the Production panel opens on, for a viewer who holds `PROJECT / Production`; null
        // where production has not been raised, and then there is nothing to open.
        productionShootId: shoot.production?.id ?? null,
        subject: text(shoot.project?.eventId),
        meta: {
          // The raw timing fields, so the client can label them with `formatSessionTiming` - the
          // one place that knows "2h 0m" and "8-10 Hours (Full)".
          sessionTiming: text(shoot.sessionTiming),
          sessionTimings: shoot.sessionTimings || null,
          sessionDurationHours: shoot.sessionDurationHours ?? null,
          sessionDurationMinutes: shoot.sessionDurationMinutes ?? null,
          eventStartTime: text(shoot.eventStartTime),
          eventEndTime: text(shoot.eventEndTime),
          isMainEvent: Boolean(shoot.isMainEvent),
          shootType: text(shoot.shootType),
          // The project's name - its WhatsApp group name, as every staff screen names it - for the
          // Shoot Board's shoot window the calendar opens.
          projectName: text(shoot.project?.whatsappGroupName),
          // The shoot's own id, which both boards open a shoot by, and the board it is on now.
          shootRecordId: shoot.id,
          stage: shootStage(shoot),
          boards: boardsOf.get(shoot.projectId) || [],
          // Whether this shoot has its own Pre Production form - the card's ⋮ Update offers it then.
          hasPreProduction: Boolean(shoot.preProduction),
          // Who is going, as the Shoot Board words it. Null where no production has been raised.
          ...productionTeam(shoot.production),
        },
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
          id: true, candidateCode: true, name: true, position: true, department: true, branch: true, branchId: true,
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
          branchId: candidate.branchId ?? null,
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
  {
    /*
     * The signed-in person's own attendance, as the HRM register reads it: every day that was not
     * simply on time - Absent, On leave, Comp off, Late, Half day, Early exit - as a chip on that day.
     *
     * Answers to `HRM / Employee Attendance`, the whole of the guard on the person's own Attendance
     * page, so a role the studio has turned attendance off for does not get it back through the
     * calendar. Never anybody else's: the employee is the viewer's own linked one, read from the
     * signed-in user and nothing in the request. A login with no employee behind it has no register,
     * and so no days here.
     *
     * Read from `attendanceDays`, the reader the person's own Attendance page, the register and payroll
     * all agree through, so the calendar cannot have a second opinion about how a day went. Up to
     * today only - a day still to come has no attendance - and at most a quarter at a time.
     */
    key: "attendance",
    module: "HRM",
    feature: "Employee Attendance",
    async load({ from, to, viewer }) {
      if (!viewer?.userId) return [];
      const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { name: true, linkedEmployeeId: true } });
      const employeeId = user?.linkedEmployeeId;
      if (!employeeId) return [];
      const today = calendarDay(new Date());
      const end = to && calendarDay(to) < today ? calendarDay(to) : today;
      const earliest = new Date(end.getTime() - (ATTENDANCE_MAX_DAYS - 1) * 86400000);
      const start = from && calendarDay(from) > earliest ? calendarDay(from) : earliest;
      if (start > end) return [];
      const [{ days }, compOffs] = await Promise.all([
        hrmAttendance.attendanceDays(employeeId, start, end),
        prisma.attendanceRequest.findMany({
          where: { employeeId, type: "COMP_OFF", status: "APPROVED", fromDate: { lte: end }, toDate: { gte: start } },
          select: { fromDate: true, toDate: true },
        }),
      ]);
      // A comp-off reads as On leave in the register; the calendar says which kind of day off it was.
      const compOffDays = new Set(compOffs.flatMap((request) => eachDateInRange(request.fromDate, request.toDate)));
      return days
        .map((day) => ({ day, label: day.status === "On leave" && compOffDays.has(day.date) ? "Comp off" : day.status }))
        .filter(({ label }) => ATTENDANCE_SHOWN.includes(label))
        .map(({ day, label }) => ({
          id: `attendance:${day.date}`,
          kind: "attendance",
          title: label,
          reference: "",
          day: day.date,
          startAt: null,
          endAt: null,
          location: "",
          owner: text(user.name),
          subject: "",
          meta: { status: label, workedMinutes: day.minutes || 0, loginAt: day.loginAt, logoutAt: day.logoutAt, source: "register" },
        }));
    },
  },
  {
    /*
     * Everybody's absences, for an administrator: one entry per day per status - "Absent" and "On
     * leave" - naming the people in `meta.people`, so a month of a studio of two hundred reads as a
     * count in each day rather than a wall of names. Worked out by `tallyRange`, the reader the
     * attendance Dashboard and register agree through, so the names here are the register's.
     *
     * Absent only up to today - a day still to come cannot be missed yet - where approved leave is
     * shown ahead too. At most a quarter at a time, as My Attendance.
     *
     * It names HRM / Employee Attendance like My Attendance, and also needs an administrator
     * (`administrator`): the same people the attendance Dashboard is open to, since this is the
     * studio's whole roster across a range.
     */
    key: "teamAttendance",
    module: "HRM",
    feature: "Employee Attendance",
    administrator: true,
    async load({ from, to }) {
      const today = calendarDay(new Date());
      const end = to ? calendarDay(to) : today;
      const earliest = new Date(end.getTime() - (ATTENDANCE_MAX_DAYS - 1) * 86400000);
      const start = from && calendarDay(from) > earliest ? calendarDay(from) : earliest;
      if (start > end) return [];
      const { byDay } = await hrmAttendance.tallyRange(start, end, { withTimeOff: false, withPeople: true });
      const todayIso = localIsoDate(today);
      const entries = [];
      /*
       * **One entry a day**, not one per status.
       *
       * A day with two absences and three on leave drew two chips, and a day in a busy month drew
       * them under the shoots and the meetings until the cell was a list of counts nobody could
       * take in. The day now carries one chip - "Attendance · 5" - and the pop-up behind it says
       * which five: Absent first, then On leave, each under its own heading.
       *
       * Every person carries the status they are counted under, so the list view still reads one
       * row per person per day and the branch filter can rebuild the counts after narrowing them.
       */
      for (const day of byDay) {
        const groups = [
          ["Absent", day.date <= todayIso ? day.absentPeople : []],
          ["On leave", day.onLeavePeople],
        ].filter(([, people]) => people?.length);
        if (!groups.length) continue;
        const people = groups.flatMap(([status, list]) => list.map((person) => ({ ...person, status })));
        entries.push({
          id: `teamAttendance:${day.date}`,
          kind: "teamAttendance",
          title: `Attendance · ${people.length}`,
          reference: "",
          day: day.date,
          startAt: null,
          endAt: null,
          location: "",
          owner: "",
          subject: "",
          meta: {
            // The one status, where the day holds only one - which is what colours the chip. A
            // mixed day has no single answer and takes the neutral colour instead.
            status: groups.length === 1 ? groups[0][0] : null,
            count: people.length,
            groups: groups.map(([status, list]) => ({ status, count: list.length })),
            people,
          },
        });
      }
      return entries;
    },
  },
];

/**
 * The board a shoot is worked on now, for the calendar to open its form there:
 *   "production"      its production plan is submitted, or the project's Pre Production is set
 *                     Planned by hand - the same test the project's stage view finishes Pre
 *                     Production by - and it has a production record to open;
 *   "pre-production"  otherwise, once the project has started and the shoot has its row there;
 *   "projects"        a project not started yet, which has neither - its record in Projects.
 */
function shootStage(shoot) {
  const started = shoot.project?.projectStatus && shoot.project.projectStatus !== "Yet to Start";
  if (started && shoot.production && (shoot.production.planSubmittedAt || shoot.project?.preProductionStatus === "PLANNED")) return "production";
  if (started && shoot.preProduction) return "pre-production";
  return "projects";
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
async function listSchedule({ can, viewer = null, from = null, to = null, isAdministrator = false } = {}) {
  const permitted = [];
  for (const source of SOURCES) {
    // A source for administrators only needs that as well as its permission.
    if (source.administrator && !isAdministrator) continue;
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

  return { entries: await withBranches(entries), kinds: permitted.map((source) => source.key), unavailable };
}

/**
 * Each entry's branch as `{ id, name }` - the lead's for a meeting, the project's for a shoot, the
 * candidate's for an interview - or `null` where it has none: a holiday is the whole
 * studio's, and attendance is the viewer's own. Named in one read, so the page can filter by branch
 * without a branch list of its own - the branches offered are the ones these entries are in, which
 * are already only what this viewer may see.
 */
async function withBranches(entries) {
  const ids = [...new Set(entries.map((entry) => entry.branchId).filter((id) => Number.isInteger(id)))];
  const branches = ids.length ? await prisma.branch.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  return entries.map(({ branchId, ...entry }) => ({
    ...entry,
    branch: Number.isInteger(branchId) && names.has(branchId) ? { id: branchId, name: names.get(branchId) } : null,
  }));
}

module.exports = { listSchedule, SOURCES, shootStage };
