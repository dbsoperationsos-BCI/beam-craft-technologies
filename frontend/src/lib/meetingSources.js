/**
 * What the Meetings list is a list of.
 *
 * The calendar has always drawn the whole studio's diary while the table beside it showed CRM
 * meetings alone - two halves of one screen answering different questions, only one of which could
 * be sorted, filtered or exported. The list now reads the same breadth through one switch in the
 * header: everything, the projects register, either production stage, or the meetings themselves.
 *
 * A source names four things - which rows it holds, what its columns say about them, which
 * permission a viewer needs to be offered it at all, and what to say when it is empty - and they
 * are kept together here so a source cannot be half-added. Plain data and pure functions, no JSX,
 * so `node --test` can hold the rules to account without rendering the page.
 *
 * Relative imports rather than the `@/` alias, the way `schedule.js` reaches its own siblings:
 * these rules are covered by plain `node --test`, which resolves no alias.
 */

import { dayKey, formatMeetingDate, formatMeetingTime, isCancelled, meetingTitle, toDate } from "./meetings.js";
import { inPostProduction, inPreProduction, projectDay } from "./projectStages.js";
import { verticalOptions, optionValues, resolveVertical } from "./crmOptions.js";

/*
 * ── The sources ───────────────────────────────────────────────────────────────────────────────
 *
 * `requires` is a disjunction, read the way the calendar's server-side sources are read: a viewer
 * holding any one of the named permissions may be offered the source. Projects answers to either
 * the sale's permission or the plan's, exactly as `/api/schedule` already decides whether to send
 * a project's main event.
 *
 * Every one of these is fed by an endpoint the viewer's own permission already guards, so this is
 * a narrowing rather than a grant: it stops a source being *offered* to somebody the API would
 * then refuse, which is the worse of the two ways to find out.
 */
export const MEETING_SOURCES = [
  { value: "all", label: "All", requires: [] },
  {
    value: "projects",
    label: "Projects",
    requires: [{ module: "SALES", feature: "Sales Manager" }, { module: "PROJECT", feature: "Projects" }],
  },
  { value: "pre-production", label: "Pre Production", requires: [{ module: "PROJECT", feature: "Pre Production" }] },
  { value: "post-production", label: "Post Production", requires: [{ module: "PROJECT", feature: "Post Production" }] },
  { value: "meetings", label: "Meetings", requires: [{ module: "SALES", feature: "CRM Leads" }] },
  /*
   * The interviews HR has scheduled, from the HRM Interview register.
   *
   * `HRM / Interview` and nothing finer, because that is the whole of the guard the register's own
   * router mounts and a screen may not be given a finer permission than the endpoint it reads. The
   * server makes the same check per source, so this only decides whether the switch offers the
   * word - a viewer without it never receives an interview to draw in the first place.
   */
  { value: "interviews", label: "Interviews", requires: [{ module: "HRM", feature: "Interview" }] },
  /*
   * Employee Attendance, which everybody may be offered.
   *
   * `always` rather than a permission, and it mirrors the server's own source registry: a person's
   * own attendance is their own record and no permission stands between them and it, while the
   * studio's belongs to HRM. That is not a question a module and feature can answer, so the server
   * decides the *scope* and this only decides whether the switch offers the word.
   *
   * Offering it to everybody is therefore safe by construction: whoever picks it sees exactly the
   * days `/api/schedule` already sent them, which for most people is their own.
   */
  { value: "attendance", label: "Employee Attendance", requires: [], always: true },
];

// The three that are read out of the projects register, so the page knows whether it has to fetch
// it at all. A viewer with none of them never asks for projects and never waits on the request.
export const PROJECT_SOURCES = ["projects", "pre-production", "post-production"];

// What the list opens on: everything, because the point of the switch is that the schedule is one
// thing. Narrowed to Meetings on its own for a viewer who may read nothing else.
export const DEFAULT_MEETING_SOURCE = "all";

export const meetingSourceLabel = (source) =>
  MEETING_SOURCES.find((entry) => entry.value === source)?.label || "";

/**
 * The sources this viewer may be offered. `can({ module, feature })` is the caller's own check.
 *
 * All is dropped when there is only one real source left to merge - a switch offering "All" and
 * "Meetings" as two names for the same table is a control that looks like a choice and is not.
 */
export function permittedSources(can) {
  const real = MEETING_SOURCES.filter((source) => source.value !== "all" && (source.always || source.requires.some(can)));
  return real.length > 1 ? [MEETING_SOURCES[0], ...real] : real;
}

