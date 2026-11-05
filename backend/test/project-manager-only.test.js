const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mayEditProject, mayDeleteProject, PROJECT_STAFF_FIELDS, PROJECT_EDIT_REFUSAL, PROJECT_DELETE_REFUSAL } = require("../src/modules/sales/projects/controller");

/*
 * Who answers for a project as a **record**: who may change the booking it was created from, and
 * who may delete it.
 *
 * The rule this replaces was one permission doing two jobs. `SALES / Sales Manager` `READ_WRITE` is
 * what books a project, and it was also the whole of the guard on `PATCH` and `DELETE
 * /projects/:id` - so the CRM who typed a booking could rewrite it long after the studio had begun
 * working to it, and could delete it outright. Making a project and unmaking one are not the same
 * act.
 *
 * It is now two questions. **Changing** a project belongs to anybody it is staffed to - its Project
 * Manager, its Pre Production Coordinator, its Creative Manager, its Post Production Coordinator -
 * because each of them is working to it. **Deleting** it belongs to its Project Manager alone: a
 * coordinator runs a stage of the work, and removing the project out from under everybody else
 * working to it is not a stage of anything. A branch administrator passes either
 * (`ADMIN / Branch Administration`, which a Super Admin holds along with everything else, so they
 * are covered without a role test).
 *
 * `hasPermission` is stubbed rather than reached, like `project-started-editor.test.js` beside this:
 * what is asserted is the *rule* - which fact about a person lets them through - not the IAM lookup,
 * which has its own tests.
 */

const PM_EMPLOYEE = 41;
const PRE_COORD = 52;
const CREATIVE = 63;
const POST_COORD = 74;
const project = (over = {}) => ({
  projectStatus: "Work in Progress - Pre & Production",
  projectManagerEmployeeId: PM_EMPLOYEE,
  preProductionCoordinatorEmployeeId: PRE_COORD,
  creativeManagerEmployeeId: CREATIVE,
  postProductionCoordinatorEmployeeId: POST_COORD,
  ...over,
});

/*
 * `holds` is which permissions this login has: `true` for all of them, `false` for none, or the
 * `module:feature` list it holds - the rules ask about three now, and a stub that answers "yes" to
 * whichever is asked first cannot tell them apart.
 */
function viewer({ linkedEmployeeId = null, holds = false } = {}) {
  const asked = [];
  const user = { id: 7, linkedEmployeeId };
  // Entries are `module:feature`, or `module:feature:level` where the level itself is the point.
  const held = Array.isArray(holds) ? new Set(holds) : null;
  const iam = require("../src/services/iam.service");
  const original = iam.hasPermission;
  iam.hasPermission = async (userId, module, feature, level) => {
    asked.push({ userId, module, feature, level });
    return held ? (held.has(`${module}:${feature}`) || held.has(`${module}:${feature}:${level}`)) : holds;
  };
  return { user, asked, restore: () => { iam.hasPermission = original; } };
}

/* ------------------------------------------------------------------------ who gets through */

test("the project manager of that project may change and delete it", async () => {
  const { user, restore } = viewer({ linkedEmployeeId: PM_EMPLOYEE });
  try {
    assert.equal(await mayEditProject(project(), user), true);
    assert.equal(await mayDeleteProject(project(), user), true);
  } finally { restore(); }
});

test("a coordinator staffed on it may change it and may not delete it", async () => {
  /*
   * The whole point of there being two rules. Each of these three is working to the project and has
   * reason to correct what it says; none of them should be able to take it away from the others.
   */
  for (const [name, employeeId] of [["pre production coordinator", PRE_COORD], ["creative manager", CREATIVE], ["post production coordinator", POST_COORD]]) {
    const { user, restore } = viewer({ linkedEmployeeId: employeeId });
    try {
      assert.equal(await mayEditProject(project(), user), true, `the ${name} should be able to change it`);
      assert.equal(await mayDeleteProject(project(), user), false, `the ${name} should NOT be able to delete it`);
    } finally { restore(); }
  }
});

