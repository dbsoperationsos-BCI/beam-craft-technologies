import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPORTS, reportById, EMPTY_FILTERS, hasFilters, describeRange, filterSummary, defaultRange, studioToday, dateTime, dateOnly, totalsSummary, USAGE_REPORTS, ignoredNote, usageSeconds, clockTime, reportRowId } from "../src/lib/crmReports.js";

/** The server's own report table, read as text - these two registries have to name the same things. */
const REPORT_SERVICE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", "src", "modules", "sales", "crm-reports", "service.js"),
  "utf8",
);

/*
 * What each CRM report shows, and what its filter bar says it is showing.
 *
 * The columns are declared once and read by the table, the sorting and the CSV export alike, so the
 * file somebody exports is the table that was on screen. These pin down that shape, and the two
 * things the page says out loud: which range a report covers, and which filters produced it.
 */

/** A report's columns that carry a heading - everything but the menu column at the end. */
const named = (report) => report.columns.filter((column) => column.id !== "actions").map((column) => column.label);

/*
 * The table's Manage Columns, CSV export and compact toggle live in the head of a column whose id
 * is exactly `actions`. Without one they render nowhere, which is what every report here was doing:
 * the features were switched on and the control that reaches them did not exist.
 */
test("every report carries the column that holds the table's own menu", () => {
  for (const report of REPORTS) {
    const actions = report.columns.find((column) => column.id === "actions");
    assert.ok(actions, `${report.id} has no actions column, so its ⋮ menu cannot render`);
    assert.equal(actions.label, "", "its head is the menu itself, so it carries no heading");
    assert.equal(actions.sortable, false);
    assert.equal(actions.filterable, false);
    assert.equal(report.columns.at(-1).id, "actions", "and it belongs at the end");
  }
});

/*
 * The fault that produced a column of numbers with no heading over it.
 *
 * Application Usage counted what somebody did and called the column `actions` - the exact id the
 * table reserves for its own menu. `DataTable` swapped that head for the ⋮ and centred it, so the
 * word "Actions" vanished while the numbers stayed. A data column may never take that id.
 */
test("no report gives a data column the id the table reserves for its menu", () => {
  for (const report of REPORTS) {
    const reserved = report.columns.filter((column) => column.id === "actions");
    assert.equal(reserved.length, 1, `${report.id} must have exactly one column with the reserved id`);
    assert.equal(reserved[0].label, "", `${report.id} gave a data column the id "actions"; its heading would be eaten`);
  }
});

test("every other column does carry a heading", () => {
  for (const report of REPORTS) {
    for (const label of named(report)) assert.ok(label && label.trim(), `${report.id} has a column with no heading`);
  }
});

test("there are nine reports, each with an id, a label and columns", () => {
  assert.equal(REPORTS.length, 9);
  assert.deepEqual(REPORTS.map((entry) => entry.id), [
    "summary", "employee-analysis", "lead-analysis", "never-attended", "not-picked-up", "call-history",
    "whatsapp-usage", "application-usage", "work-hours",
  ]);
  for (const entry of REPORTS) {
    assert.ok(entry.label, `${entry.id} needs a label for its tab`);
    assert.ok(entry.emptyMessage, `${entry.id} needs something to say when it is empty`);
    assert.ok(entry.columns.length > 0, `${entry.id} needs columns`);
  }
});

test("every column can produce its own value, for sorting and for the CSV alike", () => {
  // A column with no `value` would export blank while showing something, which is the export
  // nobody notices is wrong until they are reading it in a spreadsheet.
  for (const entry of REPORTS) {
    for (const column of entry.columns) {
      assert.equal(typeof column.value, "function", `${entry.id}.${column.id} has no value()`);
      if (column.id !== "actions") assert.ok(column.label, `${entry.id}.${column.id} has no label`);
    }
  }
});

test("no report declares the same column twice", () => {
  for (const entry of REPORTS) {
    const ids = entry.columns.map((column) => column.id);
    assert.equal(new Set(ids).size, ids.length, `${entry.id} repeats a column id`);
  }
});

/*
 * A recording is the client's own voice. The report says whether one exists; it must not carry the
 * URL, because a report is exported to a file and emailed around.
 */
