import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEETING_SOURCE,
  MEETING_SOURCES,
  PROJECT_SOURCES,
  attendanceClock,
  attendanceWorked,
  formatDuration,
  meetingStatusLabel,
  permittedSources,
  rowOwner,
  rowReference,
  rowTitle,
  rowVertical,
  sourceColumns,
  sourceEmptyMessage,
  sourceRows,
  sourceScheduleEntries,
} from "../src/lib/meetingSources.js";
import { inPostProduction, inPreProduction, projectDay } from "../src/lib/projectStages.js";

/*
 * What the Meetings list is a list of.
 *
 * One table draws five different sets of rows, so the two things worth pinning down are that a
 * source hands back the rows it says it does - a project counted once, whatever else it is - and
 * that every set of columns keeps the `date` column the tabs sort by.
 */

const meeting = (id, overrides = {}) => ({
  id,
  enquiryId: `DBS-DD-${id}`,
  title: `Meeting ${id}`,
  startAt: new Date(2026, 8, 11, 15, 0),
  endAt: new Date(2026, 8, 11, 15, 30),
  attendees: ["a@example.com"],
  organizerEmail: "host@example.com",
  status: "SCHEDULED",
  lead: { name: `Lead ${id}`, vertical: "dumdum", crm: "Priya" },
  ...overrides,
});

const project = (id, overrides = {}) => ({
  id,
  eventId: `DBS-SID-${id}`,
  enquiryId: `DBS-DD-${id}`,
  whatsappGroupName: `Client ${id}`,
  vertical: "QQ",
  mainEventDate: "2026-09-11T00:00:00.000Z",
  projectStatus: "Yet to Start",
  projectManager: "Anil",
  crmName: "Priya",
  shoots: [],
  ...overrides,
});

const withPre = (id) => project(id, { preProductionCoordinator: "Meera" });
const withPost = (id) => project(id, { postProductionCoordinator: "Ravi" });
// Both stages at once, which is the case that catches a merge counting the same wedding twice.
const withBoth = (id) => project(id, { preProductionCoordinator: "Meera", postProductionCoordinator: "Ravi" });

const ALL_SOURCES = MEETING_SOURCES.map((entry) => entry.value);

test("a stage is who is staffed to it, and nothing else", () => {
  assert.equal(inPreProduction(withPre("1")), true);
  assert.equal(inPreProduction(project("2")), false);
  // The employee id counts on its own: a coordinator picked from the directory leaves the name
  // field to be filled in from it, and a project staffed that way is still in pre-production.
  assert.equal(inPreProduction(project("3", { preProductionCoordinatorEmployeeId: 7 })), true);
  // Whitespace is not a name.
  assert.equal(inPostProduction(project("4", { postProductionCoordinator: "   " })), false);
  assert.equal(inPostProduction(withPost("5")), true);
});

test("a main event date is the day the studio wrote down, not a moment", () => {
  // Sliced rather than parsed: read through a `Date`, an 11 September event lands on the 10th for
  // anybody west of Greenwich, which is the whole reason this function exists.
  assert.equal(projectDay(project("1")), "2026-09-11");
  assert.equal(projectDay(project("2", { mainEventDate: null })), "");
  assert.equal(projectDay(project("3", { mainEventDate: "not a date" })), "");
});

test("each source hands back the rows it names", () => {
  const meetings = [meeting("1"), meeting("2")];
  const projects = [project("1"), withPre("2"), withPost("3")];
  const options = { meetings, projects, sources: ALL_SOURCES };

  assert.deepEqual(sourceRows("meetings", options).map((row) => row.id), ["meeting:1", "meeting:2"]);
  assert.deepEqual(sourceRows("projects", options).map((row) => row.id), ["project:1", "project:2", "project:3"]);
  assert.deepEqual(sourceRows("pre-production", options).map((row) => row.id), ["project:2"]);
  assert.deepEqual(sourceRows("post-production", options).map((row) => row.id), ["project:3"]);
});