test("the list of staffed people leads with the Project Manager, which is what delete reads", () => {
  /*
   * Delete is `PROJECT_STAFF_FIELDS.slice(0, 1)` rather than a second list of its own, so the two
   * rules cannot come to disagree about which field names the manager. That makes the *order*
   * load-bearing: put anybody else first and deleting a project silently becomes theirs.
   */
  assert.equal(PROJECT_STAFF_FIELDS[0], "projectManagerEmployeeId");
  assert.deepEqual(PROJECT_STAFF_FIELDS.slice(1).sort(), [
    "creativeManagerEmployeeId",
    "postProductionCoordinatorEmployeeId",
    "preProductionCoordinatorEmployeeId",
  ]);
});

test("somebody else's project manager may not do either", async () => {
  /*
   * The employee behind the login is matched against **this** project's manager, not against being
   * a project manager in general - which is the whole difference between a record having an owner
   * and a role having a privilege.
   */
  const { user, restore } = viewer({ linkedEmployeeId: 99 });
  try {
    assert.equal(await mayEditProject(project(), user), false);
    assert.equal(await mayDeleteProject(project(), user), false);
  } finally { restore(); }
});

test("a branch administrator may, and is asked for exactly that permission", async () => {
  const { user, asked, restore } = viewer({ holds: ["ADMIN:Branch Administration"] });
  try {
    assert.equal(await mayEditProject(project(), user), true);
    // Named rather than a role test: a `req.user.role` check sits below the guard on the route,
    // silently overrules it, and cannot be granted to anybody (CLAUDE.md, Rule 4). A Super Admin
    // holds this along with everything else, so they need no case of their own.
    // Booking Edit is asked first and answered no, so Branch Administration is what let them in.
    assert.deepEqual(asked, [
      { userId: 7, module: "SALES", feature: "Booking Edit", level: "READ_WRITE" },
      { userId: 7, module: "ADMIN", feature: "Branch Administration", level: "READ" },
    ]);
    // And deleting too - a branch administrator is not narrowed to the manager's seat.
    assert.equal(await mayDeleteProject(project(), user), true);
  } finally { restore(); }
});

test("the CRM who booked it does not get through on the sale's permission", async () => {
  /*
   * The point of the whole change. This login holds `SALES / Sales Manager` `READ_WRITE` - it is how
   * the project exists at all - and that is not one of the facts asked about here (editing a booking
   * is `SALES / Booking Edit`), so the stub answering "no" to each of them is the whole answer.
   */
  const { user, restore } = viewer({ linkedEmployeeId: 12, holds: false });
  try {
    assert.equal(await mayEditProject(project(), user), false);
    assert.equal(await mayDeleteProject(project(), user), false);
  } finally { restore(); }
});

/* ---------------------------------------------------- the two ways the rule must not fail open */

test("a project that has not started yet is NOT waved through", async () => {
  /*
   * The trap, and the one line that separates this rule from `mayEditStartedProject` beside it.
   *
   * That one returns true for every Yet to Start project, because until a project starts, planning
   * it *is* the job. Copying it here would have meant the CRM could still delete any project they
   * had just booked - which is exactly the state a mis-booked project is in, and exactly the hole
   * this was written to close.
   *
   * A Yet to Start project has **no Project Manager**: the field is filled in on the Start Project
   * form, not on the booking form. So until one is named, the branch administrator is the only
   * answer - the honest reading of the data rather than a gap.
   */
  const { user, asked, restore } = viewer({ linkedEmployeeId: PM_EMPLOYEE, holds: false });
  try {
    const unstaffed = { projectStatus: "Yet to Start", projectManagerEmployeeId: null };
    assert.equal(await mayEditProject(unstaffed, user), false);
    assert.equal(await mayDeleteProject(unstaffed, user), false);
    /*
     * Two questions per rule, and both are permissions rather than facts about the person: the
     * branch administrator's, then the studio-wide `PROJECT / Show All Projects` write that lets
     * somebody work a project nobody is staffed to. Neither rule reads a role.
     */
    assert.deepEqual(asked.map((one) => `${one.module}:${one.feature}`), [
      // Editing asks its grants in turn - planning projects (Projects, or Show All Projects, at Read /
      // Write) among them; deleting is the manager's, so it asks only its two.
      "SALES:Booking Edit", "ADMIN:Branch Administration", "PROJECT:Projects", "PROJECT:Show All Projects", "PROJECT:Show All Projects",
      "ADMIN:Branch Administration", "PROJECT:Show All Projects",
    ]);
  } finally { restore(); }
});

