const express = require("express");
const { requireTemplateOn } = require("../../../services/messageTemplateSwitches");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule, checkPermission, checkAnyPermission, checkPermissions } = require("../../../middleware/permissionMiddleware");
const { getProject, listProjects, listEnquiries, listQuotations, listQuotationShareCandidates, saveQuotationShares, getQuotation, createQuotation, createQuotationVersion, duplicateQuotation, createQuotationDraft, previewQuotation, updateQuotationDraft, generateQuotationDraft, renewQuotationLink, finalizeQuotation, unfinalizeQuotation, deleteQuotation, deleteQuotationChainRecord, quotationPdf, listSourceBranches, listCrmEmployees, listActiveEmployees, createProject, projectImportTemplate, importProjects, updateProject, deleteProject, bulkUpdateProjectStatus, deleteProjectRecord, startProject, saveStartProjectDraft, listProjectShoots, listProjectPayments, sendBackProject, returnToProjects, createProjectShoots, updateProjectShoot, deleteProjectShoot, listProductionDeliverables, replaceProductionDeliverables, listProjectOptionSets, createProjectOptionSetValue, updateProjectOptionSetValue, deleteProjectOptionSetValue, listServiceDefinitions, createServiceDefinition, updateServiceDefinition, deleteServiceDefinition, reorderServiceDefinitions, listDeliverableDefinitions, createDeliverableDefinition, updateDeliverableDefinition, deleteDeliverableDefinition, reorderDeliverableDefinitions, listServiceAllocations, createServiceAllocation, updateServiceAllocation, deleteServiceAllocation, reorderServiceAllocations, listDeliverableAllocations, createDeliverableAllocation, updateDeliverableAllocation, deleteDeliverableAllocation, reorderDeliverableAllocations, requireStartedProjectEditor, requireProjectEditor, requireProjectDeleter, SHOW_ALL_PROJECTS_WRITE, mayEditBookings, recordProjectAdvance, projectAdvanceOptions, sendClientLoginWhatsApp, getClientLogin, createClientLogin, getClientLoginByNumber, reorderProjectShoots } = require("./controller");
const { limits: whatsappLimits } = require("../whatsapp-chat/security");
const { getProjectStage, getProjectCrdResponse, recordStageUpdate } = require("./stage");
const { getProjectPaymentSchedule, saveProjectPaymentSchedule, getProjectActivity } = require("./paymentSchedule");
const saleExtras = require("../sale-extras/controller");

const router = express.Router();

router.use(protect);

/*
 * One router, five screens, and they are not the same job.
 *
 * Sales Manager sells the project; Projects turns the sale into a plan of shoots and deliverables;
 * Pre, Production and Post read that plan as it moves; CRD Documents issues a document off the back
 * of it. All five have to *read* the project register, so that read is shared and everything that
 * changes something sits behind the permission for the screen that changes it.
 *
 * Splitting the read out is what lets the five be granted apart at all. Left as one guard, giving
 * somebody the production boards also gave them the power to delete a sale.
 */
// Defined beside the scope that reads them, so the guard and the data scope name one list.
const { REGISTER_READERS } = require("../../../services/projectScope");
const readsTheRegister = checkAnyPermission(REGISTER_READERS);

const salesManager = requireModule("SALES", "Sales Manager");
const quotations = requireModule("SALES", "Quotation Management");
const projectPlan = requireModule("PROJECT", "Projects");
/*
 * The second question every write against one project has to answer.
 *
 * `projectPlan` asks whether this person may plan projects at all. This asks whether *this* project
 * is still theirs to change: once it has started, only its Project Manager or a holder of
 * `ADMIN / Branch Administration` may, because by then the plan is being worked to rather than made
 * (see `requireStartedProjectEditor`). Mounted route by route rather than on the router, because
 * the reads beside them are open to every screen that lists a project and the definitions below
 * belong to the studio rather than to any one project.
 */
const editsAStartedProject = requireStartedProjectEditor;