test("call history reports that a recording exists, never where it is", () => {
  const history = reportById("call-history");
  const recording = history.columns.find((column) => column.id === "hasRecording");
  assert.equal(recording.value({ hasRecording: true }), "Yes");
  assert.equal(recording.value({ hasRecording: false }), "No");
  assert.ok(!history.columns.some((column) => column.id === "recordingUrl"), "no column may carry the URL");
});

test("an unknown report falls back to one the page can render", () => {
  assert.equal(reportById("summary").id, "summary");
  assert.equal(reportById("nonsense").id, "summary");
  assert.equal(reportById(undefined).id, "summary");
});

/* ------------------------------------------------------------------ the range */

test("a report opens on the last thirty days, ending today", () => {
  const range = defaultRange(new Date("2026-08-31T10:00:00Z"));
  assert.equal(range.to, "2026-08-31");
  assert.equal(range.from, "2026-08-02", "thirty days inclusive of both ends");
});

/*
 * The studio's day, not the server's. A report opened at half past midnight IST is today's; a UTC
 * server would call it yesterday and show a day of calls nobody made yet.
 */
test("the range is the studio's day", () => {
  assert.equal(studioToday(new Date("2026-08-31T19:30:00Z")), "2026-09-01", "past midnight in India");
  assert.equal(studioToday(new Date("2026-08-31T18:00:00Z")), "2026-08-31");
});

test("a range is described the way it would be read aloud", () => {
  assert.equal(describeRange({ from: "2026-08-01", to: "2026-08-31" }), "1 Aug 2026 to 31 Aug 2026");
  assert.equal(describeRange({ from: "2026-08-31", to: "2026-08-31" }), "31 Aug 2026", "one day is not a range");
  assert.equal(describeRange({ from: "2026-08-01" }), "From 1 Aug 2026");
  assert.equal(describeRange({ to: "2026-08-31" }), "Up to 31 Aug 2026");
  assert.equal(describeRange({}), "All dates");
});

/* ---------------------------------------------------------------- the filters */

test("only the filters beyond the range count as filtering", () => {
  // Every report has a range, so counting it would leave Reset permanently enabled.
  assert.equal(hasFilters({ ...EMPTY_FILTERS, ...defaultRange() }), false);
  assert.equal(hasFilters({ ...EMPTY_FILTERS, vertical: "Corp" }), true);
});

/*
 * The line that says what the numbers on screen were built from - which is not always what the
 * filter bar holds, since somebody halfway through changing the dates has not pressed Apply.
 */
test("the summary names the filters in the reader's own words", () => {
  const options = {
    employees: [{ value: "9876500000", label: "Priya S" }],
    durations: [{ value: "1to5", label: "1 to 5 minutes" }],
  };
  assert.equal(
    filterSummary({ from: "2026-08-01", to: "2026-08-31", employee: "9876500000", vertical: "Corp", callType: "Incoming", duration: "1to5" }, options),
    "Showing: 1 Aug 2026 to 31 Aug 2026 · Priya S · Corp · Incoming · 1 to 5 minutes",
  );
  // An employee whose number is not in the list is named by the number rather than dropped.
  assert.match(filterSummary({ employee: "9000000000" }, options), /9000000000/);
  assert.equal(filterSummary({ ...EMPTY_FILTERS }, options), "Showing: All dates");
});

/* ------------------------------------------------------------------- the dates */

test("a missing or unreadable date shows as nothing, never as Invalid Date", () => {
  assert.equal(dateTime(null), "");
  assert.equal(dateTime(""), "");
  assert.equal(dateTime("not a date"), "");
  assert.equal(dateOnly(null), "");
  assert.equal(dateOnly("not a date"), "");
});

test("a plain day is read as that day, not shifted by the browser's zone", () => {
  // "2026-08-31" parsed as local time lands on the 30th west of UTC, which is how a report's dates
  // start disagreeing with the dates that produced them.
  assert.equal(dateOnly("2026-08-31"), "31 Aug 2026");
});