test("All holds every project once, however many stages it is in", () => {
  // Merging the three project sources instead would list a wedding staffed at both ends as a
  // project, a pre-production and a post-production: three identical rows in one table.
  const rows = sourceRows("all", { meetings: [meeting("1")], projects: [withBoth("9")], sources: ALL_SOURCES });
  assert.deepEqual(rows.map((row) => row.id), ["meeting:1", "project:9"]);
});

test("All leaves out what the viewer may not read", () => {
  const meetings = [meeting("1")];
  const projects = [project("1")];
  // A viewer with no production permission sees the meetings half and no empty project half.
  assert.deepEqual(
    sourceRows("all", { meetings, projects, sources: ["meetings"] }).map((row) => row.id),
    ["meeting:1"],
  );
  // And the reverse: production without the CRM.
  assert.deepEqual(
    sourceRows("all", { meetings, projects, sources: ["pre-production"] }).map((row) => row.id),
    ["project:1"],
  );
});

/*
 * The same switch, over the calendar.
 *
 * The header switch narrows the month grid as well as the table, and the two halves are shaped
 * differently: the list reads whole records, the calendar draws bookings, and one project puts both
 * its shoots and its main event on the grid. These pin the mapping between them.
 */

const entry = (id, kind, overrides = {}) => ({ id: `${kind}:${id}`, kind, day: "2026-09-11", ...overrides });
const shootEntry = (id, eventId) => entry(id, "shoot", { subject: eventId, reference: `DBS-SID-${id}` });
const mainEventEntry = (id, eventId) => entry(id, "project", { reference: eventId });

test("the calendar's sources hold the bookings they name", () => {
  const entries = [entry("1", "meeting"), shootEntry("7", "DBS-SID-2"), mainEventEntry("2", "DBS-SID-2")];
  const options = { projects: [project("1"), withPre("2"), withPost("3")], sources: ALL_SOURCES };

  assert.deepEqual(sourceScheduleEntries("meetings", entries, options).map((row) => row.id), ["meeting:1"]);
  /*
   * Projects is the projects' shoots - the days the studio actually works. A project's main event is
   * not a calendar entry any more, so one that still arrived would not be drawn.
   */
  assert.deepEqual(
    sourceScheduleEntries("projects", entries, options).map((row) => row.id),
    ["shoot:7"],
  );
});

test("the studio's holidays survive every source the switch offers", () => {
  /*
   * A holiday is not a thing the studio books, so it is not one of the sources: the switch chooses
   * between meetings, shoots and the stages of production, and the studio being *closed* is a fact
   * about the day that every one of those readings needs.
   *
   * The case that made this matter: an employee holding no module permission at all. Their only
   * source is the one offered to everybody, so narrowing the holidays with the rest would have
   * taken them off the calendar for exactly the person the calendar was opened up for.
   */
  const holiday = { id: "holiday:1", kind: "holiday", day: "2026-10-20", title: "Diwali", reference: "" };
  const entries = [holiday, entry("1", "meeting"), shootEntry("7", "DBS-SID-2"), mainEventEntry("2", "DBS-SID-2")];
  const options = { projects: [withPre("2")], sources: ALL_SOURCES };

  for (const source of ["all", "meetings", "projects", "pre-production", "post-production", "interviews", "attendance"]) {
    const ids = sourceScheduleEntries(source, entries, options).map((row) => row.id);
    assert.ok(ids.includes("holiday:1"), `the "${source}" source drops the studio's holidays`);
  }
  // And a viewer who may read nothing else is left with the holidays rather than an empty month -
  // the server sends such a viewer no shoots, and a shoot it did send is never dropped here.
  assert.deepEqual(
    sourceScheduleEntries("all", entries.filter((row) => row.kind !== "shoot"), { projects: [], sources: [] }).map((row) => row.id),
    ["holiday:1"],
  );
});

