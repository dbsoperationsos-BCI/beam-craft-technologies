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

function viewer({ linkedEmployeeId = null, holds = false } = {}) {
  const asked = [];
  const user = { id: 7, linkedEmployeeId };
  const iam = require("../src/services/iam.service");
  const original = iam.hasPermission;
  iam.hasPermission = async (userId, module, feature, level) => {
    asked.push({ userId, module, feature, level });
    return holds;
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
  const { user, asked, restore } = viewer({ holds: true });
  try {
    assert.equal(await mayEditProject(project(), user), true);
    // Named rather than a role test: a `req.user.role` check sits below the guard on the route,
    // silently overrules it, and cannot be granted to anybody (CLAUDE.md, Rule 4). A Super Admin
    // holds this along with everything else, so they need no case of their own.
    assert.deepEqual(asked, [{ userId: 7, module: "ADMIN", feature: "Branch Administration", level: "READ" }]);
    // And deleting too - a branch administrator is not narrowed to the manager's seat.
    assert.equal(await mayDeleteProject(project(), user), true);
  } finally { restore(); }
});

test("the CRM who booked it does not get through on the sale's permission", async () => {
  /*
   * The point of the whole change. This login holds `SALES / Sales Manager` `READ_WRITE` - it is how
   * the project exists at all - and that is not one of the two facts asked about here, so the stub
   * answering "no" to Branch Administration is the whole answer.
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
      "ADMIN:Branch Administration", "PROJECT:Show All Projects",
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
