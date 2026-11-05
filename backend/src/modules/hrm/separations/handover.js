const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { notify, TYPES } = require("../../../services/notifications");
const tasks = require("../tasks/service");

/*
 * ── Handing a leaver's pending work to somebody ────────────────────────────────────────────────
 *
 * Offboarding used to change the status, close the login and move the person's direct reports up -
 * and leave every piece of work they held under their name: open tasks nobody could act on, leads
 * nobody followed up, projects whose Project Manager could no longer be saved, leave requests
 * queued to an approver who could not sign in. Now the separation names who takes it over, and it
 * moves in the same transaction as the separation itself.
 *
 * Only what is still **pending** moves. A completed task, a converted lead, a delivered project, a
 * finished shoot and a decided candidate keep the leaver's name, because that is who did them - the
 * history stays true.
 *
 *   - HRM tasks still open, held by the leaver's login (the way a manual reassign moves one);
 *   - CRM leads they own that are not Invalid, Rejected or Converted;
 *   - the roles they hold on unfinished projects whose part is still in progress - Project Manager,
 *     Pre Production Coordinator, Creative Manager, Post Production Coordinator, Production Manager,
 *     a client gift not yet sent (see `PROJECT_ROLES`); never CRM, whose part ends at the sale;
 *   - production records not yet Done, on unfinished projects, where they are the Production
 *     Coordinator, on the team, or on a service's crew;
 *   - interview candidates still in progress for whom they are the interviewer;
 *   - the sheet assignment rules that send new leads or candidates to them;
 *   - colleagues for whom they are an alternative or a leave, permission or regularisation
 *     approver, and approvals still waiting on them.
 *
 * Moving leads and projects happens under HRM / Employee Management, the separation's own
 * permission, rather than CRM's or Projects': it is the consequence of offboarding somebody, and
 * the receiver is checked to be somebody working here.
 */

const OPEN_TASK = { notIn: tasks.CLOSED_STATUSES };
const FINISHED_LEAD_STATUSES = ["Invalid", "Rejected", "Converted"];
const FINISHED_PROJECT_STATUSES = ["Completed", "Delivered", "Rejected", "Cancelled & Refunded", "Client not Turned", "Duplicated", "Date Elapsed"];
const FINISHED_CANDIDATE_STATUSES = ["Selected", "Onboarded", "Rejected"];

/*
 * A role moves only while its own part of the project is still in progress - the work that is the
 * leaver's to finish, not the work they have already done:
 *
 *   - CRM never moves: their part ends when the sale becomes a project. Their open leads move.
 *   - Pre Production Coordinator: until Pre Production is done - set Planned (or Rejected) on the
 *     board, or every shoot's production plan submitted, the test the project's Overall Status
 *     finishes Pre Production by.
 *   - Production Manager: until every shoot is completed (File in done), unless Production is set
 *     Rejected.
 *   - A gift's holder: until the gift is sent.
 *   - Project Manager, Creative Manager, Post Production Coordinator: until the project is finished,
 *     their part running to the end of it.
 */
const liveShoot = { deletedAt: null };
const PRE_PRODUCTION_OPEN = {
  OR: [{ preProductionStatus: null }, { preProductionStatus: { notIn: ["PLANNED", "REJECTED"] } }],
  shoots: { some: { ...liveShoot, OR: [{ production: null }, { production: { planSubmittedAt: null } }] } },
};
const PRODUCTION_OPEN = {
  OR: [{ productionStatus: null }, { productionStatus: { not: "REJECTED" } }],
  shoots: { some: { ...liveShoot, OR: [{ production: null }, { production: { currentStep: { not: "DONE" } } }] } },
};
const giftOpen = (statusField) => ({ OR: [{ [statusField]: null }, { [statusField]: "Yet To Sent" }] });

/**
 * Each role a project names a person in: the id, the name copy beside it, what the studio calls it,
 * and when it is still in progress (`null`: never handed over).
 */