test("a login with no employee behind it cannot be anybody's project manager", async () => {
  /*
   * `null === null` is true in JavaScript, which is how a login with no linked employee would have
   * matched a project with no manager and walked into every unstarted project in the studio.
   */
  const { user, restore } = viewer({ linkedEmployeeId: null, holds: false });
  try {
    const unstaffed = { projectStatus: "Yet to Start", projectManagerEmployeeId: null, preProductionCoordinatorEmployeeId: null, creativeManagerEmployeeId: null, postProductionCoordinatorEmployeeId: null };
    assert.equal(await mayEditProject(unstaffed, user), false);
    assert.equal(await mayDeleteProject(unstaffed, user), false);
  } finally { restore(); }
});

/* ------------------------------------------------------------------- where the rule is mounted */

test("both project-level writes take the ownership check, and neither takes the sale's alone", () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  /*
   * Editing and deleting a project both go through it. `answersForAProject` is the permission layer -
   * either screen's own write, because one endpoint feeds both and a screen may not be given a finer
   * permission than the endpoint it reads - and `requireProjectManager` is what actually decides.
   */
  assert.match(ROUTES, /router\.patch\("\/projects\/:id", answersForAProject, requireProjectEditor, updateProject\);/);
  assert.match(ROUTES, /router\.delete\("\/projects\/:id", answersForAProject, requireProjectDeleter, deleteProject\);/);
  // `PROJECT / Projects` is named beside the sale's, or a Project Manager who does not sell could
  // not reach their own project's record.
  assert.match(ROUTES, /const answersForAProject = checkAnyPermission\(\[[\s\S]*?module: "SALES", feature: "Sales Manager", level: "READ_WRITE"[\s\S]*?module: "PROJECT", feature: "Projects", level: "READ_WRITE"[\s\S]*?\]\);/);
  // And the old guard is gone from both, or the CRM would still be let through by it.
  assert.doesNotMatch(ROUTES, /router\.patch\("\/projects\/:id", salesManager/);
  assert.doesNotMatch(ROUTES, /router\.delete\("\/projects\/:id", salesManager/);
});

test("each refusal says who may, so nobody is left guessing", () => {
  // And they say different things, because being turned away from Delete and from Edit are not the
  // same news: one means "not you", the other means "not anybody but the manager".
  assert.match(PROJECT_EDIT_REFUSAL, /staffed/);
  assert.match(PROJECT_DELETE_REFUSAL, /Project Manager/);
  for (const refusal of [PROJECT_EDIT_REFUSAL, PROJECT_DELETE_REFUSAL]) assert.match(refusal, /branch administrator/);
  assert.notEqual(PROJECT_EDIT_REFUSAL, PROJECT_DELETE_REFUSAL);
});

/* ------------------------------------------------- editing a booking as its own grant */

test("SALES / Booking Edit lets somebody change a booking they are not staffed to - and nothing more", async () => {
  /*
   * The grant that exists so a CRM can correct a booking without `PROJECT / Show All Projects`,
   * which would also hand them every project on Projects, Pre Production and Production.
   *
   * It is **editing** alone: deleting a project stays its Project Manager's, so the same login is
   * refused there. Read grants nothing - the rule asks for READ_WRITE.
   */
  const { user, asked, restore } = viewer({ linkedEmployeeId: 12, holds: ["SALES:Booking Edit"] });
  try {
    assert.equal(await mayEditProject(project(), user), true);
    assert.deepEqual(asked, [{ userId: 7, module: "SALES", feature: "Booking Edit", level: "READ_WRITE" }], "asked for the grant itself, at Read / Write");
    assert.equal(await mayDeleteProject(project(), user), false, "deleting is still the Project Manager's");
    // Even a project nobody is staffed to yet, which is the state a mis-booked one is in.
    assert.equal(await mayEditProject({ projectStatus: "Yet to Start", projectManagerEmployeeId: null }, user), true);
  } finally { restore(); }
});

test("the booking grant at Read alone changes nothing - it is a Read / Write row", async () => {
  // There is no reading an edit, so the rule asks for READ_WRITE and a Read tick grants nothing.
  const { user, restore } = viewer({ linkedEmployeeId: 12, holds: ["SALES:Booking Edit:READ"] });
  try {
    assert.equal(await mayEditProject(project(), user), false);
  } finally { restore(); }
});

test("the grant widens editing only - not the rows it reaches, nor the routes beside it", () => {
  /*
   * Two ways this could have widened more than the one act, and both are deliberately not done:
   *
   *   - the write still looks its project up through `projectAccessWhere({ forWrite: true })`, so the
   *     grant reaches the bookings the caller can already see and answers 404 for anything else;
   *   - the router's own guard still asks for one of the three *module* writes. Adding the booking
   *     grant there would also open `GET /projects/:id/client-login` and the bulk delete behind the
   *     same guard, so it is not in that list - the screens ask for a module write too.
   */
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  const rule = controller.slice(controller.indexOf("const requireProjectRole ="), controller.indexOf("async function requireStartedProjectEditor"));
  assert.match(rule, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), forWrite: true \}\)/, "read through the caller's own scope");
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  const guard = routes.slice(routes.indexOf("const answersForAProject = checkAnyPermission(["), routes.indexOf("]);", routes.indexOf("const answersForAProject")));
  assert.doesNotMatch(guard, /Booking Edit/, "the route guard is not widened by it");
  assert.match(guard, /feature: "Sales Manager", level: "READ_WRITE"/);
});

