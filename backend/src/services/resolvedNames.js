/**
 * The name a screen shows is the linked row's, and the stored text only when there is no link.
 *
 * ── The rule ──
 *
 * Every business table holds a name twice: as text the studio typed or imported (`source_branch`,
 * `project_manager`, `crm`, `handler_name`) and as the reference the data-scope work put beside it
 * (`branch_id`, `project_manager_employee_id`, `owner_employee_id`, `handler_employee_id`). The
 * text is what the screens printed, so a register renamed in Settings had to be chased through every
 * copy (`nameCopies.js`) - and any copy that chase missed, or any sheet that wrote the old spelling
 * back, showed the wrong name until somebody noticed.
 *
 * This turns the reading the right way round, in one place: **a read returns the linked row's name
 * where the reference is set, and the stored text where it is not.** A lead in Malaysia still says
 * "Malaysia", a lead assigned to "Ajith" alone still says "Ajith", and a project filed under the
 * branch now called "Erode Main TN" says so whether or not its text column has caught up.
 *
 * ── How ──
 *
 * A Prisma client extension (`extendWithResolvedNames`, applied in `config/db.js`) intercepts every
 * read of the models listed in `RESOLVED_NAMES`, asks for the relation beside each text column the
 * caller is reading, and then writes the relation's name over the text before the rows are handed
 * back. The relation is removed again unless the caller asked for it, so the shape a screen receives
 * is exactly the shape it always received - the same keys, and the same meaning for each - with the
 * name on it now taken from the register. Nothing changes at the call sites, which is the point:
 * there are ninety of them, and a rule kept in ninety places is not a rule.
 *
 * Only the top level of a query is resolved. A project's `shoots` included beside it, or a lead read
 * inside a meeting's `include`, are the nested model's own rows and are not rewritten here; that is
 * a gap to close when a screen needs it, not something to guess at.
 *
 * ── What it is not ──
 *
 * Not a change to what is stored. Writes still keep text and reference in step through
 * `referenceMatchers` and `nameCopies`, and the text columns stay until every reader - the raw SQL
 * behind the CRM board and the reports foremost - reads the reference the way this does
 * (DATA-SCOPE.md, Stage 8). This is the reading half of that move: once it is the only way a name
 * reaches a screen, dropping the text is a migration and nothing more.
 */

/** [relation field, name column on it] per text column, per model - Prisma's names, not the table's. */
const RESOLVED_NAMES = {
  SalesProject: {
    sourceBranch: ["branch", "name"],
    crmName: ["crmEmployee", "employeeName"],
    projectManager: ["projectManagerEmployee", "employeeName"],
    preProductionCoordinator: ["preProductionCoordinatorEmployee", "employeeName"],
    creativeManager: ["creativeManagerEmployee", "employeeName"],
    postProductionCoordinator: ["postProductionCoordinatorEmployee", "employeeName"],
    productionManager: ["productionManagerEmployee", "employeeName"],
    welcomeGiftAssignee: ["welcomeGiftEmployee", "employeeName"],
    shootCompletedGiftAssignee: ["shootCompletedGiftEmployee", "employeeName"],
  },
  ProjectPaymentSchedule: {
    category: ["categoryRef", "name"],
  },
  SalesQuotation: {
    sourceBranch: ["branch", "name"],
    followedBy: ["owner", "employeeName"],
  },
  SalesCrmLead: {
    assignedBranch: ["branch", "name"],
    crm: ["owner", "employeeName"],
    verticalName: ["vertical", "name"],
  },
  CashEntry: {
    branch: ["branchRef", "name"],
    handlerName: ["handler", "employeeName"],
  },
  PaymentRequest: {
    branch: ["branchRef", "name"],
    requestedByName: ["requestedBy", "employeeName"],
  },
  SpeakUp: {
    employeeName: ["employee", "employeeName"],
  },
  HrmTask: {
    branch: ["branchRef", "name"],
    assignedToName: ["assignedTo", "name"],
    assignedByName: ["assignedBy", "name"],
    reassignedFromName: ["reassignedFromUser", "name"],
  },
  HrmTaskHolder: {
    name: ["user", "name"],
  },
  ClientStorage: {
    assignedToName: ["assignedTo", "employeeName"],
  },
  HrmInterviewCandidate: {
    branch: ["branchRef", "name"],
    interviewer: ["interviewerEmployee", "employeeName"],
  },
  SalesWhatsappGroupName: {
    branch: ["branchRef", "name"],
    // Not `vertical`: this column holds the document code (WED / QQ / CORP) the project form hands
    // straight to the project, not a name. Rewriting it to "Qua Qua" made Create Project refuse the
    // save ("vertical: expected one of WED|QQ|CORP"). A code does not change when the name does.
  },
  ProjectExtraQuotation: {
    requestedByName: ["requestedByEmployee", "employeeName"],
  },
  EmployeeReferral: {
    referrerName: ["referrer", "employeeName"],
  },
  Asset: {
    inspectedByName: ["inspectedByEmployee", "employeeName"],
  },
  SalesGoogleSheetAssignmentRuleTarget: {
    employeeName: ["employee", "employeeName"],
  },
  SalesQuotationShare: {
    employeeName: ["employee", "employeeName"],
  },
  HrmInterviewGoogleSheetAssignmentRuleTarget: {
    employeeName: ["employee", "employeeName"],
  },
  Employee: {
    vertical: ["verticalRef", "name"],
    designation: ["designationRef", "name"],
    workType: ["workTypeRef", "name"],
    gender: ["genderRef", "name"],
    bloodGroup: ["bloodGroupRef", "name"],
    maritalStatus: ["maritalStatusRef", "name"],
    emergencyContactRelationship: ["emergencyContactRelationshipRef", "name"],
    workBaseLocation: ["workBaseLocationRef", "name"],
    currentWorkLocation: ["currentWorkLocationRef", "name"],
  },
};

