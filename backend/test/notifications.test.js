const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SOURCES } = require("../src/modules/notifications/sources");
const notifications = require("../src/services/notifications");

/*
 * The bell, for the whole application.
 *
 * It was the studio's meetings and nothing else. It now gathers from every module - a follow-up due
 * this morning, a client who replied an hour ago, a call nobody has read, an approval waiting on a
 * decision - and it sits on the topbar, which is on every screen of the application.
 *
 * That last part is what makes the two risks here worth pinning down. A bell that leaks is a
 * permission hole on every page at once; a bell that throws takes the topbar with it.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "notifications");
const read = (name) => fs.readFileSync(path.join(MODULE, name), "utf8");
const SOURCE_FILE = read("sources.js");
const CONTROLLER = read("controller.js");

test("every source names the permission it answers to", () => {
  /*
   * The bell must never become a way around the guard on the module a notice is about. A source
   * with no permission would be read for everybody signed in - and the notice carries a client's
   * name, a phone number or what somebody asked to buy.
   */
  assert.ok(SOURCES.length > 0, "there are no notification sources at all");
  for (const source of SOURCES) {
    assert.ok(source.key, "a source has no key");
    assert.ok(source.module, `${source.key} names no module`);
    assert.ok(source.feature, `${source.key} names no feature`);
    assert.equal(typeof source.load, "function", `${source.key} has nothing to load`);
  }
});

test("the permission is checked before the source is read, not after", () => {
  /*
   * Filtering afterwards would mean the query ran, which is work done to leak nothing - and one
   * missed filter away from leaking something. The controller collects the allowed sources first
   * and only then loads them.
   */
  assert.match(CONTROLLER, /if \(await iamService\.hasPermission\(req\.user\.id, source\.module, source\.feature, "READ"\)\) allowed\.push\(source\);/);
  const load = CONTROLLER.indexOf("Promise.all(allowed.map((source) => source.load(viewerFor(source))))");
  const gate = CONTROLLER.indexOf("hasPermission");
  assert.ok(gate !== -1 && load > gate, "sources are loaded before the permission check");
});

test("how wide a source answers is the data scope's answer, not a role test", () => {
  /*
   * A reader the data scope does not confine - a Super Admin, or anybody whose branch reach is not
   * narrowed - gets the studio's notices rather than only their own, because that is already what
   * their screens show them and a bell narrower than the board beneath it would be the one place
   * their view stopped.
   *
   * Asked through `dataScope.seesEverything`, which is the same rule that decides whose *rows*
   * anybody gets. A `req.user.role === "SUPER_ADMIN"` test here would be a second answer to a
   * question this application already answers in one place - and one no role could be granted, which
   * is exactly what CLAUDE.md's Rule 4 forbids in a controller.
   */
  assert.match(CONTROLLER, /dataScope\.seesEverything\(req\.user\.id, source\)/);
  assert.doesNotMatch(CONTROLLER, /req\.user\.role/, "the bell decides how wide to look from a role rather than from the data scope");
  // Asked per source's module, not once for the reader: somebody unconfined in Sales and confined
  // elsewhere gets the studio's CRM notices and their own of everything else.
  assert.match(CONTROLLER, /everyone\.get\(`\$\{source\.module\}:\$\{source\.feature\}`\)/);
});