test("a calendar booking is at the stage its own project is at", () => {
  // Matched back to the register by the event id both sides carry - a shoot's `subject` - so the
  // grid and the table cannot disagree about what "Pre Production" means for the same wedding.
  const entries = [shootEntry("7", "DBS-SID-2"), mainEventEntry("2", "DBS-SID-2"), shootEntry("8", "DBS-SID-3")];
  const projects = [withPre("2"), withPost("3")];

  assert.deepEqual(
    sourceScheduleEntries("pre-production", entries, { projects, sources: ALL_SOURCES }).map((row) => row.id),
    ["shoot:7"],
  );
  assert.deepEqual(
    sourceScheduleEntries("post-production", entries, { projects, sources: ALL_SOURCES }).map((row) => row.id),
    ["shoot:8"],
  );
  // A booking whose project is not in the register this viewer can read is left out rather than
  // guessed at, which is the answer the list gives too.
  assert.deepEqual(
    sourceScheduleEntries("pre-production", entries, { projects: [], sources: ALL_SOURCES }).map((row) => row.id),
    [],
  );
});

test("All draws the whole diary, minus what the viewer may not read", () => {
  const entries = [entry("1", "meeting"), shootEntry("7", "DBS-SID-2"), mainEventEntry("2", "DBS-SID-2")];
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { projects: [], sources: ALL_SOURCES }).map((row) => row.id),
    ["meeting:1", "shoot:7", "project:2"],
  );
  // A shoot is the server's to send or not (it narrows them to the viewer's own), so All keeps any
  // it sent; the project register's own rows still need a project source.
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { projects: [], sources: ["meetings"] }).map((row) => row.id),
    ["meeting:1", "shoot:7"],
  );
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { projects: [], sources: ["pre-production"] }).map((row) => row.id),
    ["shoot:7", "project:2"],
  );
});

test("every row carries the day its tab reads it by", () => {
  const [meetingRow] = sourceRows("meetings", { meetings: [meeting("1")], sources: ALL_SOURCES });
  const [projectRow] = sourceRows("projects", { projects: [project("1")], sources: ALL_SOURCES });
  // The meeting's day is its start instant read locally; the project's is the date as written.
  assert.equal(meetingRow.day, "2026-09-11");
  assert.equal(projectRow.day, "2026-09-11");
});

test("a source is only offered to somebody its endpoint would answer", () => {
  const holds = (granted) => ({ module, feature }) => granted.includes(`${module}:${feature}`);

  /*
   * My Attendance answers to `HRM / Employee Attendance`, the permission the person's own
   * Attendance page and the server's calendar source both answer to - a role with attendance turned
   * off does not get it back through the calendar.
   */
  const ATT = "HRM:Employee Attendance";
  assert.deepEqual(
    permittedSources(holds(["SALES:CRM Leads", ATT])).map((entry) => entry.value),
    ["all", "meetings", "attendance"],
  );
  assert.deepEqual(permittedSources(holds(["SALES:CRM Leads"])).map((entry) => entry.value), ["meetings"]);

  assert.deepEqual(
    permittedSources(holds(["PROJECT:Post Production", ATT])).map((entry) => entry.value),
    ["all", "post-production", "attendance"],
  );

  assert.deepEqual(
    permittedSources(holds(["SALES:CRM Leads", "PROJECT:Pre Production", ATT])).map((entry) => entry.value),
    ["all", "pre-production", "meetings", "attendance"],
  );

  // Projects answers to either the sale's permission or the plan's, the way `/api/schedule` reads
  // the same source. Either one on its own is enough.
  assert.ok(permittedSources(holds(["SALES:Sales Manager", "SALES:CRM Leads"])).some((entry) => entry.value === "projects"));
  assert.ok(permittedSources(holds(["PROJECT:Projects", "SALES:CRM Leads"])).some((entry) => entry.value === "projects"));

  /*
   * Attendance alone is attendance alone - and no All above it, because one source is not a choice.
   * Nothing granted is nothing offered.
   */
  assert.deepEqual(permittedSources(holds([ATT])).map((entry) => entry.value), ["attendance"]);
  assert.deepEqual(permittedSources(holds([])).map((entry) => entry.value), []);
});

/* ──────────────────────────────────────────────────────── Interviews as a source ── */