/*
 * The two writes that act on a project **as a whole**, and the pair of guards each takes.
 *
 * `answersForAProject` is the permission layer: either screen's own write, because one endpoint
 * feeds both and a screen may not be given a finer permission than the endpoint it reads. It is the
 * *ownership* check behind it that actually decides, and the two differ on purpose:
 *
 *   - **changing** a project is for anybody it is staffed to - its Project Manager, its Pre
 *     Production Coordinator, its Creative Manager, its Post Production Coordinator - because each
 *     of them is working to it and each has reason to correct what it says;
 *   - **deleting** it is for its Project Manager alone. A coordinator runs a stage of the work;
 *     removing the project out from under everybody else working to it is not a stage of anything.
 *
 * A branch administrator passes either, and a Super Admin holds that along with everything else.
 * See `mayEditProject` and `mayDeleteProject`.
 *
 * Why the sale's permission alone is no longer enough: `SALES / Sales Manager` `READ_WRITE` is what
 * books a project, and it was also the whole of the guard on editing and deleting one. So the CRM
 * who typed a booking could rewrite it long after the studio had begun working to it, and could
 * delete it outright. Making one and unmaking one are not the same act, and they no longer answer to
 * the same question.
 *
 * `PROJECT / Projects` `READ_WRITE` is named beside it so the Project Manager - who plans projects
 * and need not hold the sale's permission at all - can reach their own project's record.
 */
const answersForAProject = checkAnyPermission([
  { module: "SALES", feature: "Sales Manager", level: "READ_WRITE" },
  { module: "PROJECT", feature: "Projects", level: "READ_WRITE" },
  SHOW_ALL_PROJECTS_WRITE,
]);

/*
 * Planning **one project**, which is `PROJECT / Projects` or the studio-wide grant beside it.
 *
 * `projectPlan` still guards the studio's own vocabulary below - service and deliverable
 * definitions, option sets - because those are the studio's master data rather than any one
 * project's, and somebody trusted with every project is not thereby trusted to rewrite the lists
 * every project is planned from. This is the per-project half: the start-project pair, shoots,
 * allocations and production deliverables, which is what "may start and run any project" means.
 */
const plansAProject = checkAnyPermission([
  { module: "PROJECT", feature: "Projects", level: "READ_WRITE" },
  SHOW_ALL_PROJECTS_WRITE,
]);

// ---- the register and its vocabulary: readable by every screen that lists a project ----
router.get("/projects", readsTheRegister, listProjects);
router.get("/crm-employees", readsTheRegister, listCrmEmployees);
router.get("/active-employees", readsTheRegister, listActiveEmployees);
router.get("/source-branches", readsTheRegister, listSourceBranches);
router.get("/project-option-sets", readsTheRegister, listProjectOptionSets);
router.get("/service-definitions", readsTheRegister, listServiceDefinitions);
router.get("/deliverable-definitions", readsTheRegister, listDeliverableDefinitions);

// ---- the sale ----
router.get("/enquiries", salesManager, listEnquiries);
router.post("/projects", salesManager, createProject);
/*
 * The advance a project is booked with, under the permission that booked it.
 *
 * A cash entry, written by the Accounts module's own recorder - but guarded here rather than on
 * `POST /api/accounts/cash-entries`, which answers to `ACCOUNTS / Cash Management`. Somebody booking
 * a project is typing what the client just handed over, against the project they are creating;
 * requiring the whole cash book for that meant handing out the books or leaving the advance to
 * somebody else. See `recordProjectAdvance` for what keeps it narrow.
 */
router.post("/projects/:id/advance", salesManager, recordProjectAdvance);
// Create Project → Client Login Ready → Send WhatsApp: the client's login, from the sender's own
// WhatsApp to the project's client number. On the booking's permission, like making the login
// itself - no admin permission in it; the rate limit is every WhatsApp send's.
router.post("/projects/:id/client-login/whatsapp", salesManager, requireTemplateOn("CLIENT_LOGIN_CREDENTIALS"), whatsappLimits.send, sendClientLoginWhatsApp);
/*
 * The two lists that advance's dropdowns need. Above `/projects/:id` so "advance-options" is not
 * read as a project id, and under the same guard as the write it serves - the Accounts options
 * endpoint is behind `ACCOUNTS / Cash Management`, which is what left the Receiver dropdown empty
 * for the very people the section had just been shown to.
 */
