const { invalidate: forgetReferenceLookups } = require("./referenceMatchers");

/**
 * The places a branch's, a vertical's, an employee's or a login's **name** is written out as text
 * on another record, and how a rename reaches each of them.
 *
 * ── Why these exist ──
 *
 * Most business tables carry a name twice: the text the studio typed or imported - `source_branch`,
 * `project_manager`, `assigned_to_name`, `crm` - and, beside it, the reference the data-scope work
 * added (`branch_id`, `project_manager_employee_id`, `assigned_to_user_id`, `owner_employee_id`).
 * The text is still what every screen prints and what every write path starts from: the reference is
 * *derived* from the text by `referenceMatchers.js` when the row is saved. The text is not going
 * anywhere until Stage 8 of DATA-SCOPE.md drops it, and until then it is a cache of the name - and a
 * cache that nobody invalidated.
 *
 * So renaming a branch in Settings -> Branches, or a person in the Employee Repository, changed the
 * register and nothing else. Every project, lead, task and cash entry went on printing the old name,
 * and worse: the next time one of those rows was saved, the matcher looked the *old* text up in the
 * register, found nothing, and wrote `branch_id = NULL` - so a rename quietly took rows out of scope
 * one save at a time. Field Settings' lists had this exact fault and fixed it with `renameUsage`
 * (master-data/usage.js); this is the same rule extended to the four kinds of name that live outside
 * those lists.
 *
 * ── The rule ──
 *
 * A copy is rewritten **by the reference where there is one**: every row whose `idField` is the
 * renamed row gets the new name, whatever spelling its text held ("Erode" becomes "Erode TN" along
 * with everything else). A copy with no reference is rewritten by exact text match, the way the
 * master-data lists always were. Two consequences worth knowing:
 *
 * - **People are matched by id only.** Two employees can share a name; a row whose owner matched
 *   nobody is exactly the ambiguous case, and rewriting it by name would hand one person's work to
 *   the other. Branches and verticals also take the text fallback (`orText`) because their names are
 *   unique in their registers, so a row with a NULL reference and the old spelling can only mean one
 *   row.
 * - **Logs are not copies.** `asset_status_log`, `hrm_task_activity`, `album_proof_activity`, the
 *   AI event activity and `user_activity_log`'s `username` say who did something *at the time*;
 *   they are left holding the name that was current when the line was written, the way any audit
 *   trail does. Nothing in this file names them.
 *
 * Every rewrite runs inside the caller's transaction, beside the rename itself, so the register and
 * the records move together or neither does. The declarations here are also what Field Settings
 * counts when it refuses to delete a branch or a vertical that is in use (`countUsage`), so a new
 * text copy added anywhere belongs in this file and nowhere else.
 */

/** The entries of a comma-separated column, without the blanks a trailing comma leaves. */
const splitCsv = (value) => String(value || "").split(",").map((part) => part.trim()).filter(Boolean);

const same = (a, b) => String(a || "").trim().toLocaleLowerCase() === String(b || "").trim().toLocaleLowerCase();

const exact = (model, field, label, extra = {}) => ({ model, field, match: "exact", label, ...extra });

/**
 * Where a branch's name is written. `idField` is the `branch_id` beside the text; the two employee
 * location columns have none of their own (`Employee.branchId` is derived from *either* of them, so it
 * cannot say which one matched) and are rewritten by text - which is also what keeps the branch limb
 * of the employee scope (DATA-SCOPE.md D26) reaching them after a rename.
 */
const BRANCH_NAME_COPIES = [
  exact("salesProject", "sourceBranch", "project", { idField: "branchId", orText: true }),
  exact("salesQuotation", "sourceBranch", "quotation", { idField: "branchId", orText: true }),
  exact("salesCrmLead", "assignedBranch", "lead", { idField: "branchId", orText: true }),
  exact("paymentRequest", "branch", "payment request", { idField: "branchId", orText: true }),
  exact("cashEntry", "branch", "cash entry", { idField: "branchId", orText: true }),
  exact("salesWhatsappGroupName", "branch", "saved group name", { idField: "branchId", orText: true }),
  exact("hrmTask", "branch", "task", { idField: "branchId", orText: true }),
  exact("hrmInterviewCandidate", "branch", "candidate", { idField: "branchId", orText: true }),
  exact("aiEvent", "branch", "event", { idField: "branchId", orText: true }),
  exact("employee", "workBaseLocation", "employee"),
  exact("employee", "currentWorkLocation", "employee"),
  /*
   * The Work Locations list the employee form offers is "the branches, plus the answers no branch
   * can give" (Remote, On Field, ...), kept as rows of its own. A branch renamed in Settings ->
   * Branches has to reach the row of that list spelling it the old way, or the form goes on offering
   * a place the studio has stopped calling that while every employee now holds the new name.
   */
  exact("workLocation", "name", "work location"),
];

