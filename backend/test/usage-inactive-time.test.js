const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Inactive Time Track: how long somebody was signed in and not using the application.
 *
 * A stretch of use ends when they stop touching anything for the usage timeout, and a new one
 * begins when they come back - so the gaps between a day's stretches are the idle time, and that is
 * the span of the day's use minus the time actually spent in it.
 *
 * Two things make that arithmetic right, and both are easy to undo by accident. They are read out
 * of the SQL, the way this module's other tests read SQL, so they run with no MySQL.
 */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-reports", "service.js"),
  "utf8",
);

const applicationUsage = SERVICE.slice(
  SERVICE.indexOf("async function applicationUsage"),
  SERVICE.indexOf("function hoursMinutes"),
);

test("Application Usage measures one context, because the two run at the same time", () => {
  /*
   * `AppShell` beats as "app" for the whole session and the chat panel beats as "whatsapp"
   * alongside it while it is open, so an hour in the chat produces an hour in each. Summed, that
   * hour was counted twice - which inflated Usage and broke Inactive worse, since inactive is the
   * span *minus* the active time and too much active subtracts too much.
   *
   * "app" already covers the chat; the shell's heartbeat never stops while the panel is open.
   */
  assert.match(
    applicationUsage,
    /measuredUsage\(\{ from: clean\.from, to: clean\.to, context: "app" \}\)/,
    "Application Usage is summing every context again, which double-counts time spent in the chat panel",
  );
});

// The SQL lives inside template literals, so every backtick in it is escaped. Stripped before
// matching, so these read as the SQL rather than as its escaping.
const sql = (text) => text.replace(/\\/g, "");

test("the idle figure is measured per day, not across the range", () => {
  /*
   * Taken across a month the span would run from the first morning to the last evening and count
   * every night and weekend as idle time. A day is the unit somebody works in, so the span is taken
   * per day and the days are then added up.
   */
  const measured = sql(SERVICE.slice(SERVICE.indexOf("async function measuredUsage"), SERVICE.indexOf("function usageFrom")));
  assert.match(measured, /DATE\(`s`\.`started_at`\) AS `day`/, "the inner query no longer groups by day");
  assert.match(measured, /GROUP BY `employee`, `day`/, "the span is no longer taken per day");
  // The span itself: first start to last end, within that day.
  assert.match(measured, /TIMESTAMPDIFF\(SECOND, MIN\(`s`\.`started_at`\), MAX\(`s`\.`ended_at`\)\) AS `spanSeconds`/);
  // And the days are summed, so a range of many days adds their idle time rather than spanning it.
  assert.match(measured, /SUM\(`spanSeconds`\) AS `spanSeconds`/);
});

test("idle is the span less the time actually used, and never negative", () => {
  // A single unbroken sitting has a span equal to its active time, so its idle time is zero - and
  // clamping is what keeps a rounding error or an overlapping stretch from reading as negative idle.
  assert.match(
    SERVICE,
    /inactiveSeconds: Math\.max\(0, num\(row\.spanSeconds\) - num\(row\.seconds\)\)/,
    "the idle figure is no longer span minus active, clamped at zero",
  );
});

test("both time figures are shown in hours and minutes", () => {
  // `hoursMinutes` is what makes "10h 32m" and "46m"; the seconds go alongside so the column sorts
  // by time rather than by the alphabet.
  assert.match(SERVICE, /inactive: hoursMinutes\(num\(measured\?\.inactiveSeconds\)\)/);
  assert.match(SERVICE, /usage: hoursMinutes\(seconds\)/);

  const columns = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "lib", "crmReports.js"),
    "utf8",
  );
  assert.match(columns, /id: "inactive", label: "Inactive Time Track", value: inactiveSeconds/,
    "the column no longer sorts on the seconds, so 46m would file above 2h 53m");
});