/*
 * ── Reading a meeting ─────────────────────────────────────────────────────────────────────────
 */

export const MEETING_STATUSES = ["Scheduled", "Cancelled"];

export function meetingStatusLabel(meeting) {
  return isCancelled(meeting) ? "Cancelled" : "Scheduled";
}

export function durationMinutes(meeting) {
  const start = toDate(meeting?.startAt);
  const end = toDate(meeting?.endAt);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function formatDuration(meeting) {
  const minutes = durationMinutes(meeting);
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function guestList(meeting) {
  return Array.isArray(meeting?.attendees) ? meeting.attendees : [];
}

/*
 * ── Rows ──────────────────────────────────────────────────────────────────────────────────────
 *
 * One shape for every source, because one table draws them all: an id unique across sources, the
 * source it came from, the day it falls on, and the record itself under the name of what it is.
 * A column reads `row.meeting` or `row.project` and never has to guess which it was handed.
 */

export const asMeetingRow = (meeting) => ({
  id: `meeting:${meeting.id}`,
  source: "meetings",
  day: dayKey(meeting.startAt),
  meeting,
  project: null,
});

export const asProjectRow = (project) => ({
  id: `project:${project.id}`,
  source: "projects",
  day: projectDay(project),
  meeting: null,
  project,
});

/**
 * One scheduled interview, as a row of the same table.
 *
 * Built from the calendar's own entry rather than from a second request, for the reason attendance
 * is below: `/api/schedule` already sends the interviews this viewer may read, and asking the
 * Interview register for them as well would be two answers that could disagree about when a
 * candidate is coming in.
 *
 * `day` is the entry's own. An interview is kept as a date and a clock time in two text columns
 * with no instant behind them, so there is nothing to read a local day back from.
 */
export const asInterviewRow = (entry) => ({
  id: entry.id,
  source: "interviews",
  day: String(entry?.day || ""),
  meeting: null,
  project: null,
  interview: entry,
});

/**
 * One person's day, as a row of the same table.
 *
 * Built from the calendar's own entry rather than from a second request: `/api/schedule` already
 * sends attendance, already scoped to what this viewer may see, and asking a second endpoint for
 * the same days would be two answers that could disagree about who was in.
 *
 * `day` is the entry's own, which attendance always carries - it is kept per day and never as a
 * moment, so there is no clock to read it back from.
 */
export const asAttendanceRow = (entry) => ({
  id: entry.id,
  source: "attendance",
  day: String(entry?.day || ""),
  meeting: null,
  project: null,
  attendance: entry,
});

/**
 * The rows one source holds.
 *
 * `sources` is what this viewer may read, which only All consults: it merges what is permitted and
 * leaves out what is not, rather than showing an empty half and letting the reader wonder.
 *
 * A project appears **once** under All however many stages it is in. Merging the three project
 * sources instead would count the same wedding as a project, a pre-production and a post-production
 * and put three identical rows in the table.
 */
export function sourceRows(source, { meetings = [], projects = [], attendance = [], interviews = [], sources = [] } = {}) {
  if (source === "meetings") return meetings.map(asMeetingRow);
  if (source === "interviews") return interviews.map(asInterviewRow);
  if (source === "projects") return projects.map(asProjectRow);
  if (source === "pre-production") return projects.filter(inPreProduction).map(asProjectRow);
  if (source === "post-production") return projects.filter(inPostProduction).map(asProjectRow);
  if (source === "attendance") return attendance.map(asAttendanceRow);
  return [
    ...(sources.includes("meetings") ? meetings.map(asMeetingRow) : []),
    ...(sources.some((value) => PROJECT_SOURCES.includes(value)) ? projects.map(asProjectRow) : []),
    /*
     * Interviews *are* in All, unlike attendance below, and the difference is volume rather than
     * principle. An interview is one booking somebody made for one day, a handful a week - exactly
     * the kind of thing the list is read for - so leaving it out of All would mean the one view
     * that promises the whole diary quietly did not hold it.
     */
    ...(sources.includes("interviews") ? interviews.map(asInterviewRow) : []),
    /*
     * Attendance is left out of All in the *table*, and that is deliberate rather than an omission.
     *
     * It is one row per person per day: a fortnight of a dozen people is three hundred rows, which
     * would bury the handful of bookings the list is read for and make every count in the tabs above
     * it meaningless. The calendar shows it under All because a chip in a day cell costs nothing;
     * a table row costs a table. Employee Attendance is its own entry in the switch for exactly
     * this reason.
     */
  ];
}

/*
 * ── The same switch, over the calendar ────────────────────────────────────────────────────────
 *
 * The header switch narrows the month grid as well as the table now, so one control answers "what
 * am I looking at" whichever way the diary is being read.
 *
 * The two halves are shaped differently and the mapping has to say so. The list reads whole records
 * - a meeting, a project - while the calendar draws *bookings*, and one project puts two kinds of
 * booking on the grid: its shoots and its main event. So Projects on the calendar is both of those,
 * not just the main events, or a source called Projects would hide the very days the studio works.
 *
 * The stages are decided the same way the list decides them - `inPreProduction` / `inPostProduction`
 * over the projects register - so a project that is in pre-production in the table cannot be absent
 * from the grid under the same word. A booking is matched back to its project by the event id both
 * sides carry: a shoot's `subject`, a main event's `reference`.
 */

const scheduleEventId = (entry) => String(entry?.subject || entry?.reference || "").trim();

/**
 * The calendar entries one source holds.
 *
 * `sources` is what this viewer may read, and only All consults it - it draws what is permitted and
 * leaves out what is not, exactly as `sourceRows` does. Every kind is already permission-filtered on
 * the server; this is the reader's own narrowing on top of that.
 *
 * **Holidays are not a source and are never narrowed away.** The switch chooses between the things
 * the studio *books* - meetings, shoots, a stage of production - and the studio being closed is
 * none of those: it is a fact about the day that every one of those readings needs. Filtering it
 * with the rest would take the holidays off the calendar for everybody who picked a source, and
 * off it entirely for a viewer whose only source is one the holidays are not part of.
 */
const isHoliday = (entry) => entry?.kind === "holiday";

export function sourceScheduleEntries(source, entries = [], { projects = [], sources = [] } = {}) {
  const all = Array.isArray(entries) ? entries : [];
  // Whatever the switch is on, the holidays stay; the source decides only what joins them.
  const holidays = all.filter(isHoliday);
  const list = all.filter((entry) => !isHoliday(entry));
  const withHolidays = (chosen) => [...holidays, ...chosen];

  if (source === "meetings") return withHolidays(list.filter((entry) => entry?.kind === "meeting"));
  if (source === "interviews") return withHolidays(list.filter((entry) => entry?.kind === "interview"));
  if (source === "attendance") return withHolidays(list.filter((entry) => entry?.kind === "attendance"));

  const fromProjects = (entry) => entry?.kind === "shoot" || entry?.kind === "project";
  if (source === "projects") return withHolidays(list.filter(fromProjects));

  if (source === "pre-production" || source === "post-production") {
    const inStage = source === "pre-production" ? inPreProduction : inPostProduction;
    // The event ids of the projects at that stage. A booking whose project is not in the register
    // this viewer can read is left out rather than guessed at - the same answer the list gives.
    const staged = new Set(
      (Array.isArray(projects) ? projects : [])
        .filter(inStage)
        .map((project) => String(project?.eventId || "").trim())
        .filter(Boolean),
    );
    return withHolidays(list.filter((entry) => fromProjects(entry) && staged.has(scheduleEventId(entry))));
  }

  /*
   * All is every source this viewer holds, and each kind is asked for by name.
   *
   * Attendance used to fall through the project arm of this and be shown to anybody who held a
   * project permission - right by accident, and wrong for somebody who holds none. Naming it is
   * what makes All mean "everything you may see" rather than "everything, if you happen to be able
   * to see shoots".
   */
  return withHolidays(list.filter((entry) => {
    if (entry?.kind === "meeting") return sources.includes("meetings");
    if (entry?.kind === "interview") return sources.includes("interviews");
    if (entry?.kind === "attendance") return sources.includes("attendance");
    return sources.some((value) => PROJECT_SOURCES.includes(value));
  }));
}

/*
 * ── What a row says ───────────────────────────────────────────────────────────────────────────
 *
 * The handful of questions All has to ask of a row whatever it is. Each answers in the record's own
 * terms rather than flattening the two into a lowest common denominator: a meeting's reference is
 * the enquiry it is with, a project's is the event id the studio calls it by.
 */

/** The interview an interview row was built from, or an empty record for anything else. */
const interviewOf = (row) => row?.interview || null;

export const rowKindLabel = (row) => (row.meeting ? "Meeting" : row.interview ? "Interview" : "Project");

export const rowTitle = (row) =>
  row.meeting
    ? meetingTitle(row.meeting)
    // The candidate. An interview is read by who is coming in, the way a meeting is read by its
    // subject - the role they applied for is a column of its own.
    : row.interview
      ? String(row.interview.title || "").trim() || "Candidate"
      : String(row.project?.whatsappGroupName || "").trim() || "Untitled project";

export const rowReference = (row) =>
  row.meeting ? row.meeting.enquiryId || "" : row.interview ? row.interview.reference || "" : row.project?.eventId || "";

// A lead's vertical is folded onto one of the three, the way the lead table reads it. A
// project's is shown as the register stores it - `resolveVertical` would quietly turn "QQ" into
// Dum Dum, which is its documented fallback for a lead and a wrong answer for a project.
// A candidate belongs to no vertical - the studio's three are where an enquiry came from, which is
// not a question anybody asks of somebody applying for a job - so an interview row leaves it blank
// rather than borrowing a word that would read as a fact.
export const rowVertical = (row) =>
  row.meeting
    ? (row.meeting.lead ? resolveVertical(row.meeting.lead.vertical) : "")
    : row.interview ? "" : String(row.project?.vertical || "");

// Whose booking it is. The CRM who sold the lead, falling back to whoever hosts the call; for a
// project, whoever owns the day - the same order the calendar's own `projectOwner` reads it in.
export const rowOwner = (row) =>
  row.meeting
    ? row.meeting.lead?.crm || row.meeting.organizerEmail || ""
    // Whoever is taking the interview, as the register names them.
    : row.interview
      ? String(row.interview.owner || "")
      : String(row.project?.projectManager || row.project?.preProductionCoordinator || row.project?.crmName || "");

export const rowStatus = (row) =>
  row.meeting
    ? meetingStatusLabel(row.meeting)
    // The candidate's stage, in the register's own words - "Interview Scheduled", "Shortlisted".
    : row.interview
      ? String(row.interview.meta?.status || "")
      : String(row.project?.projectStatus || "");

/**
 * The date a row shows, formatted from its day rather than from its raw field.
 *
 * Both kinds already agree on `day` - local for a meeting's instant, as-written for a project's
 * date - so formatting it back through midnight is what keeps one column reading one way.
 */
export const rowDateText = (row) => (row.day ? formatMeetingDate(`${row.day}T00:00:00`) : "");

/*
 * A meeting is a moment and shows its clock time; a project is a day and has none to show.
 *
 * An interview is the third case and neither of those: a day *and* an hour, kept as two text
 * columns with no instant behind them, so the hour is shown as the register wrote it rather than
 * formatted back out of a `Date` that would carry a timezone it never had.
 */
export const rowTimeText = (row) =>
  row.meeting ? formatMeetingTime(row.meeting.startAt) : String(interviewOf(row)?.meta?.clock || "");

/**
 * A row's local clock, as `HH:MM` on the 24-hour scale, or "" for anything booked by the day.
 *
 * Only ever sorted by, never shown. The 12-hour text beside it is what a reader wants and what a
 * sort cannot use: "03:00 pm" orders before "10:00 am" on the alphabet, so an afternoon meeting
 * would sort above a morning one. Built from the local parts for the same reason `dayKey` is -
 * the ISO string is UTC, and a late-evening meeting in India carries the next day's hours in it.
 */
export function rowClock(row) {
  // The server sends an interview's hour twice over for exactly this reason: `clock` to read and
  // `clock24` to sort by. There is no instant to derive one from.
  if (row?.interview) return String(row.interview.meta?.clock24 || "");
  const date = toDate(row?.meeting?.startAt);
  if (!date) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const shootCount = (project) => (Array.isArray(project?.shoots) ? project.shoots.length : 0);

/*
 * ── Columns ───────────────────────────────────────────────────────────────────────────────────
 *
 * In the shape `@/lib/tableColumns` reads: `value` is the cell and the CSV, `match` is what a
 * filter tests, `sort` is what the arrows order by.
 *
 * Every set carries a column with the id `date`, because that is the column the tabs sort by when
 * the reader moves between Upcoming and Past. Keeping the id the same across the sets is what lets
 * a source be switched without the sort landing on a column that is no longer there.
 */

const dateColumn = (label) => ({
  id: "date",
  label,
  filter: "date",
  value: rowDateText,
  // The ISO day too, so a picked date and a typed "2026-08" both find the row.
  match: (row) => `${rowDateText(row)} ${row.day}`,
  // The day, then the clock. Sorted by the day alone, Today's meetings would come back in whatever
  // order the API happened to send them rather than in the order they are to be sat through.
  sort: (row) => `${row.day || ""} ${rowClock(row)}`,
});

const MEETING_COLUMNS = [
  { id: "title", label: "Meeting", value: (row) => meetingTitle(row.meeting) },
  { id: "leadName", label: "Enquiry Name", value: (row) => row.meeting.lead?.name || "" },
  { id: "enquiryId", label: "Enquiry ID", value: (row) => row.meeting.enquiryId || "" },
  {
    id: "vertical",
    label: "Verticals",
    filter: "choice",
    options: optionValues(verticalOptions),
    value: rowVertical,
  },
  dateColumn("Date"),
  { id: "time", label: "Time", value: rowTimeText, sort: rowClock },
  { id: "duration", label: "Duration", value: (row) => formatDuration(row.meeting), sort: (row) => durationMinutes(row.meeting) },
  { id: "host", label: "Host", filter: "choice", optionsFrom: true, value: (row) => row.meeting.organizerEmail || "" },
  {
    id: "guests",
    label: "Guests",
    value: (row) => guestList(row.meeting).join(", "),
    sort: (row) => guestList(row.meeting).length,
  },
  { id: "crm", label: "CRM", filter: "choice", optionsFrom: true, value: (row) => row.meeting.lead?.crm || "" },
  { id: "status", label: "Status", filter: "choice", options: MEETING_STATUSES, value: rowStatus },
];

/*
 * A project's columns, in the order the register itself is read: what it is called, whose it is,
 * when it happens, and where it has got to.
 *
 * `staffing` is the one part that differs between the three project sources - the board a reader
 * came looking for names the person that board is about, which is the column they would otherwise
 * have to go and find.
 */
const projectColumns = (staffing) => [
  { id: "title", label: "Project", value: rowTitle },
  { id: "eventId", label: "Event ID", value: (row) => row.project.eventId || "" },
  { id: "enquiryId", label: "Enquiry ID", value: (row) => row.project.enquiryId || "" },
  { id: "vertical", label: "Verticals", filter: "choice", optionsFrom: true, value: rowVertical },
  dateColumn("Main Event Date"),
  ...staffing,
  { id: "shoots", label: "Shoots", value: (row) => String(shootCount(row.project) || ""), sort: (row) => shootCount(row.project) },
  { id: "crm", label: "CRM", filter: "choice", optionsFrom: true, value: (row) => row.project.crmName || "" },
  { id: "status", label: "Project Status", filter: "choice", optionsFrom: true, value: rowStatus },
];

const staffColumn = (id, label, field) => ({
  id,
  label,
  filter: "choice",
  optionsFrom: true,
  value: (row) => String(row.project?.[field] || ""),
});

const ALL_COLUMNS = [
  { id: "kind", label: "Type", filter: "choice", options: ["Meeting", "Interview", "Project"], value: rowKindLabel },
  { id: "reference", label: "Reference", value: rowReference },
  { id: "title", label: "Title", value: rowTitle },
  { id: "vertical", label: "Verticals", filter: "choice", optionsFrom: true, value: rowVertical },
  dateColumn("Date"),
  { id: "time", label: "Time", value: rowTimeText, sort: rowClock },
  { id: "owner", label: "Owner", filter: "choice", optionsFrom: true, value: rowOwner },
  { id: "status", label: "Status", filter: "choice", optionsFrom: true, value: rowStatus },
];

/*
 * ── Interviews, as a table ────────────────────────────────────────────────────────────────────
 *
 * The same bookings the calendar draws as chips, read as rows: who is coming in, for what, when,
 * with whom, and where the candidate has got to. The chip has room for a name and an hour; the
 * table has room for the role and the stage, which is what somebody reading a week of interviews
 * actually needs.
 *
 * Read-only, and there is no second endpoint behind it - these are the entries `/api/schedule`
 * already sent. A candidate is worked on in HRM → Interview, which is where their record is.
 */
const INTERVIEW_COLUMNS = [
  // The candidate leads it: an interview is read down a name, and so is the chip on the grid.
  { id: "title", label: "Candidate", value: rowTitle },
  { id: "reference", label: "Candidate ID", value: rowReference },
  { id: "position", label: "Position", filter: "choice", optionsFrom: true, value: (row) => String(interviewOf(row)?.subject || "") },
  dateColumn("Interview Date"),
  // Shown as the register wrote it, sorted on the 24-hour twin the server sends beside it - by the
  // printed text, "03:00 pm" would file above "10:00 am" on the alphabet.
  { id: "time", label: "Time", value: rowTimeText, sort: rowClock },
  { id: "mode", label: "Mode", filter: "choice", optionsFrom: true, value: (row) => String(interviewOf(row)?.meta?.mode || "") },
  { id: "interviewer", label: "Interviewer", filter: "choice", optionsFrom: true, value: rowOwner },
  { id: "branch", label: "Branch", filter: "choice", optionsFrom: true, value: (row) => String(interviewOf(row)?.meta?.branch || "") },
  { id: "status", label: "Status", filter: "choice", optionsFrom: true, value: rowStatus },
];

/*
 * ── Employee Attendance, as a table ───────────────────────────────────────────────────────────
 *
 * The same days the calendar draws as chips, read as rows: who, when, and what the day said. The
 * chip has room for a name and a word; the table has room for the hours and for where the answer
 * came from, which is the part somebody reading a month of attendance actually needs.
 *
 * "Source" is not decoration. *Measured* is what the application saw - the person was using it -
 * and *Marked* is what somebody decided, which is the difference between a register that records
 * and one that asserts. A day corrected to Leave and a day nobody was seen on both read as
 * something other than Present, and only this column says which of the two happened.
 */
const ATTENDANCE_STATUSES = ["Present", "Absent", "Half day", "Leave", "Holiday", "Week off"];

const attendanceOf = (row) => row?.attendance || {};

/** Minutes as the hours and minutes a register is read in, blank for a day with none. */
function attendanceWorked(row) {
  const minutes = Math.max(0, Math.round(Number(attendanceOf(row).meta?.workedMinutes) || 0));
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const ATTENDANCE_COLUMNS = [
  // The person leads it: a register is read down a name, and the calendar chip leads with it too.
  { id: "employee", label: "Employee", filter: "choice", optionsFrom: true, value: (row) => String(attendanceOf(row).owner || "") },
  dateColumn("Date"),
  { id: "status", label: "Status", filter: "choice", options: ATTENDANCE_STATUSES, value: (row) => String(attendanceOf(row).title || "") },
  // Sorted on the minutes rather than the words, or "46m" files above "2h 53m" on the alphabet.
  { id: "worked", label: "Worked", value: attendanceWorked, sort: (row) => Number(attendanceOf(row).meta?.workedMinutes) || 0 },
  {
    id: "source",
    label: "Source",
    filter: "choice",
    options: ["Measured", "Marked"],
    value: (row) => (attendanceOf(row).meta?.source === "marked" ? "Marked" : attendanceOf(row).meta?.source === "measured" ? "Measured" : ""),
  },
  { id: "note", label: "Note", value: (row) => String(attendanceOf(row).meta?.note || "") },
];

const COLUMNS = {
  all: ALL_COLUMNS,
  meetings: MEETING_COLUMNS,
  interviews: INTERVIEW_COLUMNS,
  attendance: ATTENDANCE_COLUMNS,
  projects: projectColumns([staffColumn("projectManager", "Project Manager", "projectManager")]),
  "pre-production": projectColumns([
    staffColumn("preProductionCoordinator", "Pre Production Coordinator", "preProductionCoordinator"),
    staffColumn("projectManager", "Project Manager", "projectManager"),
  ]),
  "post-production": projectColumns([
    staffColumn("postProductionCoordinator", "Post Production Coordinator", "postProductionCoordinator"),
    staffColumn("creativeManager", "Creative Manager", "creativeManager"),
  ]),
};

export const sourceColumns = (source) => COLUMNS[source] || COLUMNS.all;

/**
 * What an empty table says when the source, rather than a filter or a tab, is why it is empty.
 *
 * Three different pieces of news, and saying the wrong one sends somebody hunting for a filter they
 * never set.
 */
export function sourceEmptyMessage(source) {
  if (source === "meetings") return "No meetings booked yet. Add Meet schedules one.";
  // Not "no candidates": the register may be full of people nobody has given a date yet, and this
  // source holds only the ones who have one. HRM → Interview is where a date is set.
  if (source === "interviews") return "No interviews scheduled yet. HRM → Interview sets a date.";
  if (source === "pre-production") return "No project has a pre-production coordinator yet.";
  if (source === "post-production") return "No project has a post-production coordinator yet.";
  if (source === "projects") return "No projects have been started yet.";
  // Never "nothing scheduled": attendance is a record of days that have happened rather than
  // something anybody books, so an empty one is a question about the range, not about the diary.
  if (source === "attendance") return "No attendance in this range yet.";
  return "Nothing has been scheduled yet.";
}