test("a timestamp is read on the twelve-hour clock, in the studio's own zone", () => {
  // 12:28 UTC is 17:58 in Delhi. The report says so as the studio says it - "5:58 pm" - rather
  // than on the twenty-four hour clock these columns used to print.
  assert.equal(dateTime("2026-09-02T12:28:00Z"), "2 Sept 2026, 5:58 pm");
  // The hour is not padded: five in the evening is "5:58 pm", never "05:58 pm".
  assert.ok(!dateTime("2026-09-02T12:28:00Z").includes("05:58"));
  // Midnight and noon are the two the twelve-hour clock gets wrong when it is rolled by hand.
  assert.equal(dateTime("2026-09-02T18:35:00Z"), "3 Sept 2026, 12:05 am");
  assert.equal(dateTime("2026-09-02T06:30:00Z"), "2 Sept 2026, 12:00 pm");
});

test("a timestamp is filed on the studio's day, whatever zone the browser is in", () => {
  /*
   * 20:00 UTC on the 2nd is 01:30 on the 3rd in Delhi. The range these reports are built from is
   * the studio's day, so the cell has to agree with it - read in the browser's zone, a call made
   * after midnight IST would be printed against the day before the one it belongs to.
   */
  assert.equal(dateTime("2026-09-02T20:00:00Z"), "3 Sept 2026, 1:30 am");
});

/* ------------------------------------------------------------------ the totals */

/*
 * The Summary's totals were a row of cards above its table, reading a field the table did not - so
 * the cards said nine calls over a table reporting none. They are one line in the table's own
 * footer now, and the Summary is a table like the other five.
 */
test("the summary is a table like every other report", () => {
  const summary = reportById("summary");
  assert.ok(summary.columns.some((column) => column.id === "day"), "a row a day");
  assert.ok(summary.columns.some((column) => column.id === "calls"));
  assert.ok(summary.columns.some((column) => column.id === "totalDuration"));
});

test("the range totals read as one line", () => {
  assert.equal(
    totalsSummary({ calls: 15, connected: 10, clients: 11, leads: 11, totalDuration: "13m 29s", averageDuration: "1m 21s" }),
    "15 calls · 10 connected · 11 clients · 11 leads · 13m 29s talk time · 1m 21s average",
  );
});

test("one of a thing is not pluralised, and nothing is not a crash", () => {
  assert.match(totalsSummary({ calls: 1, connected: 1, clients: 1, leads: 1 }), /^1 call · 1 connected · 1 client · 1 lead$/);
  assert.equal(totalsSummary({}), "0 calls · 0 connected · 0 clients · 0 leads");
  assert.equal(totalsSummary(), "0 calls · 0 connected · 0 clients · 0 leads");
});

/* ------------------------------------------------------------- call history */

/*
 * The columns a call report is read in. Their order is the order the question is asked - who
 * called, who they called, how many times, when, for how long - so it is worth pinning down.
 */
test("call history leads with the employee and the lead", () => {
  const history = reportById("call-history");
  assert.deepEqual(named(history).slice(0, 10), [
    "Employee", "Lead Name", "Lead Number", "No of Attempts", "Call Time",
    "Duration", "Call Type", "Lead Created Date", "Lead Status", "Notes",
  ]);
});

/* ----------------------------------------------------------- usage reports */

/*
 * These read the ERP user's own work, not the Callyzer employee's calls. The two are different
 * people-lists and are deliberately not joined, so the reports that use each are named apart.
 */
test("the usage reports are marked as reading a different thing", () => {
  assert.equal(USAGE_REPORTS.has("whatsapp-usage"), true);
  assert.equal(USAGE_REPORTS.has("application-usage"), true);
  assert.equal(USAGE_REPORTS.has("call-history"), false);
  assert.equal(USAGE_REPORTS.has("summary"), false);
});

test("whatsapp usage counts both directions and what they were sent about", () => {
  const labels = named(reportById("whatsapp-usage"));
  assert.deepEqual(labels, [
    "Employee", "Messages", "Usage", "Sent", "Received", "Leads Messaged", "Attachments",
    "Calls", "Call Time", "First Message", "Last Message",
  ]);
});

/*
 * WhatsApp is two things here: the messages this application sends, and the calls Callyzer reports
 * with `call_method = 'WhatsAppCall'`. Both are WhatsApp use, so both are counted - and the call
 * columns are named as calls, because the two halves are matched by name across two identities and
 * a reader should be able to see which half a number came from.
 */