router.get("/projects/advance-options", salesManager, projectAdvanceOptions);
// Importing a spreadsheet of bookings, behind the same guard `POST /projects` answers to.
router.get("/projects/import/template", salesManager, projectImportTemplate);
/*
 * The Boards' money: received, spent and still to receive for many projects at once. Under exactly
 * the guards of one project's Payments tab (`/projects/:id/payments` below) - Cash Management to see
 * money at all, and a board that lists projects - and each project still through the reader's own
 * reach. Before `/projects/:id`, so "payments-summary" is never read as an id.
 */
router.get("/projects/payments-summary", checkPermission("ACCOUNTS", "Cash Management", "READ"), checkAnyPermission([
  { module: "PROJECT", feature: "Projects", level: "READ" },
  { module: "PROJECT", feature: "Production", level: "READ" },
  { module: "PROJECT", feature: "Pre Production", level: "READ" },
]), require("./payments-summary").projectsPaymentsSummary);
router.post("/projects/import", salesManager, importProjects);
router.patch("/projects/:id", answersForAProject, requireProjectEditor, updateProject);
// Send Back to Bookings & Converted - whoever may write PROJECT / Projects (the studio's choice), for a
// project in their reach. Undone by the next save of its sale details, under the route above.
router.post("/projects/:id/send-back", checkPermission("PROJECT", "Projects", "READ_WRITE"), sendBackProject);
// Edit Sale Details' Update to Project with nothing changed on the form: the return alone, guarded as
// the edit above is - whoever may change this booking may hand it back to Projects.
router.post("/projects/:id/return-to-projects", answersForAProject, requireProjectEditor, returnToProjects);
// Edit Sale Details → Client Credentials: the project's client login, and one made for a project
// booked without it. Guarded like the edit itself, and by nothing else: a client login reaches one
// project's portal, so making it belongs to whoever may change that booking.
// Create Project: whether the Client Main Number already has a client login (a returning client).
router.get("/client-logins/by-number", salesManager, getClientLoginByNumber);
router.get("/projects/:id/client-login", answersForAProject, getClientLogin);
router.post("/projects/:id/client-login", answersForAProject, requireProjectEditor, createClientLogin);
/*
 * The ticked bookings, deleted together. Above `/projects/:id` because `/bulk` is a fixed segment.
 *
 * `answersForAProject` is mounted here as it is on the route below - the screen's own permission,
 * which `mountBulkDelete` then pairs with `ADMIN / Table Select All`. `requireProjectDeleter` is
 * **not**, and cannot be: it is middleware that reads one id out of the URL, and these arrive forty
 * at a time in the body. Its rule is asked per project inside `deleteProjectRecord` instead, so a
 * selection still loses only the projects this person manages and keeps the rest ticked.
 *
 * A selection moves the projects to Resource Management → Recycling Bin, exactly as the single
 * Delete below does; erasing one for good is the bin's Delete permanently.
 */
mountBulkDelete(router, {
  path: "/projects/bulk",
  guard: answersForAProject,
  deleteOne: (id, req) => deleteProjectRecord(req, String(id)),
  noun: "project",
});
/*
 * Projects → Update status over the ticked projects. Fixed segment, so above `/projects/:id`; each
 * project is still checked one by one for reach and for being the caller's to change (the handler).
 */
router.post("/projects/bulk-status", plansAProject, bulkUpdateProjectStatus);
router.delete("/projects/:id", answersForAProject, requireProjectDeleter, deleteProject);