/**
 * Where a vertical's **name** is written - "Dum Dum", not the `WED` document code or the `DD`
 * identifier code, which are columns of their own on `vertical` and do not change when the name does.
 * The CRD document's `vertical` column holds either, so it is matched by text rather than by its
 * reference: rewriting every row that references the vertical would turn a stored code into a name.
 */
const VERTICAL_NAME_COPIES = [
  exact("salesCrmLead", "verticalName", "lead", { idField: "verticalId", orText: true }),
  exact("employee", "vertical", "employee", { idField: "verticalId", orText: true }),
  // Text match only, never by reference: new rows hold the document code (WED / QQ), which must not be
  // rewritten to a name; only legacy rows spelling the name out follow a rename.
  exact("salesWhatsappGroupName", "vertical", "saved group name"),
  exact("salesProjectCrdDocument", "vertical", "CRD document"),
  exact("salesQuotationBrand", "verticalName", "quotation brand"),
  exact("salesGoogleSheetLink", "vertical", "linked sheet"),
  exact("salesCrmLeadWatch", "vertical", "lead watch"),
  exact("salesCrmDynamicColumn", "vertical", "CRM column"),
];

/** Where an employee's name is written beside a reference to their row. Id only - see above. */
const EMPLOYEE_NAME_COPIES = [
  exact("salesProject", "crmName", "project", { idField: "crmEmployeeId" }),
  exact("salesProject", "projectManager", "project", { idField: "projectManagerEmployeeId" }),
  exact("salesProject", "creativeManager", "project", { idField: "creativeManagerEmployeeId" }),
  exact("salesProject", "preProductionCoordinator", "project", { idField: "preProductionCoordinatorEmployeeId" }),
  exact("salesProject", "postProductionCoordinator", "project", { idField: "postProductionCoordinatorEmployeeId" }),
  exact("salesProject", "productionManager", "project", { idField: "productionManagerEmployeeId" }),
  exact("salesProject", "welcomeGiftAssignee", "project", { idField: "welcomeGiftEmployeeId" }),
  exact("salesProject", "shootCompletedGiftAssignee", "project", { idField: "shootCompletedGiftEmployeeId" }),
  exact("salesCrmLead", "crm", "lead", { idField: "ownerEmployeeId" }),
  exact("salesQuotation", "followedBy", "quotation", { idField: "ownerEmployeeId" }),
  exact("paymentRequest", "requestedByName", "payment request", { idField: "requestedById" }),
  exact("speakUp", "employeeName", "speak-up", { idField: "employeeId" }),
  exact("projectExtraQuotation", "requestedByName", "extra quotation", { idField: "requestedById" }),
  exact("clientStorage", "assignedToName", "client storage record", { idField: "assignedToId" }),
  exact("cashEntry", "handlerName", "cash entry", { idField: "handlerEmployeeId" }),
  exact("asset", "inspectedByName", "asset inspection", { idField: "inspectedById" }),
  exact("hrmInterviewCandidate", "interviewer", "candidate", { idField: "interviewerEmployeeId" }),
  exact("employeeReferral", "referrerName", "referral", { idField: "referrerEmployeeId" }),
  exact("salesGoogleSheetAssignmentRuleTarget", "employeeName", "lead assignment rule", { idField: "employeeId" }),
  exact("salesQuotationShare", "employeeName", "shared quotation", { idField: "employeeId" }),
  exact("hrmInterviewGoogleSheetAssignmentRuleTarget", "employeeName", "candidate assignment rule", { idField: "employeeId" }),
];

/**
 * Where a **login's** name is written. Tasks are assigned between logins rather than employees (see
 * DATA-SCOPE.md, the Stage 6 decision on `hrm_task`), so their name copies follow `User.name`.
 */
const USER_NAME_COPIES = [
  exact("hrmTask", "assignedToName", "task", { idField: "assignedToUserId" }),
  exact("hrmTask", "assignedByName", "task", { idField: "assignedByUserId" }),
  exact("hrmTask", "reassignedFromName", "task", { idField: "reassignedFromUserId" }),
  exact("hrmTaskHolder", "name", "task holder", { idField: "userId" }),
];

/**
 * Rewrites every declared copy of a name, inside `tx`. Returns how many rows changed.
 *
 * `uses` is a list of `{ model, field, match, idField?, orText?, where? }` - the same shape the
 * master-data definitions declare, which is what lets `renameUsage` call this for the lists too.
 * `id` is the renamed row's id, used wherever a use declares an `idField`; `from` is the old name,
 * used by text matches; `to` is the new one.
 */