const PROJECT_ROLES = [
  ["crmEmployeeId", "crmName", "CRM", null],
  ["projectManagerEmployeeId", "projectManager", "Project Manager", {}],
  ["preProductionCoordinatorEmployeeId", "preProductionCoordinator", "Pre Production Coordinator", PRE_PRODUCTION_OPEN],
  ["creativeManagerEmployeeId", "creativeManager", "Creative Manager", {}],
  ["postProductionCoordinatorEmployeeId", "postProductionCoordinator", "Post Production Coordinator", {}],
  ["productionManagerEmployeeId", "productionManager", "Production Manager", PRODUCTION_OPEN],
  ["welcomeGiftEmployeeId", "welcomeGiftAssignee", "Welcome Gift", giftOpen("welcomeGiftStatus")],
  ["shootCompletedGiftEmployeeId", "shootCompletedGiftAssignee", "Shoot Completed Gift", giftOpen("shootCompletedGiftStatus")],
];
/** The roles that are ever handed over, each with the projects on which it is still the leaver's to finish. */
const HANDED_ROLES = PROJECT_ROLES.filter(([, , , open]) => open);
const openRoleWhere = (field, open, employeeId) => ({ AND: [liveProject, { [field]: employeeId }, open] });

/** The slots on a colleague's record that name somebody to stand in for or approve for them. */
const COLLEAGUE_SLOTS = [
  "alternative1EmployeeId", "alternative2EmployeeId",
  "leaveApprover1EmployeeId", "leaveApprover2EmployeeId", "leaveApprover3EmployeeId",
  "permissionApproverEmployeeId", "regularizationApproverEmployeeId",
];

const liveProject = { deletedAt: null, projectStatus: { notIn: FINISHED_PROJECT_STATUSES } };
const openLead = (employeeId) => ({ ownerEmployeeId: employeeId, deletedAt: null, OR: [{ status: null }, { status: { notIn: FINISHED_LEAD_STATUSES } }] });
const openCandidate = (employeeId) => ({ interviewerEmployeeId: employeeId, deletedAt: null, status: { notIn: FINISHED_CANDIDATE_STATUSES } });
const liveProductionOf = (employeeId) => ({
  currentStep: { not: "DONE" },
  shoot: { deletedAt: null },
  salesProject: liveProject,
  OR: [{ productionCoordinatorEmployeeId: employeeId }, { teamMembers: { some: { employeeId } } }, { serviceCrew: { some: { employeeId } } }],
});

async function loginOf(client, employeeId) {
  return client.user.findFirst({ where: { linkedEmployeeId: employeeId }, select: { id: true, name: true, status: true } });
}

/**
 * Everything still pending under this employee, for the hand-over pop-up: a count per kind and the
 * first few of each by name, so HR sees what they are handing over rather than only how much.
 */