// ---- quotations: their own screen, and now their own permission rather than the sale's ----
//
// There is no PATCH here on purpose. A quotation is not edited: an edit raises the next version of
// its chain, which is a create, and the version already sent stays as it was sent. Only a draft,
// which nobody has been sent, is saved over - see the draft routes below.
router.get("/quotations", quotations, listQuotations);
/*
 * Who a quotation can be shared with. `READ_WRITE`, not the router's read: it is the employee
 * directory with a line on each saying whether they hold Quotation Management, and it is read only
 * by the form that shares a quotation - which is a write.
 */
router.get("/quotations/share-candidates", checkPermission("SALES", "Quotation Management", "READ_WRITE"), listQuotationShareCandidates);
router.get("/quotations/:id", quotations, getQuotation);
// The studio's own copy of a version as a file. A read of the quotation, so READ is enough - and
// it is deliberately *not* governed by the brand's Allow Client Download, which decides what the
// client's link hands out and not what the studio may save.
router.get("/quotations/:id/pdf", quotations, quotationPdf);
router.post("/quotations", quotations, createQuotation);
router.post("/quotations/:id/versions", quotations, createQuotationVersion);
/*
 * Who the quotation is shared with, saved on its own. Deliberately not part of a version: a version
 * is the document the client receives, and who at the studio can open it is not in it - so sharing
 * leaves the quotation on the version it was on.
 */
router.put("/quotations/:id/shares", quotations, saveQuotationShares);
router.post("/quotations/:id/duplicate", quotations, duplicateQuotation);
router.post("/quotations/:id/link", quotations, renewQuotationLink);
// Finalize / Unfinalize the version: Quotation Management at Read / Write, as every write here.
router.post("/quotations/:id/finalize", quotations, finalizeQuotation);
router.post("/quotations/:id/unfinalize", quotations, unfinalizeQuotation);
// Save Draft and Generate on a draft. The one place a quotation row is rewritten: a draft has been
// sent to nobody, and the handlers refuse anything that is no longer a draft. Writes, so the
// screen's own guard asks READ_WRITE of all three.
router.post("/quotations/drafts", quotations, createQuotationDraft);
// The client's copy of the unsaved form, written nowhere - see `previewQuotation`.
router.post("/quotations/preview", quotations, previewQuotation);
router.put("/quotations/:id/draft", quotations, updateQuotationDraft);
router.post("/quotations/:id/generate", quotations, generateQuotationDraft);
// The ticked quotations, deleted together - above `/quotations/:id`, since `/bulk` is fixed. The
// screen's own `quotations` guard is mounted exactly as it is below; `mountBulkDelete` adds
// `ADMIN / Table Select All`, and `scopedQuotation` still narrows every id inside the body. A
// ticked row is a whole chain, so each id takes every version of it - where the row menu's Delete
// below takes only the one version.
mountBulkDelete(router, {
  path: "/quotations/bulk",
  guard: quotations,
  deleteOne: (id, req) => deleteQuotationChainRecord(req, String(id)),
  noun: "quotation",
});
router.delete("/quotations/:id", quotations, deleteQuotation);