test("whatsapp usage counts the calls beside the messages", () => {
  const calls = reportById("whatsapp-usage").columns.find((column) => column.id === "calls");
  const time = reportById("whatsapp-usage").columns.find((column) => column.id === "callTime");
  assert.equal(calls.label, "Calls");
  assert.equal(time.label, "Call Time");
  // Sorted on the seconds, so "9m" files below "1h 04m" rather than alphabetically above it.
  assert.equal(time.value({ callSeconds: 3840, callTime: "1h 04m" }), 3840);
  assert.equal(time.value({}), 0);
  assert.equal(time.render({}), "0m", "somebody who made no calls reads as none, not as blank");
});

/*
 * Usage is time on task - how long somebody actually spent on the thing - not a count and not a
 * share. Both usage reports carry it, and both take the same measure so they can be read together.
 */
test("both usage reports carry time on task", () => {
  for (const id of ["whatsapp-usage", "application-usage"]) {
    const column = reportById(id).columns.find((entry) => entry.id === "usage");
    assert.ok(column, `${id} has no Usage column`);
    assert.equal(column.label, "Usage");
  }
});

test("usage sorts by its seconds, so 46m files below 2h 53m", () => {
  // Sorting the words would put "2h 53m" above "46m" alphabetically, which is the wrong way round.
  assert.equal(usageSeconds({ usageSeconds: 2754, usage: "46m" }), 2754);
  assert.equal(usageSeconds({ usageSeconds: 10406, usage: "2h 53m" }), 10406);
  assert.ok(usageSeconds({ usageSeconds: 10406 }) > usageSeconds({ usageSeconds: 2754 }));
  assert.equal(usageSeconds({}), 0);
  assert.equal(usageSeconds(), 0);
});

test("a row with no usage still renders something", () => {
  const column = reportById("whatsapp-usage").columns.find((entry) => entry.id === "usage");
  assert.equal(column.render({}), "0m");
  assert.equal(column.render({ usage: "2h 53m" }), "2h 53m");
});

test("application usage counts what was done, with the sign-in beside it rather than instead", () => {
  const labels = named(reportById("application-usage"));
  assert.ok(labels.includes("Actions"), "opening the page is not using it; changing a lead is");
  assert.ok(labels.includes("Leads Worked"));
  assert.ok(labels.includes("Last Sign-in"));
});

/*
 * A filter that is set and quietly not applied is worse than one that is not offered, so the page
 * says which of them this report could not honour.
 */
test("the ignored filters are named in words, not keys", () => {
  assert.equal(ignoredNote([]), "");
  assert.equal(ignoredNote(["vertical"]), "The vertical filter does not apply to this report.");
  assert.equal(ignoredNote(["vertical", "callType"]), "The vertical and call type filters do not apply to this report.");
  assert.equal(
    ignoredNote(["vertical", "callType", "duration"]),
    "The vertical, call type and duration filters do not apply to this report.",
  );
});


/* ─────────────────────────────────────────────────────────── the two registries agree ── */

test("every tab on this page is a report the server can build", () => {
  /*
   * A tab is written down twice - here, and in `REPORTS` on the server - and nothing joins them.
   * One added to this list alone is a tab that opens onto an error; one added to the server alone is
   * a report nobody can reach. Neither fails until somebody clicks it.
   */
  const registry = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("const REPORTS = {"), REPORT_SERVICE.indexOf("\n};", REPORT_SERVICE.indexOf("const REPORTS = {")));
  for (const entry of REPORTS) {
    // Keys are quoted when they carry a hyphen and bare when they do not, which is how they are
    // written on that side: `summary,` and `"work-hours": workHours,`.
    const named = registry.includes(`"${entry.id}":`) || new RegExp(`^\\s{2}${entry.id},`, "m").test(registry);
    assert.ok(named, `the server has no "${entry.id}" report, so opening that tab answers an error`);
  }
});

/* ──────────────────────────────────────────────────────────────────── work hours ── */

test("Work Hours is a timesheet: a row per person per day", () => {
  const report = reportById("work-hours");
  assert.ok(report, "the Work Hours tab has gone");
  /*
   * Employee *and* Date together is what makes it a timesheet rather than a second Application
   * Usage. Grouped by employee alone it would be one row per person for the whole range, which is
   * the report next to it.
   */
  assert.deepEqual(named(report).slice(0, 2), ["Employee", "Date"]);
  const service = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("async function workHours"), REPORT_SERVICE.indexOf("const REPORTS = {"));
  assert.match(service, /GROUP BY \\`employee\\`, \\`day\\`/);
});