const interviewEntry = (id, overrides = {}) => ({
  id: `interview:${id}`,
  kind: "interview",
  title: `Candidate ${id}`,
  reference: `DBS-INTV-00000${id}`,
  day: "2026-09-11",
  startAt: null,
  endAt: null,
  location: "Google Meet — Dum Dum",
  owner: "Priya S",
  subject: "Photographer",
  meta: { clock: "10:30 am", clock24: "10:30", mode: "Google Meet", status: "Interview Scheduled", branch: "Dum Dum", ...overrides },
});

test("Interviews is its own entry in the switch, and it is in All as well", () => {
  /*
   * Unlike Employee Attendance below, and the difference is volume rather than principle. An
   * interview is one booking somebody made for one day - a handful a week, exactly the kind of
   * thing this list is read for - while attendance is one row per person per day and would bury
   * them. So All holds interviews and the switch names them too.
   */
  const interviews = [interviewEntry("1"), interviewEntry("2")];
  assert.deepEqual(sourceRows("interviews", { interviews }).map((row) => row.id), ["interview:1", "interview:2"]);
  assert.deepEqual(
    sourceRows("all", { meetings: [meeting("1")], projects: [], interviews, sources: ["meetings", "interviews"] }).map((row) => row.id),
    ["meeting:1", "interview:1", "interview:2"],
  );
  // And left out for somebody who was never offered them, exactly as every other source is.
  assert.deepEqual(
    sourceRows("all", { meetings: [meeting("1")], projects: [], interviews, sources: ["meetings"] }).map((row) => row.id),
    ["meeting:1"],
  );
});

test("an interview row reads as who is coming in, for what, when and with whom", () => {
  const [row] = sourceRows("interviews", { interviews: [interviewEntry("1")] });
  assert.equal(row.source, "interviews");
  assert.equal(row.day, "2026-09-11");

  const columns = Object.fromEntries(sourceColumns("interviews").map((column) => [column.id, column]));
  assert.equal(columns.title.value(row), "Candidate 1");
  assert.equal(columns.reference.value(row), "DBS-INTV-000001");
  assert.equal(columns.position.value(row), "Photographer");
  assert.equal(columns.mode.value(row), "Google Meet");
  assert.equal(columns.interviewer.value(row), "Priya S");
  assert.equal(columns.branch.value(row), "Dum Dum");
  assert.equal(columns.status.value(row), "Interview Scheduled");
  // Shown as the register wrote it - there is no instant behind it to format one back out of.
  assert.equal(columns.time.value(row), "10:30 am");
  /*
   * And sorted on the 24-hour twin the server sends beside it. By the printed text, "03:00 pm"
   * files above "10:00 am" on the alphabet, so an afternoon interview would sort above a morning
   * one - the same fault a meeting's `rowClock` exists to avoid.
   */
  const afternoon = sourceRows("interviews", { interviews: [interviewEntry("2", { clock: "03:00 pm", clock24: "15:00" })] })[0];
  assert.ok(columns.time.sort(row) < columns.time.sort(afternoon));
});

test("All names an interview as what it is, without borrowing another kind's words", () => {
  const [row] = sourceRows("interviews", { interviews: [interviewEntry("1")] });
  const columns = Object.fromEntries(sourceColumns("all").map((column) => [column.id, column]));
  assert.equal(columns.kind.value(row), "Interview");
  assert.equal(columns.title.value(row), "Candidate 1");
  assert.equal(columns.reference.value(row), "DBS-INTV-000001");
  assert.equal(columns.owner.value(row), "Priya S");
  assert.equal(columns.status.value(row), "Interview Scheduled");
  /*
   * And no vertical. The studio's three say where an *enquiry* came from, which is not a question
   * anybody asks of somebody applying for a job - a word there would read as a fact.
   */
  assert.equal(rowVertical(row), "");
  // The Type filter offers the third answer, or a column that can be filtered could not find them.
  assert.deepEqual(columns.kind.options, ["Meeting", "Interview", "Project"]);
});

