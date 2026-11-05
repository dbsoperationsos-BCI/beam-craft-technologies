const express = require("express");
const { requireTemplateOn } = require("../../../services/messageTemplateSwitches");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
/*
 * The WhatsApp module's own send limiter, reused rather than reinvented.
 *
 * Every other path that reaches `socket.sendMessage` is behind it, and it is keyed per **user**
 * (`send:user:<id>`) rather than per route - so a person's WhatsApp gets one budget of 30 a minute
 * across the CRM and these two, which is the honest shape: it is one paired account, and WhatsApp
 * is watching the account. Two separate budgets would have meant 60.
 *
 * Without it these were the only sends in the application a loop could drive - a stolen token or a
 * careless script turning the studio's number into something WhatsApp reads as a broadcaster, which
 * is precisely what gets it banned.
 */
const { limits: whatsappLimits } = require("../../sales/whatsapp-chat/security");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { getPayslipDetailsForEmployees } = require("../../settings/template-settings/controller");
const { definitions } = require("./definitions");
const { createController } = require("./controller");
const { sendCredentialsWhatsApp, listEmployees, employeeDirectory, previewNextEmployeeId, createEmployee, employeeImportTemplate, importEmployees, updateEmployee, deleteEmployee, deleteEmployeeRecord, createLoginCredentials, getLoginCredentialsDraft, saveLoginCredentialsDraft,
  getLoginCredentials,
  updateLoginCredentials, reactivateEmployee } = require("../employees/controller");
const employeeCertificates = require("../employees/certificates.controller");
const { createInvite, updateInvite, listInvites, cancelInvite, sendInviteEmail, sendInviteWhatsApp, sendBackOnboarding } = require("../onboarding-invites/controller");
const offboarding = require("../offboarding-invites/controller");
const { getPendingWork, handOverPendingWork, listSeparations, getSeparation, createSeparation, updateSeparation, deleteSeparation } = require("../separations/controller");

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
// Whether the payslip carries the PF details (Settings → Template Settings), for Edit Employee →
// Payslip Details - the record's own permission, since it is part of that record's form.
router.get("/employees/payslip-details", readsEmployees, getPayslipDetailsForEmployees);
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
// Administration → ⋮ → Generate → Experience or Employment Certificate (`:kind`): the filled
// certificate, as HTML for the preview and as a PDF. POSTs, so behind Employee Management Read /
// Write like the rest of the ⋮.
router.post("/employees/:id/certificates/:kind", employeeCertificates.previewCertificate);
router.post("/employees/:id/certificates/:kind/pdf", employeeCertificates.downloadCertificate);
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
 * The credentials just created, sent on WhatsApp from the sender's own account.
 *
 * Beside the create for the same reason the invite's WhatsApp sits beside its email, and asking
 * the same permission the create asks: the message carries the temporary password, so
 * `ADMIN / User Management` Read / Write is checked in the handler - this router's own rule
 * answers for the employee record, which is a different question.
 */
router.post("/employees/:id/send-credentials-whatsapp", requireTemplateOn("LOGIN_CREDENTIALS"), whatsappLimits.send, sendCredentialsWhatsApp);
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
// The same invite on WhatsApp, from the sender's own paired account. Beside the email because it
// is the same act by another route, and guarded by the same rule - a POST here needs
// HRM / Employee Management Read / Write. The candidate's number is read off the invite.
router.post("/onboarding-invites/:id/send-whatsapp", requireTemplateOn("EMPLOYEE_ONBOARDING_INVITE"), whatsappLimits.send, sendInviteWhatsApp);
/*
 * Offboarding forms, beside the onboarding invites and under the same rule: this router's own guard
 * decides, so a GET needs `HRM / Employee Management` at Read and everything else at Read / Write -
 * the same permission that records a separation by hand, because this is the same act by another
 * route. The employee's own form is public and answers by token (`offboarding-invites/publicRoutes`).
 *
 * `/candidates` above `/:id` so "candidates" is never read as a form's id.
 */
router.get("/offboarding-invites", checkPermission("HRM", "Employee Management", "READ"), offboarding.listInvites);
router.get("/offboarding-invites/candidates", checkPermission("HRM", "Employee Management", "READ"), offboarding.listCandidates);
router.post("/offboarding-invites", offboarding.createInvite);
router.post("/offboarding-invites/:id/send-email", offboarding.sendInviteEmail);
// The form, a reminder, the confirmation or the refusal on WhatsApp - Read / Write, through the guard
// above; the message's own switch under Settings → Templates is asked by the handler, by `kind`.
router.post("/offboarding-invites/:id/send-whatsapp", whatsappLimits.send, offboarding.sendInviteWhatsApp);
// Correcting a form already sent: the notice period, the note, the expiry. Not who it is for - that
// is a cancel and a fresh form, so nobody is left holding a link that names somebody else.
router.patch("/offboarding-invites/:id", offboarding.updateInvite);
router.patch("/offboarding-invites/:id/cancel", offboarding.cancelInvite);
router.post("/offboarding-invites/:id/review", offboarding.reviewInvite);
// Handed back for a correction, which is neither approving nor rejecting: the form reopens on the
// same link with the employee's own answers still on it.
router.post("/offboarding-invites/:id/send-back", offboarding.sendBackInvite);
/*
 * Deleting a form: one from its ⋮, or the ticked rows together. A DELETE, so this router's guard asks
 * `HRM / Employee Management` Read / Write; the bulk route asks `ADMIN / Table Select All` on top.
 * Both run `deleteInviteRecord`, so a form out of reach is missed the same way. `/bulk` is mounted
 * first, being a fixed segment `/:id` would otherwise read as an id.
 */
mountBulkDelete(router, { path: "/offboarding-invites/bulk", deleteOne: (id, req) => offboarding.deleteInviteRecord(req, id), noun: "resignation form" });
router.delete("/offboarding-invites/:id", offboarding.deleteInvite);

// A separation is why somebody left; reading one is HRM's, not the session's.
// What somebody still has pending, for the hand-over pop-up. Write, not read: it is asked only by
// somebody about to offboard them, and it lists work across the CRM and the project boards.
router.get("/separations/pending-work/:employeeId", checkPermission("HRM", "Employee Management", "READ_WRITE"), getPendingWork);
// Moving what a leaver still held, once they have gone: nothing is reassigned while somebody is
// serving notice, because the work is still theirs to finish (`recordSeparation`, `relieve.js`).
router.post("/separations/pending-work/:employeeId", checkPermission("HRM", "Employee Management", "READ_WRITE"), handOverPendingWork);
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