// ---- the plan: starting a project and everything hung off it ----
router.patch("/projects/:id/start-project-draft", plansAProject, editsAStartedProject, saveStartProjectDraft);
router.patch("/projects/:id/start-project", plansAProject, editsAStartedProject, startProject);
// One project as the register shows it, by id or Event ID - read after an edit, or to open one,
// instead of the whole register. Below every named /projects/<word> read, so none of them is
// taken for an id.
router.get("/projects/:id", readsTheRegister, getProject);
router.get("/projects/:id/shoots", readsTheRegister, listProjectShoots);
// The Status tab of Project Management's project panel reads under the panel's own permission.
// The Overall Status, read on every screen that lists a project - Bookings & Converted, Projects, Pre
// Production, Production - so behind the register's own readers; `getProjectStage` narrows the
// project by the same scope the register does. Updating a stage stays the planner's, below.
router.get("/projects/:id/stage", readsTheRegister, getProjectStage);
// The project's submitted CRD document, read-only, for the Overall Status's View - the same readers.
router.get("/projects/:id/crd-response", readsTheRegister, getProjectCrdResponse);
// The remark left after updating a stage from the Status tab; the edit itself went through that stage's own route.
router.post("/projects/:id/stage/updates", plansAProject, editsAStartedProject, recordStageUpdate);
router.post("/projects/:id/shoots", plansAProject, editsAStartedProject, createProjectShoots);
// The Shoot List's dragged order - the same guards as adding or editing a shoot, since it is the plan's.
router.put("/projects/:id/shoots/order", plansAProject, editsAStartedProject, reorderProjectShoots);
router.patch("/projects/:id/shoots/:shootId", plansAProject, editsAStartedProject, updateProjectShoot);
router.delete("/projects/:id/shoots/:shootId", plansAProject, editsAStartedProject, deleteProjectShoot);
/*
 * A project's money, and it takes both permissions.
 *
 * The rows are Accounts' cash entries, so whoever reads them here reads them under the permission
 * that owns them — `ACCOUNTS / Cash Management` — and not merely because they can open a project.
 * `PROJECT / Projects` is asked for as well because this is that screen: it is the projects
 * register answering for one of its own records. Somebody holding one without the other sees no
 * Payments tab at all, and the endpoint refuses them.
 *
 * That also keeps it out of the shared register read the four `PROJECT` features and `SALES` share:
 * a production board lists a project without being shown what it took in or paid out.
 *
 * The same Payments section is on the Production and Pre Production project panels, so either of
 * those boards stands in for Projects - **never** for Cash Management, which is still asked for every
 * time: a board alone shows no money. The project itself must be in the reader's reach
 * (`projectAccessWhere`), whichever board they came from.
 */
/*
 * Sale Extras, Edit Sale Details' Extra section: read by the register's readers (each project then
 * reached through their own scope); an amount typed and a revision published under exactly the guards
 * Edit Sale Details is saved under (`PATCH /projects/:id`).
 */
router.get("/projects/:id/sale-extras", readsTheRegister, saleExtras.list);
router.post("/projects/:id/sale-extras/publish", answersForAProject, requireProjectEditor, saleExtras.publish);
// A service or deliverable taken off or put back from its line's ⋮ - the same rows Service Creation
// changes, so the same guards its own delete and add take.
router.post("/projects/:id/sale-extras/:extraId/restore", plansAProject, editsAStartedProject, saleExtras.restore);
router.post("/projects/:id/sale-extras/:extraId/remove", plansAProject, editsAStartedProject, saleExtras.remove);
// A published line's amount put right in the next revision, and a draft correction taken back.
router.get("/projects/:id/payments", checkPermission("ACCOUNTS", "Cash Management", "READ"), checkAnyPermission([
  { module: "PROJECT", feature: "Projects", level: "READ" },
  { module: "PROJECT", feature: "Production", level: "READ" },
  { module: "PROJECT", feature: "Pre Production", level: "READ" },
]), listProjectPayments);
/*
 * The project's Schedule Payment - money, so read only by the two forms that show it: Create
 * Project (the sale) and Start / Edit Project (the plan), not by every board that lists a project.
 * Saved by Start / Edit Project under the plan's own pair of guards, and by Create Project right
 * after the project is made, under the permission that booked it - as its advance is.
 */
router.get("/projects/:id/payment-schedule", checkAnyPermission([
  { module: "SALES", feature: "Sales Manager", level: "READ" },
  { module: "PROJECT", feature: "Projects", level: "READ" },
  { module: "PROJECT", feature: "Show All Projects", level: "READ" },
]), getProjectPaymentSchedule);
/*
 * Changing a saved schedule.
 *
 * Two ways through, because two different jobs change one. Whoever **plans** projects does it as part
 * of the plan, and then this project's own started rule applies (`editsAStartedProject`). And whoever
 * holds `SALES / Booking Edit` does it as part of the booking they may already change - the schedule
 * is agreed when the sale is, and a CRM correcting a booking has to be able to correct its schedule
 * with it. The grant is checked first because it answers for any project the caller can see, so there
 * is nothing further to ask.
 */