test("the calendar's switch narrows to the interviews and to nothing else", () => {
  const entries = [
    interviewEntry("1"),
    { id: "m1", kind: "meeting", startAt: "2026-09-02T04:00:00.000Z" },
    { id: "s1", kind: "shoot", day: "2026-09-02" },
  ];
  assert.deepEqual(sourceScheduleEntries("interviews", entries).map((e) => e.id), ["interview:1"]);
  // All asks for the kind by name, so an interview reaches only somebody who was offered them.
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { sources: ["interviews"] }).map((e) => e.id),
    ["interview:1", "s1"],
    "a shoot the server sent is kept - it narrows shoots to the viewer's own",
  );
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { sources: ["meetings"] }).map((e) => e.id),
    ["m1", "s1"],
    "All is showing interviews to somebody who may not read the register (a shoot the server sent is kept)",
  );
});

test("Interviews is offered only to somebody the register would answer", () => {
  const holds = (granted) => ({ module, feature }) => granted.includes(`${module}:${feature}`);
  /*
   * `HRM / Interview` and nothing finer, because that is the whole of the guard the register's own
   * router mounts - a screen may not be given a finer permission than the endpoint it reads.
   */
  assert.deepEqual(
    permittedSources(holds(["HRM:Interview", "HRM:Employee Attendance"])).map((entry) => entry.value),
    ["all", "interviews", "attendance"],
  );
  assert.ok(!permittedSources(holds(["SALES:CRM Leads"])).some((entry) => entry.value === "interviews"));
});

test("every source's columns keep the date column the tabs sort by", () => {
  // Switching source resets the filters but keeps the sort, so a set without a `date` column would
  // leave the table sorted by a column that is no longer there.
  for (const source of ALL_SOURCES) {
    const columns = sourceColumns(source);
    const date = columns.find((column) => column.id === "date");
    assert.ok(date, `${source} has no date column`);
    assert.equal(date.filter, "date");
    // Ids have to be unique or the header row draws two cells under one React key.
    const ids = columns.map((column) => column.id);
    assert.equal(new Set(ids).size, ids.length, `${source} repeats a column id`);
    assert.ok(columns.every((column) => typeof column.value === "function"), `${source} has a column with no value`);
  }
  // An unknown source falls back rather than drawing a table with no columns at all.
  assert.equal(sourceColumns("nonsense"), sourceColumns("all"));
});

test("a row says its own name, reference and owner whatever it is", () => {
  const [m] = sourceRows("meetings", { meetings: [meeting("1")], sources: ALL_SOURCES });
  const [p] = sourceRows("projects", { projects: [project("1")], sources: ALL_SOURCES });

  assert.equal(rowTitle(m), "Meeting 1");
  assert.equal(rowReference(m), "DBS-DD-1");
  assert.equal(rowOwner(m), "Priya");
  // A lead's vertical is folded onto one of the three, the way the lead table reads it.
  assert.equal(rowVertical(m), "Dum Dum");

  assert.equal(rowTitle(p), "Client 1");
  assert.equal(rowReference(p), "DBS-SID-1");
  assert.equal(rowOwner(p), "Anil");
  // A project's stored code is named the way a lead's vertical is, so the two read and filter alike -
  // and Dum Dum's internal "WED" never reaches the screen. An unknown code is shown as it is rather
  // than folded onto Dum Dum, which is the lead table's fallback and a wrong answer for a project.
  assert.equal(rowVertical(p), "Qua Qua");
  assert.equal(rowVertical({ ...p, project: { ...p.project, vertical: "WED" } }), "Dum Dum");
  assert.equal(rowVertical({ ...p, project: { ...p.project, vertical: "XYZ" } }), "XYZ");
});

