const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * **A leaver is taken out of the studio's WhatsApp groups.**
 *
 * The removal existed and was called from exactly one place - the scheduled relieving job - which
 * left two kinds of people in every group they had ever been added to:
 *
 *   - a separation whose **last working day is already past** is relieved by the save itself, and the
 *     job only looks for separations with `relievedAt` still null, so it never saw them;
 *   - somebody marked inactive by a **status change** has no separation at all, so no job will ever
 *     find them.
 *
 * Recording the exit now queues it, and there is a manual action for the people already in that state.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("recording an exit queues the removals, whatever the last working day", () => {
  const controller = read("src/modules/hrm/separations/controller.js");
  assert.match(controller, /const whatsappGroups = require\("\.\.\/whatsapp-groups\/service"\);/);
  assert.match(controller, /const left = await whatsappGroups\.removeEmployeeFromAllGroups\(data\.employeeId, \{ userId: actorId \}\);/);
  // Queued after the answer: the exit is the time-critical half and must be recorded whatever
  // WhatsApp is doing.
  const at = controller.indexOf("removeEmployeeFromAllGroups(data.employeeId");
  assert.ok(at > controller.indexOf("const data = await recordSeparation("), "after the exit is written");
  assert.ok(at < controller.indexOf('return res.status(201).json({ data });'), "before the answer goes back");
});

test("relieving still calls it, and having both is safe", () => {
  assert.match(read("src/modules/hrm/separations/relieve.js"), /removeEmployeeFromAllGroups\(separation\.employeeId\)/);
  /*
   * Both is deliberate: the save covers an exit with nothing to serve, relieving covers one that
   * served notice. `removeEmployeeFromAllGroups` only moves rows that are currently in a group, so
   * whichever runs second finds nothing left to do.
   */
  const service = read("src/modules/hrm/whatsapp-groups/service.js");
  assert.match(service, /where: \{ employeeId: Number\(employeeId\), status: \{ in: IN_THE_GROUP \} \}/);
  assert.match(read("src/modules/hrm/separations/controller.js"), /the second\n     \* call finds nothing left to do/);
});

test("there is a manual way out, for the people no exit will reach", () => {
  const controller = read("src/modules/hrm/whatsapp-groups/controller.js");
  assert.match(controller, /async function removeEmployeeFromGroups\(req, res\)/);
  assert.match(controller, /service\.removeEmployeeFromAllGroups\(employeeId, \{ userId: Number\(req\.user\?\.id\) \|\| null \}\)/);
  // A bad id is refused rather than queued against nobody.
  assert.match(controller, /if \(!Number\.isInteger\(employeeId\) \|\| employeeId <= 0\) return res\.status\(400\)/);
  // The pacing is said in the answer, so a removal that has not visibly happened does not read as
  // nothing having happened.
  assert.match(controller, /about half a minute apart/);
  // Behind the router's own guard: putting people into the studio's groups and taking them out is one job.
  const routes = read("src/modules/hrm/whatsapp-groups/routes.js");
  assert.match(routes, /router\.delete\("\/employees\/:employeeId", controller\.removeEmployeeFromGroups\);/);
  assert.ok(routes.indexOf('requireModule("HRM", "Employee Management")') < routes.indexOf('router.delete("/employees/:employeeId"'));
});

test("coming back puts them into their departments' groups again - from the endpoint that does it", () => {
  const employees = read("src/modules/hrm/employees/controller.js");
  /*
   * The hook has to sit in `reactivateEmployee`. It was written in `updateEmployee` first and never
   * fired once: bringing somebody back is its own endpoint, and the ordinary save of the employee
   * form is not how a studio marks an inactive employee active again. The activity log is what
   * showed it - `reactivateEmployee` against the status change, while the hook waited somewhere else.
   */
  const reactivate = employees.slice(employees.indexOf("async function reactivateEmployee"));
  const body = reactivate.slice(0, reactivate.indexOf("Unable to reactivate this employee"));
  assert.match(body, /addEmployeeToDepartmentGroups\(id, \{ userId: Number\(req\.user\.id\) \|\| null, revive: true \}\)/);
  // After the commit, and before either answer - a rejoin with a new login answers from a second
  // return, and a hook after only the first would miss every employee who has one.
  assert.ok(body.indexOf("addEmployeeToDepartmentGroups") < body.indexOf("if (!data.login) return res.json"));
  // And it is not left behind in the save that never ran it.
  const update = employees.slice(employees.indexOf("async function updateEmployee"), employees.indexOf("async function reactivateEmployee"));
  assert.doesNotMatch(update, /addEmployeeToDepartmentGroups/, "a hook that cannot fire is worse than none");
});

test("reviving moves a REMOVED row back, and leaves every other state alone", () => {
  const service = read("src/modules/hrm/whatsapp-groups/service.js");
  /*
   * A leaver's rows all read REMOVED, and the create-only rule would skip exactly the groups they are
   * returning to. One that is ADDED needs nothing; one that FAILED is retried from their own screen,
   * where somebody can read why.
   */
  assert.match(service, /where: \{ employeeId: Number\(employeeId\), groupId, status: "REMOVED" \}/);
  assert.match(service, /revive = false \} = \{\}\)/, "off unless a caller asks, so onboarding is unchanged");
  const at = service.indexOf('status: "REMOVED" }');
  assert.ok(at > service.indexOf("if (revive) {"), "only under revive");
  // Only their departments' groups: a hand-added group is a decision somebody made.
  assert.match(service, /Only their \*\*departments'\*\* groups come back/);
});

test("an employee in no group is told so rather than told nothing happened", () => {
  assert.match(read("src/modules/hrm/whatsapp-groups/controller.js"), /This employee is not in any group the app has a record of\./);
});

test("the screen asks first, and offers it only where there is something to leave", () => {
  const panel = read("../frontend/src/components/employees/EmployeeWhatsAppGroups.js");
  assert.match(panel, /\{canWrite && inGroups\.length > 0 && <div/, "absent rather than present and refusing");
  assert.match(panel, /<ConfirmDialog/);
  // It cannot be undone from this screen - putting them back is one Add per group - so it is asked.
  assert.match(panel, /Putting them back is one Add per group\./);
  assert.match(panel, /onConfirm=\{\(\) => void removeFromAll\(\)\}/);
});