test("the booking grant also changes a project's payment schedule, the booking's own terms", async () => {
  /*
   * A schedule is agreed when the sale is, so a CRM correcting a booking has to be able to correct
   * its schedule with it. The route has two ways through - this grant, or planning projects and this
   * project's own started rule - and the grant is asked first, since it answers for any project the
   * caller can see.
   */
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  assert.match(routes, /router\.put\("\/projects\/:id\/payment-schedule", editsASchedule, saveProjectPaymentSchedule\);/);
  const guard = routes.slice(routes.indexOf("const editsASchedule ="), routes.indexOf("router.put(\"/projects/:id/payment-schedule\""));
  assert.match(guard, /if \(await mayEditBookings\(req\.user\)\) return next\(\);/, "the grant lets it through");
  assert.match(guard, /return plansAProject\(req, res, \(error\) => \(error \? next\(error\) : editsAStartedProject\(req, res, next\)\)\);/, "otherwise the plan's pair, unchanged");
  // Creating the first schedule stays the sale's own permission, and the read is unchanged.
  assert.match(routes, /router\.post\("\/projects\/:id\/payment-schedule", salesManager, saveProjectPaymentSchedule\);/);
});

test("the booking grant is in the catalogue, so Role Management can tick it", () => {
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  const { BOOKING_EDIT_WRITE } = require("../src/modules/sales/projects/controller");
  const row = PERMISSIONS.find((permission) => permission.module === "SALES" && permission.feature === "Booking Edit");
  assert.ok(row, "SALES / Booking Edit is in the catalogue");
  assert.equal(row.displayName, "Edit Bookings");
  assert.deepEqual([BOOKING_EDIT_WRITE.module, BOOKING_EDIT_WRITE.feature, BOOKING_EDIT_WRITE.level], ["SALES", "Booking Edit", "READ_WRITE"]);
  // And in a migration, because the seed cannot be run on production (IAM.md step 10).
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261021120000_booking_edit_permission", "migration.sql"), "utf8");
  assert.match(migration, /INSERT INTO `permission`[\s\S]*WHERE NOT EXISTS/, "replayable");
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/, "granted to Super Admin only");
  assert.doesNotMatch(migration, /BRANCH_ADMIN|'ADMIN'|SALES_MANAGER/, "no other role is granted it");
});