const editsASchedule = async (req, res, next) => {
  try {
    if (await mayEditBookings(req.user)) return next();
  } catch (error) {
    return next(error);
  }
  return plansAProject(req, res, (error) => (error ? next(error) : editsAStartedProject(req, res, next)));
};
router.put("/projects/:id/payment-schedule", editsASchedule, saveProjectPaymentSchedule);
router.post("/projects/:id/payment-schedule", salesManager, saveProjectPaymentSchedule);
/*
 * The project's Activity tab - its whole flow, enquiry to feedback - on every screen whose panel shows
 * a project (Projects, Pre Production, Production, Post Production, Bookings & Converted), so under the
 * register's own readers; the project must be in the reader's reach, and each stage of the flow asks
 * its own permission besides (`services/projectFlow.js`).
 */
router.get("/projects/:id/activity", readsTheRegister, getProjectActivity);
router.get("/projects/:id/production-deliverables", readsTheRegister, listProductionDeliverables);
router.put("/projects/:id/production-deliverables", plansAProject, editsAStartedProject, replaceProductionDeliverables);
router.get("/projects/:id/service-allocations", readsTheRegister, listServiceAllocations);
router.post("/projects/:id/shoots/:shootId/service-allocations", plansAProject, editsAStartedProject, createServiceAllocation);
router.patch("/projects/:id/service-allocations/:allocationId", plansAProject, editsAStartedProject, updateServiceAllocation);
// One shoot's lines put in the order they were dragged to - the same guards as editing a line.
router.put("/projects/:id/shoots/:shootId/service-allocations/order", plansAProject, editsAStartedProject, reorderServiceAllocations);
router.delete("/projects/:id/service-allocations/:allocationId", plansAProject, editsAStartedProject, deleteServiceAllocation);
router.get("/projects/:id/deliverable-allocations", readsTheRegister, listDeliverableAllocations);
router.post("/projects/:id/shoots/:shootId/deliverable-allocations", plansAProject, editsAStartedProject, createDeliverableAllocation);
router.patch("/projects/:id/deliverable-allocations/:allocationId", plansAProject, editsAStartedProject, updateDeliverableAllocation);
router.put("/projects/:id/shoots/:shootId/deliverable-allocations/order", plansAProject, editsAStartedProject, reorderDeliverableAllocations);
router.delete("/projects/:id/deliverable-allocations/:allocationId", plansAProject, editsAStartedProject, deleteDeliverableAllocation);

// ---- the definitions and option sets the plan is built from ----
router.post("/project-option-sets/:optionSetId/values", projectPlan, createProjectOptionSetValue);
router.patch("/project-option-sets/:optionSetId/values/:valueId", projectPlan, updateProjectOptionSetValue);
// Retires a value rather than removing the row: the allocations that chose it still point at it.
router.delete("/project-option-sets/:optionSetId/values/:valueId", projectPlan, deleteProjectOptionSetValue);
// The order Settings drags the rows into. Before `/:definitionId`, which would read `order` as an id.
router.put("/service-definitions/order", projectPlan, reorderServiceDefinitions);
router.post("/service-definitions", projectPlan, createServiceDefinition);
router.patch("/service-definitions/:definitionId", projectPlan, updateServiceDefinition);
// Retires a service rather than removing the row - see the handler for why the history matters.
router.delete("/service-definitions/:definitionId", projectPlan, deleteServiceDefinition);
router.put("/deliverable-definitions/order", projectPlan, reorderDeliverableDefinitions);
router.post("/deliverable-definitions", projectPlan, createDeliverableDefinition);
router.patch("/deliverable-definitions/:definitionId", projectPlan, updateDeliverableDefinition);
// Retired, not removed, for the same reason as a service.
router.delete("/deliverable-definitions/:definitionId", projectPlan, deleteDeliverableDefinition);

module.exports = router;
