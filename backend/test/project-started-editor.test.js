const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mayEditStartedProject, STARTED_PROJECT_EDIT_REFUSAL } = require("../src/modules/sales/projects/controller");

/*
 * Who may still change a project once it has started.
 *
 * Planning a project is `PROJECT / Projects` `READ_WRITE`, and that is the right question right up
 * until the project starts. After that the plan is being worked to - shoots rostered against it,
 * services allocated, money scheduled - so changing it belongs to the person answerable for the
 * work: its Project Manager, or whoever runs the branch.
 *
 * `hasPermission` is stubbed rather than reached, because what is being asserted is the *rule* -
 * which of the two facts about a person lets them through - and not the IAM lookup, which has its
 * own tests. The stub records that it was asked for the right permission.
 */

const PM_EMPLOYEE = 41;
const started = (over = {}) => ({ projectStatus: "Work in Progress - Pre & Production", projectManagerEmployeeId: PM_EMPLOYEE, ...over });

/** A viewer, with `holds` deciding what the stubbed permission lookup answers. */
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

test("a project that has not started yet is the route's own permission to decide", async () => {
  const { user, asked, restore } = viewer();
  try {
    // Nobody is its Project Manager yet and this login administers nothing, and it still passes:
    // making the plan is what `PROJECT / Projects` is for.
    assert.equal(await mayEditStartedProject({ projectStatus: "Yet to Start", projectManagerEmployeeId: null }, user), true);
    assert.deepEqual(asked, [], "an unstarted project should not need the branch permission looked up");
  } finally { restore(); }
});

test("the project manager of that project may change it", async () => {
  const { user, restore } = viewer({ linkedEmployeeId: PM_EMPLOYEE });
  try {
    assert.equal(await mayEditStartedProject(started(), user), true);
  } finally { restore(); }
});

test("somebody else's project manager may not", async () => {
  // The employee behind the login is matched against *this* project's manager, not against being a
  // project manager in general.
  const { user, restore } = viewer({ linkedEmployeeId: 99 });
  try {
    assert.equal(await mayEditStartedProject(started(), user), false);
  } finally { restore(); }
});

test("a login with no employee behind it cannot be a project manager", async () => {
  const { user, restore } = viewer({ linkedEmployeeId: null });
  try {
    // Including the case where the project has no manager either: two absences are not a match.
    assert.equal(await mayEditStartedProject(started({ projectManagerEmployeeId: null }), user), false);
  } finally { restore(); }
});

test("whoever administers branches may change it, and that is what is asked for", async () => {
  const { user, asked, restore } = viewer({ linkedEmployeeId: 99, holds: true });
  try {
    assert.equal(await mayEditStartedProject(started(), user), true);
    assert.deepEqual(asked, [{ userId: 7, module: "ADMIN", feature: "Branch Administration", level: "READ" }]);
  } finally { restore(); }
});

test("the rule is a permission, never a role check", () => {
  /*
   * A Super Admin passes because `getUserPermissions` grants them every permission, so the branch
   * check above answers true for them - not because this code looks at `req.user.role`. A role test
   * inside a controller sits below the guard on the route, silently overrules it, and cannot be
   * granted to anybody (CLAUDE.md, Rule 4).
   */
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  /*
   * Sliced to this function's own closing brace rather than to whatever declaration follows it.
   * Read to the next function, it swallowed everything written between the two - and the moment
   * `mayManageProject` was added there, with a comment explaining why it is *not* a role test, this
   * assertion started failing on the word in that explanation.
   */
  const start = controller.indexOf("async function mayEditStartedProject");
  const rule = controller.slice(start, controller.indexOf("\n}", start) + 2);
  assert.doesNotMatch(rule, /role/, "the rule reads a role rather than a permission");
  assert.match(rule, /hasPermission\(user\.id, "ADMIN", "Branch Administration", "READ"\)/);
});

test("every route that writes to one project's plan is behind the guard", () => {
  /*
   * The plan is written through a dozen endpoints - the start-project pair, shoots, the two kinds
   * of allocation, production deliverables - and a rule enforced on two of them is a rule anybody
   * can walk around by adding a shoot instead of pressing Update.
   *
   * Scoped to the routes carrying `plansAProject`, which is what "the plan" means here: the
   * per-project writes, guarded by `PROJECT / Projects` write **or** the studio-wide
   * `PROJECT / Show All Projects` write. The studio's own vocabulary below them - service and
   * deliverable definitions, option sets - stays on `projectPlan` alone, because somebody trusted
   * with every project is not thereby trusted to rewrite the lists every project is planned from.
   *
   * `PATCH /projects/:id` is not among them: that is the booking, decided by `requireProjectEditor`
   * against who the project is staffed to.
   */
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  const planWrites = routes.split("\n")
    .filter((line) => /^router\.(post|patch|put|delete)\("\/projects\/:id/.test(line))
    .filter((line) => line.includes("plansAProject"));
  assert.equal(planWrites.length, 12, "the plan's write routes are not the twelve this rule was mounted on");
  for (const line of planWrites) {
    assert.match(line, /editsAStartedProject/, `unguarded write: ${line.trim()}`);
  }
});

test("the refusal says who may, so somebody refused knows where to go", () => {
  assert.match(STARTED_PROJECT_EDIT_REFUSAL, /Project Manager/);
  assert.match(STARTED_PROJECT_EDIT_REFUSAL, /branch administrator/);
});