test("the stored notifications are gated too, one kind at a time, by their own module", () => {
  /*
   * The bell carries two kinds of notice and both answer to a permission.
   *
   * The stored rows answered for one constant, `HRM / Task Management`, and that was right exactly
   * while Tasks was the only module writing them. The CRM writes them now - a lead put in somebody's
   * name - and a single gate would have made two things true at once that must not be: a salesperson
   * with no Tasks permission never told about their own leads, and a task-only reader told a client's
   * name off a lead they cannot open.
   *
   * So each *type* names its own module, and the reader is told about the types their permissions
   * reach. A type nobody has mapped reaches nobody, which is the safe direction: an unmapped type is
   * a module that has not said who its notices belong to.
   */
  const store = fs.readFileSync(path.join(__dirname, "..", "src", "services", "notifications.js"), "utf8");
  assert.match(store, /const TYPE_PERMISSIONS = \{/);
  for (const [type, permission] of Object.entries(notifications.TYPE_PERMISSIONS)) {
    assert.ok(permission.module && permission.feature, `${type} names no module and feature`);
  }
  for (const type of Object.values(notifications.TYPES)) {
    assert.ok(notifications.TYPE_PERMISSIONS[type], `${type} can be written and can never be read`);
  }
  // The five task types share one permission, and the CRM's answers for the board it links into.
  assert.deepEqual(notifications.typesFor([{ module: "HRM", feature: "Task Management" }]).sort(), [
    "TASK_ASSIGNED", "TASK_CANCELLED", "TASK_COMPLETED", "TASK_REASSIGNED", "TASK_REVERTED",
  ]);
  assert.deepEqual(notifications.typesFor([{ module: "SALES", feature: "CRM Leads" }]), ["LEAD_ASSIGNED"]);
  assert.deepEqual(notifications.typesFor([]), [], "a reader holding nothing is told about something");

  assert.match(CONTROLLER, /hasPermission\(req\.user\.id, permission\.module, permission\.feature, "READ"\)/);
  /*
   * Applied in the query rather than filtered after it, which is not a matter of taste: the badge is
   * counted by the same `where`, so a bell that says three opens showing three. Counted over every
   * row and listed narrowed, it would say three and open showing one.
   */
  assert.match(CONTROLLER, /notifications\.listForUser\(req\.user\.id, \{ types: storedTypes \}\)/);
  assert.match(store, /const where = \{ userId, \.\.\.\(types \? \{ type: \{ in: types \} \} : \{\}\) \};/);
  assert.match(store, /prisma\.notification\.count\(\{ where: \{ \.\.\.where, readAt: null \} \}\)/);
  // And the router carries no module gate of its own, or the inner ones could never be reached.
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "notifications", "routes.js"), "utf8");
  assert.doesNotMatch(routes, /requireModule|checkPermission/, "a module gate is back on the router, which refuses the other sources");
  assert.match(routes, /router\.use\(protect\);/);
});

test("marking read only ever touches the caller's own rows", () => {
  /*
   * The trap this kind of endpoint is usually caught by: an id in the URL is never assumed to be
   * one the caller may touch. Both writes are scoped to `req.user.id` in the query itself, so there
   * is no request shape that clears somebody else's bell.
   */
  assert.match(CONTROLLER, /notifications\.markRead\(req\.user\.id, id\)/);
  assert.match(CONTROLLER, /notifications\.markAllRead\(req\.user\.id\)/);
});

