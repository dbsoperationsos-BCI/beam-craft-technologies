const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { definitions } = require("./definitions");
const { createController } = require("./controller");
const { listEmployees, employeeDirectory, previewNextEmployeeId, createEmployee, employeeImportTemplate, importEmployees, updateEmployee, deleteEmployee, deleteEmployeeRecord, createLoginCredentials, getLoginCredentialsDraft, saveLoginCredentialsDraft,
  getLoginCredentials,
  updateLoginCredentials, reactivateEmployee } = require("../employees/controller");
const { createInvite, updateInvite, listInvites, cancelInvite, sendInviteEmail, sendBackOnboarding } = require("../onboarding-invites/controller");
const { listSeparations, getSeparation, createSeparation, updateSeparation, deleteSeparation } = require("../separations/controller");

const router = express.Router();
router.use(protect);
// Reference data - departments, designations, branches - is read all over the app: the branch
// pickers on the Roles and Users screens come from here, and gating those reads on HRM would lock
// an administrator out of their own screens. So reads need only a session; changing the lists is
// what needs HRM.
//
// The pass is for the reference lists and nothing else. The employee rows, the separations, the
// onboarding invites and the login credentials all live on this router too, and none of them is
// reference data: an employee row carries a person's children, qualifications, reviews and login,
// and a separation carries why somebody left. Each of those reads carries its own `READ` guard
// below, because the blanket pass would otherwise hand the whole repository to any signed-in
// session - a role holding only Client Storage could read every employee's family.
router.use((req, res, next) => (req.method === "GET" || req.method === "HEAD"
  ? next()
  : checkPermission("HRM", "Employee Management", "READ_WRITE")(req, res, next)));
const readsEmployees = checkPermission("HRM", "Employee Management", "READ");
// Keep these static routes before any employee identifier routes.
router.get("/employees/next-employee-id", readsEmployees, previewNextEmployeeId);
// The people a picker may name - id, Employee ID and name, nothing else - for the screens whose
// roles do not hold HRM: Asset Management hands an asset to somebody, Client Storage names who
// holds a shoot. A session is enough, the way it is for the reference lists, because a list of who
// works here is the studio's shape; the repository behind `/employees` is not.
router.get("/employees/directory", employeeDirectory);
router.get("/employees", readsEmployees, listEmployees);
router.post("/employees", createEmployee);
// Importing a spreadsheet of employees, behind the same guard `POST /employees` answers to: it
// writes employees, so it needs what writing one needs and nothing more.
router.get("/employees/import/template", checkPermission("HRM", "Employee Management", "READ_WRITE"), employeeImportTemplate);
router.post("/employees/import", importEmployees);
router.patch("/employees/:id", updateEmployee);
/*
 * The ticked rows, archived together. Above `/employees/:id` because `/bulk` is a fixed segment.
 *
 * The router-wide guard at the top reads a DELETE as a write, so Read / Write on
 * `HRM / Employee Management` is needed to reach this, and `mountBulkDelete` asks for
 * `ADMIN / Table Select All` on top. Every condition of removing a person still holds per row:
 * `deleteEmployeeRecord` runs the same `removeEmployee` the single route does, so somebody out of
 * scope is missed, somebody still holding assets is refused and named, and every archived employee
 * has their login closed in the same transaction.
 */
mountBulkDelete(router, { path: "/employees/bulk", deleteOne: (id, req) => deleteEmployeeRecord(req, id), noun: "employee" });
router.delete("/employees/:id", deleteEmployee);
// Bringing somebody in the InActive tab back to work: the offboarding is removed, the status goes
// back to the one they held before it, and their login is reopened. A write on the employee, so it
// answers to the same `HRM / Employee Management` READ_WRITE the router already puts on every
// non-GET above - there is no separate permission for it and nothing for one to be granted to.
router.post("/employees/:id/reactivate", reactivateEmployee);
router.post("/employees/:id/create-login-credentials", createLoginCredentials);
/*
 * The Login Credentials page, put down half-finished and picked up again.
 *
 * Both carry their own guard inside the controller - `ADMIN / User Management` write, the same
 * permission creating the account asks for - because a draft holds the password the account will
 * start on. The GET needs that especially: the blanket pass above lets any signed-in session read
 * this router, which is right for departments and branches and quite wrong for a half-made
 * credential.
 */
router.get("/employees/:id/login-credentials-draft", getLoginCredentialsDraft);
router.put("/employees/:id/login-credentials-draft", saveLoginCredentialsDraft);
/*
 * The same page for an account that already exists, so Edit Employee can show it too.
 *
 * Both carry the same in-controller `ADMIN / User Management` guard as the draft above, and for the
 * same reason: the blanket pass on this router is there for departments and branches, and who may
 * sign in as whom is not reference data. The PATCH takes only what the page may change - roles,
 * cover and leave approval - never the username, email or password, which stay Admin -> User
 * Management's.
 */
router.get("/employees/:id/login-credentials", getLoginCredentials);
router.patch("/employees/:id/login-credentials", updateLoginCredentials);
// Reopens a submitted onboarding under its original link and emails the candidate again.
router.post("/employees/:id/send-back-onboarding", sendBackOnboarding);
router.post("/onboarding-invites", createInvite);
// Correcting an invite already created - a mistyped address or number - without issuing a new
// link. A write against the same permission the rest of this router carries.
router.patch("/onboarding-invites/:id", updateInvite);
// The blanket GET pass above exists for reference data; invite rows are not that — they carry
// candidate contact details and, now that codes are stored, a working onboarding link per row.
// Even reading them is privileged, so this one GET carries its own guard.
router.get("/onboarding-invites", checkPermission("HRM", "Employee Management", "READ"), listInvites);
router.patch("/onboarding-invites/:id/cancel", cancelInvite);
router.post("/onboarding-invites/:id/send-email", sendInviteEmail);
// A separation is why somebody left; reading one is HRM's, not the session's.
router.get("/separations", readsEmployees, listSeparations);
router.post("/separations", createSeparation);
router.get("/separations/:id", readsEmployees, getSeparation);
router.patch("/separations/:id", updateSeparation);
router.delete("/separations/:id", deleteSeparation);

for (const key of Object.keys(definitions)) {
  const controller = createController(key);
  const resource = `/${key}`;
  router.get(resource, controller.list);
  router.post(resource, controller.create);
  router.get(`${resource}/:id`, controller.get);
  router.patch(`${resource}/:id`, controller.update);
  router.delete(`${resource}/:id`, controller.remove);
}

// The branch list answered as `/locations` until the table was renamed to `branch`. Kept as a
// read-only alias so a caller not yet updated still fills its branch pickers; managing the list
// happens under `/branches`, and this alias goes once nothing asks for the old name.
router.get("/locations", createController("branches").list);

module.exports = router;
