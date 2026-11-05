const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CONTEXTS, HEARTBEAT_SECONDS, CONTINUES_WITHIN_SECONDS, isContext } = require("../src/modules/usage/heartbeat/service");

/*
 * How a beat becomes a usage figure.
 *
 * The reports used to infer time on task from the gaps between somebody's recorded lead actions,
 * which credited them with every minute spent in another application between two saved leads. It is
 * measured now, and the measurement is only worth anything while three things stay true:
 *
 *   * the browser cannot name the time - otherwise the figure is whatever anybody types into a
 *     console;
 *   * a beat extends the stretch it belongs to rather than creating a row, so a morning's work is
 *     one row rather than a hundred and twenty;
 *   * the tolerance for "still the same stretch" is more than one beat, so a slow request does not
 *     chop one sitting into two, and not so much that a real break is swallowed.
 */

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "usage", "heartbeat", "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "usage", "heartbeat", "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "usage", "heartbeat", "routes.js"), "utf8");

/* -------------------------------------------------------------- the browser cannot lie about when */

test("the beat carries no time; the server stamps it", () => {
  // The one thing that makes this a measurement rather than a number the client chooses. The
  // schema accepts a context and nothing else.
  assert.match(CONTROLLER, /const beatSchema = z\.object\(\{\s*\n\s*context: z\.enum\(CONTEXTS\)\.default\("app"\),\s*\n\}\);/);
  // The body is read once, through that schema, and the schema has one key - so there is nowhere
  // for a time or a duration to arrive.
  assert.equal((CONTROLLER.match(/req\.body/g) || []).length, 1);
  assert.doesNotMatch(CONTROLLER, /recordHeartbeat\([^)]*\bat\b\s*:/, "the request must not be able to name the moment");
  // And the service defaults to its own clock rather than taking one from the caller.
  assert.match(SERVICE, /at = new Date\(\)/);
});

test("a beat is about the caller and nobody else", () => {
  // `req.user.id`, never an id from the request - otherwise one person could bank time against
  // another's name.
  assert.match(CONTROLLER, /recordHeartbeat\(\{ userId: req\.user\.id, context: parsed\.data\.context \}\)/);
  assert.doesNotMatch(CONTROLLER, /req\.body\.userId|req\.query\.userId/);
});

test("recording usage is behind the login and nothing more", () => {
  /*
   * Every signed-in person records that they were using the application, whatever they are allowed
   * to open - gating this on a module permission would leave that person's time uncounted. Reading
   * what it records is the privileged half, and that lives behind the reports.
   */
  assert.match(ROUTES, /router\.use\(protect\);/);
  assert.doesNotMatch(ROUTES, /requireModule|checkPermission/);
});

/* ------------------------------------------------------------------- stretches, not beats */

test("a beat extends the stretch it belongs to rather than writing a row", () => {
  // A row per beat would be a row every half minute per person, for nothing: the question is only
  // ever "how long", and beats are indistinguishable once counted.
  assert.match(SERVICE, /prisma\.appUsageSession\.update\(\{ where: \{ id: open\.id \}, data: \{ endedAt: at \} \}\)/);
});

test("a stretch's end only ever moves forward", () => {
  // Two tabs beat against the same stretch, and a retried or queued beat can arrive out of order.
  // Taking the later of the two means such a beat cannot shorten a stretch that has run past it.
  assert.match(SERVICE, /if \(open\.endedAt >= at\) return open;/);
});

test("a new stretch starts one beat before the beat that opened it", () => {
  /*
   * Otherwise the first beat of every sitting is worth nothing: a stretch would run from its first
   * beat to its last, so somebody who used the application for twenty seconds and left would read
   * as zero. A beat is evidence of the interval behind it, not of an instant.
   */
  assert.match(SERVICE, /const startedAt = new Date\(at\.getTime\(\) - HEARTBEAT_SECONDS \* 1000\);/);
});

test("the tolerance is more than one beat, and not so much that a break is swallowed", () => {
  // Less than two beats and every slow request starts a new stretch; much more and a genuine break
  // is absorbed into the stretch before it, which is the very thing this replaces.
  assert.ok(CONTINUES_WITHIN_SECONDS >= HEARTBEAT_SECONDS * 2, "one hiccup would chop a sitting in two");
  assert.ok(CONTINUES_WITHIN_SECONDS <= HEARTBEAT_SECONDS * 6, "a real break would be counted as work");
});

/* ------------------------------------------------------------------------------ contexts */

test("the context is a closed set", () => {
  // It is written into a column the reports group by, so an unknown value would quietly create a
  // category nothing reads.
  assert.deepEqual(CONTEXTS, ["app", "whatsapp"]);
  assert.equal(isContext("app"), true);
  assert.equal(isContext("whatsapp"), true);
  for (const junk of ["", "APP", "everything", null, undefined, 7]) assert.equal(isContext(junk), false);
});

test("an unrecognised context is recorded as the application rather than refused", () => {
  // The route validates before this is reached, so this is the belt to that braces: a beat is worth
  // keeping as general usage rather than throwing away over a label.
  assert.match(SERVICE, /const kind = isContext\(context\) \? context : "app";/);
});

/* ------------------------------------------------------ and the reports read what was measured */

test("both usage reports read the measured table, not the gaps between actions", () => {
  const reports = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-reports", "service.js"), "utf8");
  assert.match(reports, /FROM \\`app_usage_session\\`/, "usage is no longer measured from the sessions table");
  // The old inference is gone entirely rather than left beside the new measure, where the two
  // would eventually disagree and nobody would know which was on screen.
  assert.doesNotMatch(reports, /IDLE_GAP_SECONDS|SESSION_TAIL_SECONDS|USAGE_COLUMNS/);
  /*
   * Each report asks for one context, and neither asks for all of them.
   *
   * The two run concurrently rather than one after the other: the shell beats as "app" for the
   * whole session and the chat panel beats as "whatsapp" alongside it while it is open, so an hour
   * in the chat produces an hour in each. Summing them counted that hour twice. "app" already
   * covers the chat - the shell's heartbeat never stops while the panel is open - so the
   * application report reads that alone, and the WhatsApp report reads its own to answer the
   * narrower question of how much of the time was spent in the chat.
   */
  // Narrowed to the reader's people like the application report, so neither read is about anyone else.
  assert.match(reports, /measuredUsage\(\{ from: clean\.from, to: clean\.to, context: "whatsapp", scope \}\)/);
  assert.match(reports, /measuredUsage\(\{ from: clean\.from, to: clean\.to, context: "app", scope, employees \}\)/);
  assert.doesNotMatch(reports, /measuredUsage\(\{ from: clean\.from, to: clean\.to \}\)/,
    "a report is summing every context again, which counts time in the chat panel twice");
});
