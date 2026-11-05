const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  repositoryEmployees, staffIdentity, resolveEmployeeFilter,
} = require("../src/modules/sales/crm-reports/service");
const { buildUsageWhere } = require("../src/modules/sales/crm-reports/filters");

/*
 * Whose figures a report shows.
 *
 * Reports & Analytics narrowed its **call** tabs by the lead each call was against and its three
 * **usage** tabs by nothing at all: anybody who could open the screen read every message, every lead
 * edit and every measured hour in the studio, by name, for the whole range. That is the state
 * DATA-SCOPE.md describes as "everything else shows every record in the studio to anyone who may
 * open it", and this screen is the one where it reads as a performance review of people the reader
 * does not manage.
 *
 * The rule is the application's own, unchanged and not reinvented here: **a record is yours if your
 * name is on it, or the name on it belongs to somebody who reports to you, at any depth**; a branch
 * administrator sees their branches; a Super Admin is narrowed by nothing.
 *
 * These hold the wiring rather than the rule - `dataScope.service` owns the rule and
 * `test/data-scope*.test.js` hold it - because the fault to guard against here is a report that
 * simply forgets to ask.
 */

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-reports", "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-reports", "controller.js"), "utf8");

/** A resolved scope, as `dataScope.resolve` answers one, without touching the database. */
const scopeFor = ({ employeeIds = [], userIds = [], branchIds = [], unlimited = false, administersBranches = false } = {}) => ({
  unlimited,
  administersBranches,
  employeeIds,
  userIds,
  branchIds,
  sql: (expressions = {}) => {
    if (unlimited) return { clause: "1=1", params: [] };
    const clauses = [];
    const params = [];
    if (userIds.length && expressions.user) { clauses.push(`${expressions.user} IN (${userIds.map(() => "?").join(", ")})`); params.push(...userIds); }
    if (administersBranches && branchIds.length && expressions.branch) { clauses.push(`${expressions.branch} IN (${branchIds.map(() => "?").join(", ")})`); params.push(...branchIds); }
    return clauses.length ? { clause: `(${clauses.join(" OR ")})`, params } : { clause: "1=0", params: [] };
  },
});

test("every usage report asks the scope, and asks it about the login and the branch", () => {
  /*
   * The three that had no scope at all. Each names the column holding the **login** - a usage row is
   * about an account, not an employee - and the branch of that login, which is where a branch
   * administrator's reach comes from: a message, an activity row and a measured stretch carry no
   * branch of their own.
   */
  for (const [report, user] of [
    ["async function whatsappUsage(", "`m`.`userId`"],
    ["async function applicationUsage(", "`a`.`actor_user_id`"],
    ["async function workHours(", "`s`.`user_id`"],
  ]) {
    const start = SERVICE.indexOf(report);
    assert.notEqual(start, -1, `${report} was not found`);
    const body = SERVICE.slice(start, SERVICE.indexOf("\n}\n", start));
    assert.match(body, /\(filters, scope = null\)/, `${report} does not take the reader's scope`);
    assert.ok(body.includes(user), `${report} does not narrow by ${user}`);
    assert.ok(body.includes("`u`.`branch_id`"), `${report} gives a branch administrator no reach`);
  }
});

test("the usage clause is built where the values are, so the two cannot come apart", () => {
  /*
   * These are positional parameters. A clause appended by a caller after `buildUsageWhere` has
   * returned lands in the statement in one order and its values in another, and the report then
   * narrows by the wrong thing entirely - which is not an error, just wrong numbers.
   */
  const scope = scopeFor({ userIds: [7, 9] });
  const { sql, params } = buildUsageWhere(
    { from: "2026-09-01", to: "2026-09-30", employee: "Priya S" },
    { dateColumn: "`m`.`sentAt`", nameExpr: "`u`.`name`", scope, scopeColumns: { user: "`m`.`userId`", branch: "`u`.`branch_id`" } },
  );
  assert.match(sql, /`m`\.`userId` IN \(\?, \?\)/);
  // Date, date, employee name, then the scope's two ids - the order the clauses were joined in.
  assert.deepEqual(params.slice(-3), ["Priya S", 7, 9]);
});

test("a reader narrowed to nobody is shown nobody, rather than everybody", () => {
  // A login with no employee record, no team and no branch administration. `1=0` is the honest
  // answer; an empty clause would be every row in the studio.
  const { sql } = buildUsageWhere({}, {
    dateColumn: "`m`.`sentAt`",
    nameExpr: "`u`.`name`",
    scope: scopeFor({}),
    scopeColumns: { user: "`m`.`userId`", branch: "`u`.`branch_id`" },
  });
  assert.match(sql, /1=0/);
});

test("a Super Admin is narrowed by nothing", () => {
  const { sql, params } = buildUsageWhere({}, {
    dateColumn: "`m`.`sentAt`",
    nameExpr: "`u`.`name`",
    scope: scopeFor({ unlimited: true }),
    scopeColumns: { user: "`m`.`userId`", branch: "`u`.`branch_id`" },
  });
  assert.match(sql, /1=1/);
  assert.deepEqual(params, []);
});

test("the people the reports name are narrowed the same way the rows are", async () => {
  /*
   * Employee Analysis, Work Hours and the call half of WhatsApp Usage attribute a call to a
   * repository employee. Narrowing the rows without narrowing *that* would leave a reader looking at
   * a row headed with a colleague's name and no figures in it, which says more than nothing.
   */
  assert.match(SERVICE, /async function staffIdentity\(scope = null\)/);
  assert.match(SERVICE, /const staffCalls = async \(scope = null\) => staffCallSql\(await staffIdentity\(scope\)\);/);
  assert.equal((SERVICE.match(/await staffCalls\(scope\)/g) || []).length, 3, "a report that lists people is not passing its reader's scope");

  // Nobody at all is nobody, not everybody: a `where` of `{}` here would be the whole repository.
  const nobody = await staffIdentity(scopeFor({}));
  assert.deepEqual(nobody.names, []);
  assert.equal(nobody.byNumber.size, 0);
});

test("the filter offers only people the reader may be shown", async () => {
  // Both lists - the repository names on the call tabs, and the login names on the usage tabs.
  assert.match(SERVICE, /async function repositoryEmployees\(scope = null\)/);
  assert.match(SERVICE, /async function usageNames\(scope = null\)/);
  assert.match(CONTROLLER, /await reportOptions\(await reportScope\(req\)\)/);
  assert.deepEqual(await repositoryEmployees(scopeFor({})), [], "a reader named on nothing is offered a dropdown of everybody");
});

test("a name typed past the dropdown is resolved under the same scope", async () => {
  /*
   * The dropdown offers the reader's own people, but the filter is a name on a query string and a
   * name can be typed. Resolved without the scope, a colleague's name found their handset number and
   * filtered the call reports by it - "how did *they* do last week" asked about somebody else's team.
   */
  assert.match(SERVICE, /async function resolveEmployeeFilter\(filters = \{\}, scope = null\)/);
  assert.match(SERVICE, /where: \{ employeeName: \{ in: chosen \}, \.\.\.visibleEmployeeWhere\(scope\) \}/);
  assert.match(CONTROLLER, /resolveEmployeeFilter\(req\.query \|\| \{\}, scope\)/);

  // A name nobody may see resolves to no number, which leaves the plain name it arrived as.
  const resolved = await resolveEmployeeFilter({ employee: "Somebody Else" }, scopeFor({}));
  assert.equal(resolved.employeeNumbers, undefined);
  assert.equal(resolved.employee, "Somebody Else");
});