test("a source that fails contributes nothing and takes nothing with it", () => {
  /*
   * This hangs off a bar that is on every screen. One bad query - a table an older database has not
   * got, a column renamed - must not be able to turn the topbar into an error, and must not stop the
   * other three sources answering.
   */
  assert.match(SOURCE_FILE, /async function safely\(what, run\) \{[\s\S]*?catch \(error\) \{[\s\S]*?return \[\];/);
  for (const source of SOURCES) {
    assert.match(
      SOURCE_FILE,
      new RegExp(`key: "${source.key}"[^}]*load: \\([^)]*\\) => safely\\(`),
      `${source.key} is not wrapped, so a failure in it would fail the whole bell`,
    );
  }
});

test("a source answers with nothing rather than everything when it has nobody to answer about", () => {
  /*
   * The three personal sources are scoped to the signed-in person. Asked about nobody - a user row
   * with no name, which the CRM's own name-matching cannot key on - the answer is nothing at all.
   * Falling through to an unscoped query would put the whole studio's work on one person's bell.
   */
  assert.match(SOURCE_FILE, /async function followUps\(\{ userName, everyone = false \}\) \{\s*\n\s*if \(!everyone && !userName\) return \[\];/);
  assert.match(SOURCE_FILE, /async function whatsappReplies\(\{ userId, everyone = false \}\) \{\s*\n\s*if \(!everyone && !userId\) return \[\];/);
  assert.match(SOURCE_FILE, /async function callsWaiting\(\{ userName, everyone = false \}\) \{\s*\n\s*if \(!everyone && !userName\) return \[\];/);
  /*
   * And the widened form is a clause chosen with its parameters rather than a parameter left out of
   * a fixed clause. `1=1` and `[]` are written together; a query that kept `= ?` and stopped binding
   * it would be a placeholder without an argument, which MySQL answers with an error rather than
   * with everything - but the reverse, binding a name into a clause that no longer reads it, would
   * silently return the whole studio's work to somebody scoped to their own.
   */
  for (const guard of [/const mine = everyone \? "1=1"/, /\.\.\.\(everyone \? \[\] : \[userName\]\)/, /\.\.\.\(everyone \? \[\] : \[userId\]\)/]) {
    assert.match(SOURCE_FILE, guard);
  }
});

test("a notice is identified by what it is about, never by when it was noticed", () => {
  /*
   * The browser remembers which notices have been looked at, in `localStorage`, keyed on the id. An
   * id built from the moment the poll ran would be a new id every minute - the badge would light
   * again on every poll and stop being read at all.
   */
  for (const [source, shape] of [
    ["followUps", /id: `followup:\$\{row\.enquiryId\}:\$\{day\}`/],
    ["whatsappReplies", /id: `whatsapp:\$\{row\.enquiryId\}:\$\{new Date\(row\.sentAt\)\.getTime\(\)\}`/],
    ["callsWaiting", /id: `call:\$\{row\.callId\}`/],
    ["assetApprovals", /id: `asset-request:\$\{row\.id\}`/],
  ]) {
    assert.match(SOURCE_FILE, shape, `${source} no longer identifies its notices by what they are about`);
  }
  assert.doesNotMatch(SOURCE_FILE, /id: `[^`]*\$\{Date\.now\(\)\}/, "a notice id is built from the clock");
});

test("every notice says where the work is done", () => {
  /*
   * A notice that says something is waiting and not where is one somebody has to go and find, which
   * is most of the work it was meant to save. The routes are the application's own - checked as
   * literals here because a link to a page that does not exist fails only when somebody presses it.
   */
  for (const href of ["/sales/crm?lead=", "/sales/crm", "/asset-management/assets"]) {
    assert.ok(SOURCE_FILE.includes(href), `nothing links to ${href} any more`);
  }
  const routes = path.join(__dirname, "..", "..", "frontend", "src", "app", "(app)");
  assert.ok(fs.existsSync(path.join(routes, "sales", "crm", "page.js")), "/sales/crm is not a page");
  assert.ok(fs.existsSync(path.join(routes, "asset-management", "assets", "page.js")), "/asset-management/assets is not a page");
});

test("the newest thing is not the most urgent thing", () => {
  /*
   * Sorted by when a notice is *about* rather than when it arrived, so a follow-up that was due last
   * Tuesday stays at the top where it belongs instead of sinking as newer notices come in. A notice
   * with no moment sorts last: not knowing when is not the same as being urgent.
   */
  assert.match(CONTROLLER, /function byUrgency\(first, second\) \{/);
  assert.match(CONTROLLER, /if \(!first\.at\) return second\.at \? 1 : 0;/);
  assert.match(CONTROLLER, /return new Date\(first\.at\) - new Date\(second\.at\);/);
});

test("the route asks only that the caller is signed in", () => {
  /*
   * Deliberately. The bell is on the topbar of every screen, so requiring a module here would mean
   * choosing one - and everybody without it would get a 403 on every page for a courtesy. What is
   * *in* the bell is gated per source instead, which is the same shape the Contacts directory uses
   * and for the same reason.
   */
  const routes = read("routes.js");
  assert.match(routes, /router\.use\(protect\);/);
  assert.doesNotMatch(routes, /requireModule/, "the bell now refuses whole roles rather than gating its sources");
});