/** The reads whose rows come back shaped like the model, and so can carry a resolved name. */
const READ_OPERATIONS = ["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "create", "update", "upsert"];

/**
 * Adds the relation beside each text column the query will return, and says which ones it added.
 *
 * `select` and `include` are exclusive in Prisma: a query with a `select` gets the relation only for
 * the text columns it selects; any other query gets every relation the model resolves, through
 * `include`. A relation the caller already asked for is left exactly as asked, and stays on the row.
 */
function askForRelations(args, spec) {
  const added = [];
  const relationSelect = (column) => ({ select: { [column]: true } });
  if (args.select) {
    for (const [text, [relation, column]] of Object.entries(spec)) {
      if (!args.select[text]) continue;
      if (args.select[relation] === undefined) {
        args.select[relation] = relationSelect(column);
        added.push(relation);
      }
    }
    return added;
  }
  const include = { ...(args.include || {}) };
  for (const [, [relation, column]] of Object.entries(spec)) {
    if (include[relation] === undefined) {
      include[relation] = relationSelect(column);
      added.push(relation);
    }
  }
  if (Object.keys(include).length) args.include = include;
  return added;
}

/** Writes each linked name over its text column on one row, and drops the relations this asked for. */
function resolveRow(row, spec, added) {
  if (!row || typeof row !== "object") return row;
  for (const [text, [relation, column]] of Object.entries(spec)) {
    if (!(relation in row)) continue;
    const linked = row[relation];
    // The text column is only rewritten where the caller is reading it - a `select` that left the
    // text out must not gain a key it did not ask for.
    if (text in row && linked && linked[column] != null && linked[column] !== "") row[text] = linked[column];
  }
  for (const relation of added) delete row[relation];
  return row;
}

function resolveResult(result, spec, added) {
  if (Array.isArray(result)) return result.map((row) => resolveRow(row, spec, added));
  return resolveRow(result, spec, added);
}

/**
 * The client with the rule applied. Every model in `RESOLVED_NAMES`, every read in
 * `READ_OPERATIONS`, including inside `$transaction` callbacks - the transaction client an extended
 * client hands out is extended too.
 */
function extendWithResolvedNames(client) {
  const operations = Object.fromEntries(READ_OPERATIONS.map((operation) => [operation, async ({ model, args, query }) => {
    const spec = RESOLVED_NAMES[model];
    if (!spec) return query(args);
    const added = askForRelations(args, spec);
    const result = await query(args);
    return resolveResult(result, spec, added);
  }]));
  return client.$extends({ name: "resolvedNames", query: { $allModels: operations } });
}

module.exports = { RESOLVED_NAMES, READ_OPERATIONS, extendWithResolvedNames, askForRelations, resolveRow };
