const prisma = require("../../../config/db");
const dataScope = require("../../dataScope.service");
const iamService = require("../../iam.service");
const attendance = require("../../../modules/hrm/attendance/service");
const { calendarDay, localIsoDate, eachDateInRange, dayKindFor, DAY_KINDS, attendanceStartIso } = require("../../../modules/hrm/attendance/attendanceRules");
const { ATTENDANCE_WORDS } = require("../intent");
const { EMPLOYEE_SCOPE_COLUMNS } = require("../../../modules/hrm/employees/scopeColumns");

/**
 * Read-only attendance for Nebula: who is present, late, absent or on leave on a day.
 *
 * Offered beside whichever module the panel is in (`modules.js`, `companion`), so "how many of them
 * are present today" can be asked from Projects about the people a project list just named. Every
 * rule the Attendance screens hold is checked again here, in this order, and none of them is the
 * model's to waive:
 *
 *   1. **The module.** HRM / Employee Attendance at READ - the attendance router's own permission,
 *      checked by the registry before this runs (the tool's module).
 *   2. **Your own day**, always: it is the Today screen everybody with rule 1 already has.
 *   3. **Anybody else's day** only with HRM / Attendance Approval at READ - the Attendance
 *      Register's rule (`canReadRegister`). Without it the answer is your own day and a plain note.
 *   4. **Which colleagues.** Narrowed further by the data scope of that same grant, on the employee
 *      record's own columns - the branches its roles reach and the people who report to you - so
 *      Nebula is never wider than the person's reach, even where the register screen shows more.
 *   5. **Which days.** One day, or a range - "the last five working days", "this week", "28 Sep to
 *      2 Oct" - inside the last 31 days; never a day still to come.
 *
 * A day's statuses come from the register's own reckoning (`attendanceRegister`), and a range's
 * totals from the Attendance Dashboard's (`attendanceOverview`), so Nebula and the screen agree on
 * what "present" and "absent" mean, day by day and over a week. Nothing personal beyond the day itself leaves here: no selfie, no
 * location, no device.
 */

const APPROVAL = { module: "HRM", feature: "Attendance Approval" };
const MAX_DAYS_BACK = 31;
const MAX_PEOPLE = 30;

/*
 * One day's register, kept a minute. Every attendance question - and every person who may only see
 * their own day - would otherwise rebuild the whole studio's register: its roster, sessions, leave
 * and holidays. A minute old is fresh enough for "who is in"; scope is applied after, per asker.
 */
const REGISTER_TTL_MS = 60 * 1000;
const registerCache = new Map();
function registerFor(day) {
  const key = day.toISOString().slice(0, 10);
  const held = registerCache.get(key);
  if (held && Date.now() - held.at < REGISTER_TTL_MS) return held.promise;
  const promise = attendance.attendanceRegister(day, {}).catch((error) => { registerCache.delete(key); throw error; });
  registerCache.set(key, { at: Date.now(), promise });
  return promise;
}

// A name on one line, as it reaches the model - never a line break inside somebody's name.
const oneLine = (value) => String(value || "").replace(/\s+/g, " ").trim();

