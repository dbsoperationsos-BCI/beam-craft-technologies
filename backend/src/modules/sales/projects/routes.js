const express = require("express");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule, checkAnyPermission, checkPermissions } = require("../../../middleware/permissionMiddleware");
const { listProjects, listEnquiries, listQuotations, getQuotation, createQuotation, createQuotationVersion, duplicateQuotation, renewQuotationLink, deleteQuotation, deleteQuotationRecord, quotationPdf, listSourceBranches, listCrmEmployees, listActiveEmployees, createProject, projectImportTemplate, importProjects, updateProject, deleteProject, deleteProjectRecord, startProject, saveStartProjectDraft, listProjectShoots, listProjectPayments, createProjectShoots, updateProjectShoot, deleteProjectShoot, listProductionDeliverables, replaceProductionDeliverables, listProjectOptionSets, createProjectOptionSetValue, updateProjectOptionSetValue, deleteProjectOptionSetValue, listServiceDefinitions, createServiceDefinition, updateServiceDefinition, deleteServiceDefinition, listDeliverableDefinitions, createDeliverableDefinition, updateDeliverableDefinition, deleteDeliverableDefinition, listServiceAllocations, createServiceAllocation, updateServiceAllocation, deleteServiceAllocation, listDeliverableAllocations, createDeliverableAllocation, updateDeliverableAllocation, deleteDeliverableAllocation, requireStartedProjectEditor, requireProjectEditor, requireProjectDeleter, SHOW_ALL_PROJECTS_WRITE, recordProjectAdvance, projectAdvanceOptions } = require("./controller");

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
/*
 * The two lists that advance's dropdowns need. Above `/projects/:id` so "advance-options" is not
 * read as a project id, and under the same guard as the write it serves - the Accounts options
 * endpoint is behind `ACCOUNTS / Cash Management`, which is what left the Receiver dropdown empty
 * for the very people the section had just been shown to.
 */
router.get("/projects/advance-options", salesManager, projectAdvanceOptions);
// Importing a spreadsheet of bookings, behind the same guard `POST /projects` answers to.
router.get("/projects/import/template", salesManager, projectImportTemplate);
router.post("/projects/import", salesManager, importProjects);
router.patch("/projects/:id", answersForAProject, requireProjectEditor, updateProject);
/*
 * The ticked bookings, deleted together. Above `/projects/:id` because `/bulk` is a fixed segment.
 *
 * `answersForAProject` is mounted here as it is on the route below - the screen's own permission,
 * which `mountBulkDelete` then pairs with `ADMIN / Table Select All`. `requireProjectDeleter` is
 * **not**, and cannot be: it is middleware that reads one id out of the URL, and these arrive forty
 * at a time in the body. Its rule is asked per project inside `deleteProjectRecord` instead, so a
 * selection still loses only the projects this person manages and keeps the rest ticked.
 */
mountBulkDelete(router, {
  path: "/projects/bulk",
  guard: answersForAProject,
  deleteOne: (id, req) => deleteProjectRecord(req, String(id)),
  noun: "project",
});
router.delete("/projects/:id", answersForAProject, requireProjectDeleter, deleteProject);

// ---- quotations: their own screen, and now their own permission rather than the sale's ----
//
// There is no PATCH here on purpose. A quotation is not edited: an edit raises the next version of
// its chain, which is a create, and the version already sent stays as it was sent.
router.get("/quotations", quotations, listQuotations);
router.get("/quotations/:id", quotations, getQuotation);
// The studio's own copy of a version as a file. A read of the quotation, so READ is enough - and
// it is deliberately *not* governed by the brand's Allow Client Download, which decides what the
// client's link hands out and not what the studio may save.
router.get("/quotations/:id/pdf", quotations, quotationPdf);
router.post("/quotations", quotations, createQuotation);
router.post("/quotations/:id/versions", quotations, createQuotationVersion);
router.post("/quotations/:id/duplicate", quotations, duplicateQuotation);
router.post("/quotations/:id/link", quotations, renewQuotationLink);
// The ticked quotations, deleted together - above `/quotations/:id`, since `/bulk` is fixed. The
// screen's own `quotations` guard is mounted exactly as it is below; `mountBulkDelete` adds
// `ADMIN / Table Select All`, and `scopedQuotation` still narrows every id inside the body.
mountBulkDelete(router, {
  path: "/quotations/bulk",
  guard: quotations,
  deleteOne: (id, req) => deleteQuotationRecord(req, String(id)),
  noun: "quotation",
});
router.delete("/quotations/:id", quotations, deleteQuotation);

// ---- the plan: starting a project and everything hung off it ----
router.patch("/projects/:id/start-project-draft", plansAProject, editsAStartedProject, saveStartProjectDraft);
router.patch("/projects/:id/start-project", plansAProject, editsAStartedProject, startProject);
router.get("/projects/:id/shoots", readsTheRegister, listProjectShoots);
router.post("/projects/:id/shoots", plansAProject, editsAStartedProject, createProjectShoots);
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
 */
router.get("/projects/:id/payments", checkPermissions([
  { module: "PROJECT", feature: "Projects", level: "READ" },
  { module: "ACCOUNTS", feature: "Cash Management", level: "READ" },
]), listProjectPayments);
router.get("/projects/:id/production-deliverables", readsTheRegister, listProductionDeliverables);
router.put("/projects/:id/production-deliverables", plansAProject, editsAStartedProject, replaceProductionDeliverables);
router.get("/projects/:id/service-allocations", readsTheRegister, listServiceAllocations);
router.post("/projects/:id/shoots/:shootId/service-allocations", plansAProject, editsAStartedProject, createServiceAllocation);
router.patch("/projects/:id/service-allocations/:allocationId", plansAProject, editsAStartedProject, updateServiceAllocation);
router.delete("/projects/:id/service-allocations/:allocationId", plansAProject, editsAStartedProject, deleteServiceAllocation);
router.get("/projects/:id/deliverable-allocations", readsTheRegister, listDeliverableAllocations);
router.post("/projects/:id/shoots/:shootId/deliverable-allocations", plansAProject, editsAStartedProject, createDeliverableAllocation);
router.patch("/projects/:id/deliverable-allocations/:allocationId", plansAProject, editsAStartedProject, updateDeliverableAllocation);
router.delete("/projects/:id/deliverable-allocations/:allocationId", plansAProject, editsAStartedProject, deleteDeliverableAllocation);

// ---- the definitions and option sets the plan is built from ----
router.post("/project-option-sets/:optionSetId/values", projectPlan, createProjectOptionSetValue);
router.patch("/project-option-sets/:optionSetId/values/:valueId", projectPlan, updateProjectOptionSetValue);
// Retires a value rather than removing the row: the allocations that chose it still point at it.
router.delete("/project-option-sets/:optionSetId/values/:valueId", projectPlan, deleteProjectOptionSetValue);
router.post("/service-definitions", projectPlan, createServiceDefinition);
router.patch("/service-definitions/:definitionId", projectPlan, updateServiceDefinition);
// Retires a service rather than removing the row - see the handler for why the history matters.
router.delete("/service-definitions/:definitionId", projectPlan, deleteServiceDefinition);
router.post("/deliverable-definitions", projectPlan, createDeliverableDefinition);
router.patch("/deliverable-definitions/:definitionId", projectPlan, updateDeliverableDefinition);
// Retired, not removed, for the same reason as a service.
router.delete("/deliverable-definitions/:definitionId", projectPlan, deleteDeliverableDefinition);

module.exports = router;