test("a day's meetings sort into the order they are sat through", () => {
  // The Date column sorts by the day *and* the clock. By the day alone, Today's tab would come
  // back in whatever order the API sent it - and by the printed time it would be worse than that,
  // because "03:00 pm" orders before "10:00 am" on the alphabet.
  const afternoon = meeting("1", { startAt: new Date(2026, 8, 11, 15, 0) });
  const morning = meeting("2", { startAt: new Date(2026, 8, 11, 10, 0) });
  const rows = sourceRows("meetings", { meetings: [afternoon, morning], sources: ALL_SOURCES });
  const date = sourceColumns("meetings").find((column) => column.id === "date");
  const time = sourceColumns("meetings").find((column) => column.id === "time");

  const byDate = rows.slice().sort((a, b) => (date.sort(a) > date.sort(b) ? 1 : -1));
  assert.deepEqual(byDate.map((row) => row.id), ["meeting:2", "meeting:1"]);

  const byTime = rows.slice().sort((a, b) => (time.sort(a) > time.sort(b) ? 1 : -1));
  assert.deepEqual(byTime.map((row) => row.id), ["meeting:2", "meeting:1"]);
});

test("a meeting's length and status read the way they always have", () => {
  assert.equal(formatDuration(meeting("1")), "30 min");
  assert.equal(formatDuration(meeting("2", { endAt: new Date(2026, 8, 11, 17, 30) })), "2 hr 30 min");
  assert.equal(formatDuration(meeting("3", { endAt: new Date(2026, 8, 11, 16, 0) })), "1 hr");
  assert.equal(formatDuration(meeting("4", { endAt: null })), "");
  assert.equal(meetingStatusLabel(meeting("5")), "Scheduled");
  assert.equal(meetingStatusLabel(meeting("6", { status: "CANCELLED" })), "Cancelled");
});

test("the switch opens on All, and the register-backed sources are named once", () => {
  assert.equal(DEFAULT_MEETING_SOURCE, "all");
  // The order is the meaning: All, the register, the two stages as production runs, the meetings,
  // and attendance last - it is the only one that is not something the studio books.
  assert.deepEqual(ALL_SOURCES, ["all", "projects", "pre-production", "post-production", "shoots", "meetings", "interviews", "attendance", "team-attendance"]);
  assert.deepEqual(PROJECT_SOURCES, ["projects", "pre-production", "post-production"]);
  // Each says something different when it is empty, so a blank table names why.
  const messages = ALL_SOURCES.map(sourceEmptyMessage);
  assert.equal(new Set(messages).size, messages.length);
});


/* ─────────────────────────────────────────────── Employee Attendance as a source ── */

test("Employee Attendance is its own entry in the switch, and its own table", () => {
  /*
   * It is one row per person per day: a fortnight of a dozen people is three hundred rows. Under
   * All in the *table* that would bury the handful of bookings the list is read for and make every
   * count in the tabs above it meaningless - so All leaves it out and the switch names it instead.
   * The calendar shows it under All because a chip in a day cell costs nothing; a table row costs a
   * table.
   */
  const entry = (userId, day, title, status) => ({
    id: `attendance:${userId}:${day}`, kind: "attendance", title, day, owner: "Dhanush MM",
    reference: "Dhanush MM", meta: { status, workedMinutes: 493, source: "measured", note: "" },
  });
  const attendance = [entry(1, "2026-09-02", "Present", "PRESENT"), entry(2, "2026-09-02", "Absent", "ABSENT")];

  assert.equal(sourceRows("attendance", { attendance }).length, 2);
  assert.deepEqual(
    sourceRows("all", { meetings: [], projects: [], attendance, sources: ["attendance", "meetings"] }),
    [],
    "attendance is being merged into the All table again",
  );
});