/** The day asked for: today unless a past day within the window is named; never the future. */
function dayFor(asked) {
  const today = calendarDay(new Date());
  if (!asked) return { day: today };
  if (typeof asked !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return { day: today };
  const day = calendarDay(asked);
  if (!day || day > today) return { error: "Attendance is only known for today and the days before it." };
  if ((today - day) / 86400000 > MAX_DAYS_BACK) return { error: `Attendance can be asked about for the last ${MAX_DAYS_BACK} days.` };
  return { day };
}

/** The names a question is about, from a string or a list - bounded, trimmed. */
function namesFrom(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/,|\band\b/i);
  return list.map((name) => String(name || "").trim()).filter((name) => name.length >= 2).slice(0, 10);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const shiftDays = (date, days) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

/**
 * A range in the question's own words, or null: "last 5 working days", "last week", "this week",
 * "past 7 days", "from 28 sep to 2 oct". Read here rather than left to the model, which given "the
 * last five working days" counted nothing at all and reported figures it never had.
 */
function rangeIn(text) {
  const asked = String(text || "").toLowerCase();
  const count = (word) => Number(word) || NUMBERS[word] || 0;
  let match = asked.match(/\b(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+working\s+days?\b/);
  if (match) return { workingDays: count(match[1]) };
  match = asked.match(/\b(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)\s+days?\b/);
  if (match) return { lastDays: count(match[1]) };
  if (/\blast week\b/.test(asked)) return { week: "last" };
  if (/\bthis week\b/.test(asked)) return { week: "this" };
  match = asked.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s*(?:to|till|until|-|and)\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/);
  if (match) {
    const year = new Date().getUTCFullYear();
    const iso = (day, month) => localIsoDate(new Date(Date.UTC(year, MONTHS[month], Number(day))));
    return { from: iso(match[1], match[2]), to: iso(match[3], match[4]) };
  }
  return null;
}

/**
 * The span a lookup covers, from its arguments: one day (`date`), or a range (`from`/`to`,
 * `workingDays`, `lastDays`, `week`) - always inside the last 31 days, never in the future.
 * Working days are the studio's own: its weekly offs and holidays (`readSettings`, the holiday
 * calendar), the calendar the register and the Dashboard use. A range ends at the last finished day.
 */
async function spanFor(args = {}) {
  const span = await spanAsked(args);
  if (!span || span.error) return span;
  /*
   * How many working days the span holds - said beside each person's totals, so the days that are
   * none of present, absent or on leave (a login never logged out) are a figure, not a gap the
   * model fills: given "absent 4" of five days it reported the fifth as present.
   */
  const [settings, holidayDates] = await Promise.all([attendance.readSettings(), attendance.holidayDateSet(span.from, span.to)]);
  // Nothing before attendance starts being counted is owed, as on the register and the Dashboard.
  const goLive = attendanceStartIso(settings);
  span.workingDays = eachDateInRange(span.from, span.to)
    .filter((iso) => (!goLive || iso >= goLive) && dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING).length;
  return span;
}

async function spanAsked(args = {}) {
  const today = calendarDay(new Date());
  const earliest = shiftDays(today, -MAX_DAYS_BACK);
  const yesterday = shiftDays(today, -1);
  const wanted = Number(args.workingDays) || 0;
  if (wanted) {
    const [settings, holidayDates] = await Promise.all([attendance.readSettings(), attendance.holidayDateSet(earliest, yesterday)]);
    const goLive = attendanceStartIso(settings);
    const working = eachDateInRange(earliest, yesterday).filter((iso) => (!goLive || iso >= goLive) && dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING);
    const picked = working.slice(-Math.min(wanted, MAX_DAYS_BACK));
    if (!picked.length) return { error: "There are no working days in the last month to count." };
    return { from: calendarDay(picked[0]), to: calendarDay(picked[picked.length - 1]), lastWorkingDays: picked.length };
  }
  if (Number(args.lastDays)) {
    const days = Math.min(Number(args.lastDays), MAX_DAYS_BACK);
    return { from: shiftDays(yesterday, -(days - 1)), to: yesterday };
  }
  if (args.week === "this" || args.week === "last") {
    const monday = shiftDays(today, -((today.getUTCDay() + 6) % 7));
    return args.week === "this" ? { from: monday, to: today } : { from: shiftDays(monday, -7), to: shiftDays(monday, -1) };
  }
  if (args.from || args.to) {
    const from = calendarDay(String(args.from || args.to));
    const to = calendarDay(String(args.to || args.from));
    if (!from || !to || to < from) return { error: "That range could not be read - give a start and an end day." };
    if (to > today) return { error: "Attendance is only known for today and the days before it." };
    if (from < earliest) return { error: `Attendance can be asked about for the last ${MAX_DAYS_BACK} days.` };
    return { from, to };
  }
  return null;
}

/** A person's day as Nebula may say it: name and status, the times at most. */
function personDay(row) {
  return {
    name: oneLine(row.employeeName),
    status: oneLine(row.status),
    checkedInAt: row.checkInAt || null,
    checkedOutAt: row.checkOutAt || null,
  };
}

function countsOf(rows) {
  const count = (predicate) => rows.filter(predicate).length;
  return {
    total: rows.length,
    present: count((row) => row.attended),
    late: count((row) => row.status === "Late"),
    absent: count((row) => row.status === "Absent"),
    onLeave: count((row) => row.status === "On leave"),
  };
}

/**
 * Whose attendance this person may see - rules 2 to 4: themself; and, with Attendance Approval,
 * the employees within that grant's scope. `ids` null means everybody (an unlimited scope).
 */
async function reachOf(userId) {
  const self = await dataScope.selfIds(userId);
  const readsOthers = await iamService.hasPermission(userId, APPROVAL.module, APPROVAL.feature, "READ");
  if (!readsOthers) return { self, readsOthers, ids: self.employeeId ? [self.employeeId] : [] };
  const scope = await dataScope.resolve({ userId, ...APPROVAL, columns: EMPLOYEE_SCOPE_COLUMNS, level: "READ" });
  if (scope.unlimited) return { self, readsOthers, ids: null };
  // Never anybody ticked Exclude From Attendance: the assistant does not name them in attendance either.
  const ids = (await prisma.employee.findMany({ where: { AND: [scope.where, { excludeFromAttendance: false }] }, select: { id: true } })).map((row) => row.id);
  if (self.employeeId && !ids.includes(self.employeeId)) ids.push(self.employeeId);
  return { self, readsOthers, ids };
}

/**
 * The people a piece of text names, among those this person may see - matched on the employees'
 * own names (the full name, or a first name of three letters or more, as a whole word), rather than
 * guessed from which words look unusual: that guess kept three words of "I need to know the last
 * five working days records of Mukesh" and none of them was Mukesh.
 */
async function namedIn(text, reach) {
  const said = ` ${String(text || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  if (!said.trim()) return [];
  const employees = await prisma.employee.findMany({
    where: { excludeFromAttendance: false, ...(reach.ids ? { id: { in: reach.ids } } : {}) },
    select: { employeeName: true },
    take: 2000,
  });
  const names = [];
  for (const { employeeName } of employees) {
    const full = String(employeeName || "").toLowerCase().replace(/\s+/g, " ").trim();
    const first = full.split(" ")[0] || "";
    if (full && (said.includes(` ${full} `) || (first.length >= 3 && said.includes(` ${first} `)))) names.push(employeeName);
  }
  return [...new Set(names)].slice(0, 10);
}

/**
 * A range: each named person's totals over it, as the Attendance Dashboard counts them
 * (`attendanceOverview`) - only for people within reach, found by name among them.
 */
async function rangeTotals(span, asked, userId, mentionedIn) {
  const reach = await reachOf(userId);
  const wanted = [...new Set([...asked, ...await namedIn(mentionedIn, reach)])];
  const nameWhere = wanted.length ? { OR: wanted.map((name) => ({ employeeName: { contains: name } })) } : {};
  const found = await prisma.employee.findMany({
    where: { ...nameWhere, excludeFromAttendance: false, ...(reach.ids ? { id: { in: reach.ids } } : {}) },
    select: { id: true, employeeName: true },
    take: 200,
  });
  const ids = found.map((row) => row.id);
  const overview = ids.length ? await attendance.attendanceOverview(span.from, span.to, { employeeIds: ids }) : { employees: [] };
  const rows = overview.employees || [];
  /*
   * Nobody named: totals for everyone within reach, and no one person's line - so a question about
   * somebody out of reach is never answered with a colleague's figures listed beside it.
   */
  const sum = (field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const aggregate = wanted.length ? null : { people: rows.length, present: sum("present"), absent: sum("absent"), onLeave: sum("onLeave"), late: sum("late") };
  const people = wanted.length ? rows.slice(0, MAX_PEOPLE).map((row) => ({
    name: oneLine(row.employeeName),
    present: row.present,
    absent: row.absent,
    onLeave: row.onLeave,
    late: row.late,
    // Working days that are none of the three - an Incorrect login, a day not yet judged.
    neither: Math.max(0, (span.workingDays || 0) - (Number(row.present) || 0) - (Number(row.absent) || 0) - (Number(row.onLeave) || 0)),
  })) : [];
  return {
    aggregate,
    from: localIsoDate(span.from),
    to: localIsoDate(span.to),
    workingDays: span.workingDays || 0,
    lastWorkingDays: span.lastWorkingDays || null,
    reach: reach.readsOthers ? "the people you may see" : "only your own attendance",
    people,
    notFound: wanted.filter((name) => !people.some((person) => person.name.toLowerCase().includes(name.toLowerCase()))),
  };
}

async function execute(args, session) {
  const userId = Number(session?.userId);
  const wantedNames = namesFrom(args?.names);

  // Rule 5, for a range: the span, or a plain reason it cannot be read.
  const span = await spanFor(args || {});
  if (span?.error) return { error: span.error };
  if (span) return rangeTotals(span, wantedNames, userId, args?.mentionedIn);

  const when = dayFor(args?.date);
  if (when.error) return { error: when.error };

  // Rules 2-4: who this person may see.
  const reach = await reachOf(userId);
  const { self, readsOthers } = reach;
  const register = await registerFor(when.day);
  const everyone = Array.isArray(register?.rows) ? register.rows : [];

  // Without Attendance Approval, yourself alone; with it, those within its scope (null: everybody).
  const allowed = reach.ids ? new Set(reach.ids) : null;
  const visible = everyone.filter((row) => (allowed ? allowed.has(row.employeeId) : true)
    && (readsOthers || (self.employeeId && row.employeeId === self.employeeId)));

  const wanted = [...new Set([...wantedNames, ...await namedIn(args?.mentionedIn, reach)])];
  const named = wanted.length
    ? visible.filter((row) => wanted.some((name) => String(row.employeeName || "").toLowerCase().includes(name.toLowerCase())))
    : [];

  return {
    date: register?.date || null,
    // Said, so the answer can say it: a person without rule 3 sees only their own day.
    reach: readsOthers ? "the people you may see" : "only your own attendance",
    counts: countsOf(visible),
    // Named people the question asked about, as far as they are visible - never more than a page.
    people: named.slice(0, MAX_PEOPLE).map(personDay),
    // Names asked about that are not among the visible - not found, or not this person's to see.
    notFound: wanted.filter((name) => !named.some((row) => String(row.employeeName || "").toLowerCase().includes(name.toLowerCase()))),
  };
}

const TOOLS = [
  {
    name: "attendance.getDay",
    module: "ATTENDANCE",
    risk: "READ",
    description:
      "Who is present, late, absent or on leave - on one day (today unless a date is given), or over "
      + "a range (from/to, or the last N working days) as each person's totals - for the people the "
      + "user may see. Pass names to ask about particular people.",
    schema: {
      type: "object",
      properties: {
        names: { type: "string", description: "People's names, comma separated, to ask about. Leave empty for the counts." },
        date: { type: "string", description: "One day, YYYY-MM-DD; defaults to today. Only today or the last 31 days." },
        from: { type: "string", description: "A range's first day, YYYY-MM-DD, within the last 31 days." },
        to: { type: "string", description: "A range's last day, YYYY-MM-DD; not in the future." },
        workingDays: { type: "integer", description: "The last N working days (the studio's weekly offs and holidays excluded), up to 31." },
      },
    },
    /*
     * Gathered before the model answers, but only for a question about attendance - every other
     * question in every module would otherwise pay for the whole studio's register.
     */
    summary: true,
    // Or a follow-up to one ("and yesterday?"), as the classifier decided.
    summaryWhen: (asked, intent) => ATTENDANCE_WORDS.test(String(asked || "")) || Boolean(intent?.aboutAttendance),
    // The people the question - or the turn before it, for "how many of them" - names.
    prefetchArgs: ({ asked, priorTurns = [] }) => {
      const recent = priorTurns.slice(-2).map((turn) => String(turn?.content || "")).join(" ");
      return {
        // The question and the turn before it, matched against the names of people within reach.
        mentionedIn: `${asked} ${recent}`,
        // A range the question names - "the last five working days" - read here, not guessed later.
        ...(rangeIn(asked) || {}),
      };
    },
    execute,
    // One fact per line, the way every summary here is rendered.
    renderSummary: (result) => {
      if (result.error) return `## Attendance\n${result.error}`;
      if (result.from) {
        // A range: each person's totals, one figure per line beneath their name.
        const span = result.lastWorkingDays ? `the last ${result.lastWorkingDays} working days, ${result.from} to ${result.to}` : `${result.from} to ${result.to}`;
        const people = result.people.flatMap((person) => [
          `${person.name}:`,
          `- Working days: ${result.workingDays}`,
          `- Present: ${person.present}`,
          `- Absent: ${person.absent}`,
          `- On leave: ${person.onLeave}`,
          `- Neither present, absent nor on leave (for example a login never logged out): ${person.neither}`,
          `- Late (counted within present): ${person.late}`,
        ]);
        const together = result.aggregate ? [
          `Totals for everyone you may see (${result.aggregate.people} people) - not any one person's:`,
          `- Present days: ${result.aggregate.present}`,
          `- Absent days: ${result.aggregate.absent}`,
          `- On leave days: ${result.aggregate.onLeave}`,
          `- Late days: ${result.aggregate.late}`,
        ] : [];
        return [`## Attendance over ${span} (${result.reach})`, ...together, ...(people.length || together.length ? people : ["Nobody by that name within reach."]),
          ...(result.notFound.length ? [`Not found: ${result.notFound.join(", ")}`] : [])].join("\n");
      }
      const lines = [
        `## Attendance on ${result.date} (${result.reach})`,
        `Present: ${result.counts.present}`,
        `Late: ${result.counts.late}`,
        `Absent: ${result.counts.absent}`,
        `On leave: ${result.counts.onLeave}`,
        `People counted: ${result.counts.total}`,
      ];
      if (result.people.length) lines.push("", "Named people:", ...result.people.map((person) => `- ${person.name}: ${person.status}`));
      return lines.join("\n");
    },
    /*
     * The same page in a briefing: what was asked about is named people's days and totals, and a
     * one-line brief dropped exactly those - "0 people counted" - when HRM's summary sat beside it.
     */
    renderBrief: (result) => TOOLS[0].renderSummary(result),
  },
];

module.exports = { TOOLS, ATTENDANCE_WORDS, dayFor, namesFrom, rangeIn, spanFor, clearRegisterCache: () => registerCache.clear() };