test("Work Hours measures one context, not every context added up", () => {
  /*
   * The contexts run concurrently: the shell beats as "app" for the whole session while the chat
   * panel beats as "whatsapp" alongside it. Summed, a minute in the chat is counted twice - a
   * nine-hour day reads as fourteen, and the idle figure derived from it goes negative.
   */
  const service = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("async function workHours"), REPORT_SERVICE.indexOf("const REPORTS = {"));
  assert.match(service, /`s`\.`context` = 'app'/);
  assert.match(service, /FROM \\`app_usage_session\\`/, "Work Hours is no longer read from the measured usage table");
});

test("Work Hours is Call Hours plus Application Usage, added once, on the server", () => {
  /*
   * The hours column used to be the application alone and it undercounted the job it measured: the
   * people this report is read about spend their day on the phone, and a salesperson on a
   * forty-minute call is not touching the browser - so the browser recorded nothing and the
   * timesheet read that forty minutes as idle.
   *
   * The addition is done once, in the service, so the row cannot disagree with its own two halves.
   */
  const service = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("async function callHoursByDay"), REPORT_SERVICE.indexOf("const REPORTS = {"));
  assert.match(service, /const worked = row\.appSeconds \+ row\.callSeconds;/, "Work Hours is not the two halves added");
  assert.match(service, /FROM \\`sales_crm_call_log\\` AS \\`c\\`/, "the call half no longer comes from the call log");
  assert.match(service, /FROM \\`app_usage_session\\`/, "the application half no longer comes from the measured usage table");

  // Both halves are kept on the row beside the total: a manager reading a short day needs to know
  // which of the two it was short on, and neither can be worked back out from the sum.
  const report = reportById("work-hours");
  const byId = Object.fromEntries(report.columns.map((column) => [column.id, column]));
  for (const id of ["worked", "callHours", "appUsage"]) {
    assert.ok(byId[id], `the Work Hours report no longer shows ${id}`);
  }
  assert.equal(byId.worked.label, "Work Hours");
  assert.equal(byId.callHours.value({ callSeconds: 2400 }), 2400);
  assert.equal(byId.appUsage.value({ appSeconds: 3600 }), 3600);
});