async function pendingWork(client, employeeId) {
  const login = await loginOf(client, employeeId);
  const [openTasks, leads, projects, productions, candidates, leadRules, candidateRules, colleagues, approvals] = await Promise.all([
    login ? client.hrmTask.findMany({ where: { assignedToUserId: login.id, status: OPEN_TASK, deletedAt: null }, select: { taskCode: true, title: true }, orderBy: { createdAt: "asc" } }) : [],
    client.salesCrmLead.findMany({ where: openLead(employeeId), select: { enquiryId: true, name: true } }),
    // Per role, so a project lists only the roles on it still in progress.
    Promise.all(HANDED_ROLES.map(([field, , label, open]) => client.salesProject.findMany({ where: openRoleWhere(field, open, employeeId), select: { id: true, eventId: true } })
      .then((rows) => rows.map((row) => ({ ...row, label }))))).then((lists) => {
      const byProject = new Map();
      for (const row of lists.flat()) {
        if (!byProject.has(row.id)) byProject.set(row.id, { eventId: row.eventId, roles: [] });
        byProject.get(row.id).roles.push(row.label);
      }
      return [...byProject.values()];
    }),
    client.projectProduction.findMany({ where: liveProductionOf(employeeId), select: { shoot: { select: { shootId: true, shoot: true } }, salesProject: { select: { eventId: true } } } }),
    client.hrmInterviewCandidate.findMany({ where: openCandidate(employeeId), select: { candidateCode: true, name: true } }),
    client.salesGoogleSheetAssignmentRuleTarget.count({ where: { employeeId } }),
    client.hrmInterviewGoogleSheetAssignmentRuleTarget.count({ where: { employeeId } }),
    client.employee.findMany({ where: { archivedAt: null, id: { not: employeeId }, OR: COLLEAGUE_SLOTS.map((field) => ({ [field]: employeeId })) }, select: { employeeName: true } }),
    client.attendanceRequestApproval.count({ where: { approverEmployeeId: employeeId, decision: "PENDING" } }),
  ]);
  const sample = (rows, label) => rows.slice(0, 5).map(label);
  const group = (rows, label) => ({ count: rows.length, items: sample(rows, label) });
  const rules = leadRules + candidateRules;
  const approvalsGroup = { count: colleagues.length + approvals, items: [...sample(colleagues, (row) => `Alternative or approver for ${row.employeeName}`), ...(approvals ? [`${approvals} request${approvals === 1 ? "" : "s"} waiting for their approval`] : [])] };
  const result = {
    tasks: group(openTasks, (task) => `${task.taskCode} · ${task.title}`),
    leads: group(leads, (lead) => `${lead.enquiryId} · ${lead.name || "—"}`),
    projects: group(projects, (project) => `${project.eventId} · ${project.roles.join(", ")}`),
    productions: group(productions, (row) => `${row.shoot.shootId} · ${row.shoot.shoot} (${row.salesProject.eventId})`),
    candidates: group(candidates, (row) => `${row.candidateCode || "Candidate"} · ${row.name || "—"}`),
    assignmentRules: { count: rules, items: rules ? [`New leads or candidates from linked sheets are sent to them by ${rules} rule${rules === 1 ? "" : "s"}`] : [] },
    approvals: approvalsGroup,
  };
  return { total: Object.values(result).reduce((sum, item) => sum + item.count, 0), ...result };
}

