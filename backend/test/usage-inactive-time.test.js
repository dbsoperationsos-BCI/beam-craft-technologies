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
    /measuredUsage\(\{ from: clean\.from, to: clean\.to, context: "app", scope, employees \}\)/,
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
  // The studio's day, not the UTC one - see studio-day.test.js for what that means.
  assert.match(measured, /\$\{studioDaySql\("`s`\.`started_at`"\)\} AS `day`/, "the inner query no longer groups by the studio's day");
  assert.match(measured, /GROUP BY `employee`, `u`\.`id`, `day`/, "the span is no longer taken per day");
  // The span itself: first start to last end, within that day - the fallback for a day with no
  // sign-in line.
  assert.match(measured, /TIMESTAMPDIFF\(SECOND, MIN\(`s`\.`started_at`\), MAX\(`s`\.`ended_at`\)\) AS `spanSeconds`/);
  // And the days are summed by `measuredTotals`, with the sign-in lines beside them, so a range of
  // many days adds their idle time rather than spanning it.
  assert.match(measured, /measuredTotals\(\{ dayRows, authRows, now \}\)/);
  assert.match(measured, /`l`\.`action` IN \('Login', 'Logout'\)/, "the sign-in lines are no longer read");
});

test("idle is the signed-in time less the time actually used, per day, and never negative", () => {
  // A day signed in and used for all of it has no idle time - and clamping is what keeps a rounding
  // error, an overlapping stretch or use outside the signed-in time from reading as negative idle.
  const signedIn = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-reports", "signedIn.js"), "utf8");
  assert.match(signedIn, /const span = signedIn === null \? used\.spanSeconds : signedIn;/, "a day with no sign-in line no longer falls back to its span of use");
  assert.match(signedIn, /entry\.inactiveSeconds \+= Math\.max\(0, span - used\.seconds\)/, "the idle figure is no longer signed-in less used, clamped at zero");
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

test("Application Usage lists everybody who used the application, not only those with CRM activity", () => {
  /*
   * Its CRM counts come from the lead activity log, which only the sales team writes - so on its own
   * the report listed them alone. The measured time is everybody's, read as a list narrowed to the
   * reader's people and the employee filter, the way Work Hours lists them.
   */
  assert.match(applicationUsage, /const usageOnly = \[\.\.\.measured\.entries\(\)\]/);
  assert.match(applicationUsage, /employee, actions: 0, leads: 0, created: 0, updates: 0, statusChanges: 0, remarks: 0,/);
  assert.match(applicationUsage, /\[\.\.\.crmRows, \.\.\.usageOnly\]/);
  const measured = sql(SERVICE.slice(SERVICE.indexOf("async function measuredUsage"), SERVICE.indexOf("function usageFrom")));
  // Narrowed by the reader's scope on the login the time was measured against, as Work Hours is -
  // on the joined `user` row, which the stretches and the sign-in lines share.
  assert.match(measured, /scope\.sql\(\{ user: "`u`\.`id`", branch: "`u`\.`branch_id`" \}\)/);
});

test("Application Usage lists every active employee - 0m for one who did not use it - and nobody else", () => {
  const active = sql(SERVICE.slice(SERVICE.indexOf("async function activeEmployeesForUsage"), SERVICE.indexOf("async function applicationUsage")));
  // Still working: not archived, a working employment status - and narrowed to the reader's people.
  assert.match(active, /"`e`\.`archived_at` IS NULL", `?`e`\.`employment_status` IN/);
  assert.match(active, /scope\.sql\(\{ employee: "`e`\.`id`", user: "`u`\.`id`", branch: "`e`\.`branch_id`" \}\)/);
  // Those who used it, then everyone else active with a zero row.
  assert.match(applicationUsage, /const used = \[\.\.\.crmRows, \.\.\.usageOnly\]\.filter\(\(row\) => activeNames\.has/);
  assert.match(applicationUsage, /\.\.\.usageFrom\(null\),/);
  assert.match(applicationUsage, /rows: \[\.\.\.used, \.\.\.notUsed\]/);
});