test("a day of calls with the application never opened is still a working day", () => {
  /*
   * The two halves are merged as a full outer join rather than in SQL, and deliberately: a day
   * spent entirely on the phone is a working day, a day in the application with no calls plainly
   * is, and the two tables live behind different readiness guards - one of them being absent must
   * not take the other with it.
   */
  const service = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("async function callHoursByDay"), REPORT_SERVICE.indexOf("const REPORTS = {"));
  assert.match(service, /const existing = byKey\.get\(key\) \|\| \{/, "a call-only day is dropped rather than given a row");
  // And a call log that does not exist is an empty call half rather than a report that fails.
  assert.match(service, /console\.warn\("Unable to read call hours for the work hours report:"/);
});

test("Idle stays the browser's own gaps, and Day Span stays wall clock", () => {
  /*
   * Work Hours is effort across two systems and can exceed the length of the day - a call taken with
   * the application open counts in both halves, because both are true and nothing records which
   * minutes overlapped. So the two columns that are still wall clock have to be measured against the
   * application half rather than against the total:
   *
   *   Idle  the gaps between the *application* stretches. Nothing says which idle minutes were
   *         spent on which call, and a figure guessed at is worse than one plainly the browser's.
   *   Span  first activity to last, across both, and never shorter than the half it contains.
   *
   * Idle is clamped at zero: two tabs, or one account signed in twice, can produce overlapping
   * stretches whose sum exceeds the span they lie in, and a negative idle is unreadable.
   */
  const service = REPORT_SERVICE.slice(REPORT_SERVICE.indexOf("async function callHoursByDay"), REPORT_SERVICE.indexOf("const REPORTS = {"));
  assert.match(service, /const idleSeconds = Math\.max\(0, num\(row\.spanSeconds\) - row\.appSeconds\);/);
  assert.match(service, /Math\.max\(0, Math\.round\(\(row\.lastAt - row\.firstAt\) \/ 1000\), num\(row\.spanSeconds\)\)/, "the span can read as less than the application time inside it");
});

test("the three time columns sort by time, not by the words they print", () => {
  // "46m" files above "2h 53m" on the alphabet, which is the wrong way round on every one of them.
  const report = reportById("work-hours");
  const byId = Object.fromEntries(report.columns.map((column) => [column.id, column]));
  assert.equal(byId.worked.value({ workedSeconds: 3600, worked: "1h 00m" }), 3600);
  assert.equal(byId.callHours.value({ callSeconds: 2760, callHours: "46m" }), 2760);
  assert.equal(byId.appUsage.value({ appSeconds: 840, appUsage: "14m" }), 840);
  assert.equal(byId.idle.value({ idleSeconds: 2760, idle: "46m" }), 2760);
  assert.equal(byId.span.value({ spanSeconds: 10380, span: "2h 53m" }), 10380);
  // And a row with nothing measured sorts as zero rather than as NaN, which sorts nowhere at all.
  assert.equal(byId.worked.value({}), 0);
});

test("Work Hours says which filters it could not honour", () => {
  // It reads the ERP user's measured time, so a vertical, a call type and a duration mean nothing
  // to it. A filter that is set and quietly not applied is worse than one that is not offered.
  assert.ok(USAGE_REPORTS.has("work-hours"));
  assert.equal(ignoredNote(["vertical", "duration"]), "The vertical and duration filters do not apply to this report.");
});

test("the two ends of a day are printed as a clock time, in the studio's zone", () => {
  /*
   * The date is already a column of its own on that row, so printing it again in Started and
   * Finished would put the same day on the row three times.
   */
  const at = "2026-09-05T12:28:00.000Z";
  assert.equal(clockTime(at), "5:58 pm");
  assert.doesNotMatch(clockTime(at), /2026|Sept/);
  // Blank rather than "Invalid Date" for a day still being worked, or nothing measured at all.
  assert.equal(clockTime(""), "");
  assert.equal(clockTime(null), "");
  assert.equal(clockTime("not a time"), "");
});


/* ────────────────────────────────────────────────────────────────── one key per row ── */

test("two people's rows for the same day are two different rows", () => {
  /*
   * The fault this exists to stop, and it was a real one: the key took the first field that had a
   * value, so on Work Hours - which is grouped by person *and* day - every employee's row for a
   * date came out under that date alone. React was handed twelve rows all keyed `2026-09-02`, which
   * it warns about because it is then free to duplicate or drop them.
   */
  const monday = { employee: "admin", day: "2026-09-02", worked: "8h 10m" };
  const mondayToo = { employee: "Priya S", day: "2026-09-02", worked: "6h 05m" };
  const tuesday = { employee: "admin", day: "2026-09-03", worked: "7h 40m" };
  const keys = [monday, mondayToo, tuesday].map((row, index) => reportRowId(row, index));
  assert.equal(new Set(keys).size, 3, "two rows of the same report share a key");
});

test("a row keeps its identity when the table is re-sorted", () => {
  /*
   * Which is why the index is the last resort rather than the first. Keyed by position, every row
   * would become a different row the moment somebody sorted the column - losing whatever the table
   * was holding against it, and re-rendering all of them.
   */
  const row = { employee: "admin", day: "2026-09-02" };
  assert.equal(reportRowId(row, 0), reportRowId(row, 7));
  // And a row with nothing to identify it at all still gets a key rather than `undefined`.
  assert.equal(reportRowId({}, 4), "4");
  assert.equal(reportRowId({ employee: "  " }, 2), "2", "whitespace is not an identity");
});

test("every report's own rows come out distinct", () => {
  // One representative pair per report, shaped the way that report's rows are - so a report added
  // later without a key of its own is caught here rather than in the browser console.
  const pairs = [
    [{ day: "2026-09-02" }, { day: "2026-09-03" }],
    [{ employee: "admin" }, { employee: "Priya S" }],
    [{ clientNumber: "+919000000001" }, { clientNumber: "+919000000002" }],
    [{ id: "call-1" }, { id: "call-2" }],
    [{ employee: "admin", day: "2026-09-02" }, { employee: "Priya S", day: "2026-09-02" }],
  ];
  for (const [first, second] of pairs) {
    assert.notEqual(reportRowId(first, 0), reportRowId(second, 1));
  }
});