async function rewriteNameCopies(tx, uses, { id = null, from, to }) {
  const previous = String(from || "").trim();
  const next = String(to || "").trim();
  // Compared exactly, not case-folded: correcting "erode tn" to "Erode TN" is a rename the copies
  // have to follow, even though the database's collation would call the two equal.
  if (!next || !uses?.length || previous === next) return 0;

  let changed = 0;
  for (const use of uses) {
    const model = tx[use.model];
    if (!model) continue;
    const extra = use.where || {};

    if (use.match === "csv") {
      // Narrowed in SQL, then checked entry by entry: `contains` alone would count "Photography"
      // as a use of "Photo".
      if (!previous) continue;
      const rows = await model.findMany({
        where: { [use.field]: { contains: previous }, ...extra },
        select: { id: true, [use.field]: true },
      });
      for (const row of rows) {
        const entries = splitCsv(row[use.field]);
        if (!entries.some((entry) => same(entry, previous))) continue;
        const rewritten = entries.map((entry) => (same(entry, previous) ? next : entry)).join(", ");
        await model.update({ where: { id: row.id }, data: { [use.field]: rewritten } });
        changed += 1;
      }
      continue;
    }

    let where;
    if (use.idField && id != null) {
      where = use.orText && previous
        ? { OR: [{ [use.idField]: id }, { [use.idField]: null, [use.field]: previous }], ...extra }
        : { [use.idField]: id, ...extra };
    } else {
      if (!previous) continue;
      where = { [use.field]: previous, ...extra };
    }
    const result = await model.updateMany({ where, data: { [use.field]: next } });
    changed += result.count;
  }

  // The matcher caches the registers it matches text against; the names in them have just changed.
  if (changed) forgetReferenceLookups();
  return changed;
}

/**
 * Remembers the name a branch or an employee is giving up, on the row itself (`aliases`).
 *
 * The rewrite above reaches every copy in the database and none outside it: a Google Sheet or a CSV
 * still saying the old name would, on its next sync, match no row and write the old text back with
 * no link - a rename undoing itself one sync at a time. With the former name on the row,
 * `referenceMatchers` resolves it to the same branch or person and the sync rewrites the cell's text
 * to the current spelling instead. Kept unique and in the order the names were given up.
 */
async function rememberAlias(tx, model, id, name) {
  const former = String(name || "").trim();
  if (!former) return;
  const row = await tx[model].findUnique({ where: { id }, select: { aliases: true } });
  if (!row) return;
  const current = Array.isArray(row.aliases) ? row.aliases.map((value) => String(value)) : [];
  if (current.some((value) => same(value, former))) return;
  await tx[model].update({ where: { id }, data: { aliases: [...current, former] } });
}

const renameBranchCopies = async (tx, id, from, to) => {
  await rememberAlias(tx, "branch", id, from);
  return rewriteNameCopies(tx, BRANCH_NAME_COPIES, { id, from, to });
};
const renameVerticalCopies = (tx, id, from, to) => rewriteNameCopies(tx, VERTICAL_NAME_COPIES, { id, from, to });
const renameEmployeeCopies = async (tx, id, from, to) => {
  await rememberAlias(tx, "employee", id, from);
  return rewriteNameCopies(tx, EMPLOYEE_NAME_COPIES, { id, from, to });
};
const renameUserCopies = (tx, id, from, to) => rewriteNameCopies(tx, USER_NAME_COPIES, { id, from, to });

/**
 * One person, renamed everywhere at once: the employee record's copies, and the copies kept under
 * each login linked to them - because an employee rename also renames the login (see the "One
 * person, one name" note in hrm/employees/controller.js), so what the tasks say has to follow too.
 */
async function renamePersonCopies(tx, { employeeId, from, to }) {
  let changed = await renameEmployeeCopies(tx, employeeId, from, to);
  const logins = await tx.user.findMany({ where: { linkedEmployeeId: employeeId }, select: { id: true } });
  for (const login of logins) changed += await renameUserCopies(tx, login.id, from, to);
  return changed;
}

/** "4 leads" / "3 leads and 1 task", for the message that says a rename reached other records. */
function describeRenamed(changed) {
  if (!changed) return "";
  return `updated on ${changed} record${changed === 1 ? "" : "s"} that used it`;
}

module.exports = {
  BRANCH_NAME_COPIES,
  VERTICAL_NAME_COPIES,
  EMPLOYEE_NAME_COPIES,
  USER_NAME_COPIES,
  rewriteNameCopies,
  renameBranchCopies,
  renameVerticalCopies,
  renameEmployeeCopies,
  renameUserCopies,
  renamePersonCopies,
  rememberAlias,
  describeRenamed,
  splitCsv,
  same,
};