test("an attendance row reads as who, when and what the day said", () => {
  const attendance = [{
    id: "attendance:2026-09-02", kind: "attendance", title: "Half day", day: "2026-09-02",
    owner: "Priya S", reference: "",
    meta: { status: "Half day", workedMinutes: 173, loginAt: "2026-09-02T04:00:00.000Z", logoutAt: "2026-09-02T06:53:00.000Z", source: "register" },
  }];
  const [row] = sourceRows("attendance", { attendance });
  assert.equal(row.source, "attendance");
  assert.equal(row.day, "2026-09-02");

  const columns = sourceColumns("attendance");
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]));
  // Only ever the viewer's own days, so no column repeats their name down every row.
  assert.equal(byId.employee, undefined);

  /*
   * The day is **one** column, Attendance, with the register's times behind it in the popup.
   *
   * It used to be four - a status and three clocks - and three of them were blank on exactly the
   * days this list is read for: an absence and a day's leave have no login, no logout and no hours.
   */
  assert.deepEqual(columns.map((column) => column.label), ["Date", "Attendance"]);
  for (const gone of ["login", "logout", "worked"]) assert.equal(byId[gone], undefined, `${gone} is read in the popup now`);
  assert.equal(byId.status.value(row), "Half day");
  // Its id stays `status`: the board groups this list by that column and filters it by the six
  // statuses the calendar shows, and both are still exactly what the column holds.
  assert.deepEqual(byId.status.options, ["Absent", "On leave", "Comp off", "Late", "Half day", "Early exit"]);

  // The times themselves still read the way the popup draws them, hours sorted on the minutes
  // rather than on the words - "46m" would file above "2h 53m" on the alphabet.
  assert.equal(attendanceWorked(row), "2h 53m");
  assert.ok(attendanceClock(row.attendance.meta.loginAt));
  assert.equal(attendanceClock(undefined), "");
  // And a day with no hours says nothing rather than "0m".
  assert.equal(attendanceWorked({ attendance: { meta: {} } }), "");

});

test("the calendar's switch narrows to attendance and to nothing else", () => {
  const entries = [
    { id: "a1", kind: "attendance", day: "2026-09-02" },
    { id: "m1", kind: "meeting", startAt: "2026-09-02T04:00:00.000Z" },
    { id: "s1", kind: "shoot", day: "2026-09-02" },
  ];
  assert.deepEqual(sourceScheduleEntries("attendance", entries).map((e) => e.id), ["a1"]);
  assert.deepEqual(sourceScheduleEntries("meetings", entries).map((e) => e.id), ["m1"]);

  /*
   * And All asks for each kind by name. Attendance used to fall through the *project* arm of that
   * filter, so it appeared for anybody holding a project permission - right by accident, and wrong
   * for somebody holding none.
   */
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { sources: ["attendance"] }).map((e) => e.id),
    ["a1", "s1"],
    "All no longer shows attendance to somebody whose only source it is (a shoot the server sent is kept)",
  );
  assert.deepEqual(
    sourceScheduleEntries("all", entries, { sources: ["projects"] }).map((e) => e.id),
    ["s1"],
    "All is showing attendance to somebody who was never offered it",
  );
});

test("a production team member gets My Shoots - and All with it - rather than attendance alone", async () => {
  const { permittedSources, sourceScheduleEntries, sourceRows } = await import("../src/lib/meetingSources.js");
  const holds = (...held) => ({ module, feature }) => held.includes(`${module}/${feature}`);
  const crew = permittedSources(holds("PROJECT/Production", "HRM/Employee Attendance")).map((source) => source.value);
  assert.deepEqual(crew, ["all", "shoots", "attendance"], "the switch appears and opens on All");
  assert.equal(permittedSources(holds("PROJECT/Production", "PROJECT/Projects")).some((source) => source.value === "shoots"), false, "somebody sent every shoot has Projects instead");
  const entries = [{ id: "shoot:1", kind: "shoot", day: "2026-11-01", title: "Rituals", subject: "E1", meta: { projectName: "Anu & Ravi" } }, { id: "a", kind: "attendance", day: "2026-10-31" }];
  assert.deepEqual(sourceScheduleEntries("shoots", entries).map((entry) => entry.kind), ["shoot"]);
  const [row] = sourceRows("shoots", { shoots: entries.slice(0, 1) });
  assert.equal(row.project.eventId, "E1");
  assert.equal(row.project.whatsappGroupName, "Rituals — Anu & Ravi");
  assert.equal(sourceRows("all", { shoots: entries.slice(0, 1), sources: ["all", "shoots"] }).length, 1, "All's table holds them too");
});