function refuse(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Moves everything `pendingWork` lists from one employee to another, inside the caller's
 * transaction. Refuses - and so refuses the separation - when the receiver cannot take it.
 * Written as a handful of set-based writes rather than one per item, so a leaver with hundreds of
 * open items fits inside the transaction.
 */
async function handOver(tx, { fromEmployeeId, toEmployeeId, actor }) {
  if (fromEmployeeId === toEmployeeId) throw refuse("Choose somebody other than the person leaving.");
  const to = await tx.employee.findFirst({
    where: { id: toEmployeeId, archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
  });
  if (!to) throw refuse("Choose an active employee to hand the work over to.");
  const from = await tx.employee.findUnique({ where: { id: fromEmployeeId }, select: { employeeName: true } });
  const fromName = from?.employeeName || "The previous holder";
  const reason = `${fromName} left the studio.`;
  const moved = { tasks: 0, leads: 0, projects: 0, productions: 0, candidates: 0, assignmentRules: 0, approvals: 0 };

  // Tasks, the way a manual reassign moves one: holder, owner, the reason, and a line in each history.
  const fromLogin = await loginOf(tx, fromEmployeeId);
  const openTasks = fromLogin ? await tx.hrmTask.findMany({ where: { assignedToUserId: fromLogin.id, status: OPEN_TASK, deletedAt: null }, select: { id: true, assignedToName: true } }) : [];
  if (openTasks.length) {
    const toLogin = await loginOf(tx, toEmployeeId);
    if (!toLogin || toLogin.status !== "ACTIVE") throw refuse(`${to.employeeName} has no active login, so they cannot be given ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}. Choose somebody who can sign in.`);
    const toName = toLogin.name || to.employeeName;
    const ids = openTasks.map((task) => task.id);
    await tx.hrmTask.updateMany({
      where: { id: { in: ids } },
      data: { status: "PENDING", assignedToUserId: toLogin.id, assignedToName: toName, ownerEmployeeId: to.id, reassignedAt: new Date(), reassignReason: reason, reassignedFromUserId: fromLogin.id, reassignedFromName: fromName },
    });
    await tx.hrmTaskActivity.createMany({
      data: openTasks.map((task) => ({ taskId: task.id, action: tasks.ACTIONS.REASSIGNED, detail: `Reassigned from ${task.assignedToName} to ${toName} by ${actor.name}. Reason: ${reason}`, userId: actor.id || null, userName: actor.name })),
    });
    await tx.hrmTaskHolder.createMany({ data: ids.map((taskId) => ({ taskId, userId: toLogin.id, name: toName })), skipDuplicates: true });
    moved.tasks = openTasks.length;
  }

  // Leads: the owner reference and the CRM name copy beside it.
  moved.leads = (await tx.salesCrmLead.updateMany({ where: openLead(fromEmployeeId), data: { ownerEmployeeId: to.id, crm: to.employeeName } })).count;

  // Projects: each role the leaver holds whose part is still in progress, id and name together. A
  // part already done - a project their CRM sale became, a Pre Production planned - keeps their name.
  const projects = new Set();
  for (const [field, nameField, , open] of HANDED_ROLES) {
    const rows = await tx.salesProject.findMany({ where: openRoleWhere(field, open, fromEmployeeId), select: { id: true } });
    if (!rows.length) continue;
    await tx.salesProject.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { [field]: to.id, [nameField]: to.employeeName } });
    // Remembered, so the role reads "New (Old)" until somebody changes it (`services/handoverNames`).
    await tx.employeeHandover.createMany({ data: rows.map((row) => ({ projectId: row.id, role: field, fromEmployeeId, toEmployeeId: to.id })) });
    rows.forEach((row) => projects.add(row.id));
  }
  moved.projects = projects.size;

  // Production: coordinator, team and crew on every unfinished shoot of an unfinished project.
  const productions = await tx.projectProduction.findMany({ where: liveProductionOf(fromEmployeeId), select: { id: true } });
  if (productions.length) {
    const ids = productions.map((row) => row.id);
    // Which shoots' coordinator and which crew places move, remembered for "New (Old)" as the project roles are.
    const [coordinated, crewPlaces] = await Promise.all([
      tx.projectProduction.findMany({ where: { id: { in: ids }, productionCoordinatorEmployeeId: fromEmployeeId }, select: { id: true } }),
      tx.projectProductionServiceCrew.findMany({ where: { productionId: { in: ids }, employeeId: fromEmployeeId }, select: { id: true, productionId: true } }),
    ]);
    const remembered = [
      ...coordinated.map((row) => ({ productionId: row.id, role: "productionCoordinatorEmployeeId", fromEmployeeId, toEmployeeId: to.id })),
      ...crewPlaces.map((row) => ({ productionId: row.productionId, crewId: row.id, role: "crew", fromEmployeeId, toEmployeeId: to.id })),
    ];
    if (remembered.length) await tx.employeeHandover.createMany({ data: remembered });
    await tx.projectProduction.updateMany({ where: { id: { in: ids }, productionCoordinatorEmployeeId: fromEmployeeId }, data: { productionCoordinatorEmployeeId: to.id } });
    // One team row per person: where the receiver is on the team already, the leaver's row simply goes.
    const receiverTeams = (await tx.projectProductionTeamMember.findMany({ where: { productionId: { in: ids }, employeeId: to.id }, select: { productionId: true } })).map((row) => row.productionId);
    if (receiverTeams.length) await tx.projectProductionTeamMember.deleteMany({ where: { productionId: { in: receiverTeams }, employeeId: fromEmployeeId } });
    await tx.projectProductionTeamMember.updateMany({ where: { productionId: { in: ids.filter((id) => !receiverTeams.includes(id)) }, employeeId: fromEmployeeId }, data: { employeeId: to.id } });
    await tx.projectProductionServiceCrew.updateMany({ where: { productionId: { in: ids }, employeeId: fromEmployeeId }, data: { employeeId: to.id } });
  }
  moved.productions = productions.length;

  // Interview candidates still in progress.
  moved.candidates = (await tx.hrmInterviewCandidate.updateMany({ where: openCandidate(fromEmployeeId), data: { interviewerEmployeeId: to.id, interviewer: to.employeeName } })).count;

  // Sheet assignment rules: new leads and candidates go to the receiver. A rule already naming the
  // receiver takes the leaver's share onto their target, since a rule names each person once.
  for (const model of ["salesGoogleSheetAssignmentRuleTarget", "hrmInterviewGoogleSheetAssignmentRuleTarget"]) {
    const targets = await tx[model].findMany({ where: { employeeId: fromEmployeeId }, select: { id: true, ruleId: true, percent: true } });
    for (const target of targets) {
      const existing = await tx[model].findFirst({ where: { ruleId: target.ruleId, employeeId: to.id }, select: { id: true } });
      if (existing) {
        await tx[model].update({ where: { id: existing.id }, data: { percent: { increment: target.percent } } });
        await tx[model].delete({ where: { id: target.id } });
      } else {
        await tx[model].update({ where: { id: target.id }, data: { employeeId: to.id, employeeName: to.employeeName } });
      }
    }
    moved.assignmentRules += targets.length;
  }

  // Colleagues the leaver stood in for or approved for: the receiver takes the slot - except on the
  // receiver's own record, where naming themselves would be no approver at all, so it is cleared.
  const colleagues = new Set();
  for (const field of COLLEAGUE_SLOTS) {
    const rows = await tx.employee.findMany({ where: { [field]: fromEmployeeId, archivedAt: null, id: { not: fromEmployeeId } }, select: { id: true } });
    if (!rows.length) continue;
    const others = rows.map((row) => row.id).filter((id) => id !== to.id);
    if (others.length) await tx.employee.updateMany({ where: { id: { in: others } }, data: { [field]: to.id } });
    if (others.length !== rows.length) await tx.employee.update({ where: { id: to.id }, data: { [field]: null } });
    rows.forEach((row) => colleagues.add(row.id));
  }
  const approvals = await tx.attendanceRequestApproval.updateMany({ where: { approverEmployeeId: fromEmployeeId, decision: "PENDING" }, data: { approverEmployeeId: to.id } });
  moved.approvals = colleagues.size + approvals.count;

  const toLogin = await loginOf(tx, toEmployeeId);
  const words = { tasks: "task", leads: "lead", projects: "project", productions: "production shoot", candidates: "candidate", assignmentRules: "assignment rule", approvals: "approval duty" };
  const parts = Object.entries(moved).filter(([, n]) => n).map(([key, n]) => `${n} ${words[key]}${n === 1 ? "" : "s"}`);
  if (toLogin && parts.length) {
    await notify(tx, {
      userId: toLogin.id, actorId: actor.id, type: TYPES.TASK_REASSIGNED,
      title: `You have taken over ${fromName}'s pending work`,
      body: `${actor.name} handed you ${parts.join(", ")} as ${fromName} left the studio.`,
    });
  }
  return moved;
}

module.exports = { pendingWork, handOver, PROJECT_ROLES, COLLEAGUE_SLOTS, FINISHED_LEAD_STATUSES, FINISHED_PROJECT_STATUSES, FINISHED_CANDIDATE_STATUSES };
