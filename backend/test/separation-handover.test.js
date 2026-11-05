const test = require("node:test");
const assert = require("node:assert/strict");
// Stood in before `handover.js` is required: it takes `workingEmployeeStatuses` by destructuring,
// so the stand-in has to be in place first or the real one (which reads the database) is kept.
const optionLists = require("../src/services/employeeOptionLists");
optionLists.workingEmployeeStatuses = async () => ["Active"];
const { handOver, PROJECT_ROLES, FINISHED_LEAD_STATUSES, FINISHED_PROJECT_STATUSES, FINISHED_CANDIDATE_STATUSES } = require("../src/modules/hrm/separations/handover");

/*
 * A stand-in transaction: employee 7 (login 70) is leaving with two open tasks, and employee 9
 * (login 90) takes over. Every write is recorded, so the test reads what moved and on what terms.
 */
function world({
  receiver = { id: 9, employeeName: "Asha" },
  receiverLogin = { id: 90, name: "Asha", status: "ACTIVE" },
  openTasks = 2,
  receiverOnTeam = false,
  receiverAlreadyOnRule = false,
  colleagueSlots = [{ id: 11 }],
} = {}) {
  const writes = [];
  const record = (model, op, answer = { count: 1 }) => async (args) => { writes.push({ model, op, args }); return answer; };
  const tx = {
    employee: {
      findFirst: async ({ where }) => (receiver && where.id === receiver.id ? receiver : null),
      findUnique: async () => ({ employeeName: "Ravi" }),
      findMany: async ({ where }) => (where.leaveApprover1EmployeeId === 7 ? colleagueSlots : []),
      updateMany: record("employee", "updateMany"),
      update: record("employee", "update"),
    },
    user: { findFirst: async ({ where }) => (where.linkedEmployeeId === 7 ? { id: 70, name: "Ravi", status: "INACTIVE" } : where.linkedEmployeeId === 9 ? receiverLogin : null) },
    hrmTask: {
      findMany: async () => Array.from({ length: openTasks }, (u, i) => ({ id: `t${i}`, assignedToName: "Ravi" })),
      updateMany: record("hrmTask", "updateMany"),
    },
    hrmTaskActivity: { createMany: record("hrmTaskActivity", "createMany") },
    hrmTaskHolder: { createMany: record("hrmTaskHolder", "createMany") },
    salesCrmLead: { updateMany: record("salesCrmLead", "updateMany", { count: 3 }) },
    salesProject: {
      // A role's query is `AND: [unfinished, { role: leaver }, still in progress]`.
      findMany: async ({ where }) => ((where.AND || [where]).some((part) => part.projectManagerEmployeeId === 7) ? [{ id: "p1" }] : []),
      updateMany: record("salesProject", "updateMany"),
    },
    projectProduction: { findMany: async () => [{ id: "prod1" }], updateMany: record("projectProduction", "updateMany") },
    projectProductionTeamMember: {
      findMany: async () => (receiverOnTeam ? [{ productionId: "prod1" }] : []),
      updateMany: record("team", "updateMany"),
      deleteMany: record("team", "deleteMany"),
    },
    projectProductionServiceCrew: { findMany: async () => [{ id: "crew1", productionId: "prod1" }], updateMany: record("crew", "updateMany") },
    employeeHandover: { createMany: record("handover", "createMany") },
    hrmInterviewCandidate: { updateMany: record("candidate", "updateMany", { count: 1 }) },
    salesGoogleSheetAssignmentRuleTarget: {
      findMany: async () => [{ id: "rt1", ruleId: "r1", percent: 40 }],
      findFirst: async () => (receiverAlreadyOnRule ? { id: "rt9" } : null),
      update: record("leadRule", "update"),
      delete: record("leadRule", "delete"),
    },
    hrmInterviewGoogleSheetAssignmentRuleTarget: { findMany: async () => [], findFirst: async () => null },
    attendanceRequestApproval: { updateMany: record("approval", "updateMany", { count: 2 }) },
    notification: { create: record("notification", "create") },
  };
  return { tx, writes };
}
const actor = { id: 1, name: "HR Admin" };
const of = (writes, model, op) => writes.filter((w) => w.model === model && w.op === op);

test("all pending work moves to the person chosen", async () => {
  const { tx, writes } = world();
  const moved = await handOver(tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  assert.deepEqual(moved, { tasks: 2, leads: 3, projects: 1, productions: 1, candidates: 1, assignmentRules: 1, approvals: 3 });

  // Tasks: held by the receiver's login, owned by the receiver, the reason given, a history line each.
  const task = of(writes, "hrmTask", "updateMany")[0].args.data;
  assert.equal(task.assignedToUserId, 90);
  assert.equal(task.ownerEmployeeId, 9);
  assert.equal(task.status, "PENDING", "pending for the person taking it over");
  assert.match(task.reassignReason, /Ravi left the studio/);
  assert.equal(of(writes, "hrmTaskActivity", "createMany")[0].args.data.length, 2);

  // Leads: owner and the CRM name beside it, and only those still being worked.
  const leads = of(writes, "salesCrmLead", "updateMany")[0].args;
  assert.deepEqual(leads.data, { ownerEmployeeId: 9, crm: "Asha" });
  assert.deepEqual(leads.where.OR[1].status.notIn, FINISHED_LEAD_STATUSES);

  // Projects: the role's id and its name copy together.
  assert.deepEqual(of(writes, "salesProject", "updateMany")[0].args.data, { projectManagerEmployeeId: 9, projectManager: "Asha" });

  // Production: coordinator, team and crew.
  assert.deepEqual(of(writes, "projectProduction", "updateMany")[0].args.data, { productionCoordinatorEmployeeId: 9 });
  assert.deepEqual(of(writes, "team", "updateMany")[0].args.data, { employeeId: 9 });
  assert.deepEqual(of(writes, "crew", "updateMany")[0].args.data, { employeeId: 9 });

  // Candidates, the assignment rule, colleagues' approver slot, and approvals waiting on them.
  assert.deepEqual(of(writes, "candidate", "updateMany")[0].args.data, { interviewerEmployeeId: 9, interviewer: "Asha" });
  assert.deepEqual(of(writes, "leadRule", "update")[0].args.data, { employeeId: 9, employeeName: "Asha" });
  assert.deepEqual(of(writes, "employee", "updateMany")[0].args.data, { leaveApprover1EmployeeId: 9 });
  assert.deepEqual(of(writes, "approval", "updateMany")[0].args.data, { approverEmployeeId: 9 });

  // One notification to the receiver, naming what came their way.
  assert.match(of(writes, "notification", "create")[0].args.data.body, /2 tasks, 3 leads, 1 project/);
});

test("finished work keeps the leaver's name", () => {
  assert.deepEqual(FINISHED_LEAD_STATUSES, ["Invalid", "Rejected", "Converted"]);
  for (const status of ["Delivered", "Cancelled & Refunded", "Rejected"]) assert.ok(FINISHED_PROJECT_STATUSES.includes(status));
  assert.ok(!FINISHED_PROJECT_STATUSES.includes("Work in Progress - Pre & Production"));
  assert.deepEqual(FINISHED_CANDIDATE_STATUSES, ["Selected", "Onboarded", "Rejected"]);
});

test("somebody already on a shoot's team, or a rule, is not named twice", async () => {
  const { tx, writes } = world({ receiverOnTeam: true, receiverAlreadyOnRule: true });
  await handOver(tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  // The leaver's team row goes rather than becoming a second one for the receiver.
  assert.deepEqual(of(writes, "team", "deleteMany")[0].args.where, { productionId: { in: ["prod1"] }, employeeId: 7 });
  // The rule's share is added to the receiver's existing target, and the leaver's target removed.
  assert.deepEqual(of(writes, "leadRule", "update")[0].args, { where: { id: "rt9" }, data: { percent: { increment: 40 } } });
  assert.deepEqual(of(writes, "leadRule", "delete")[0].args, { where: { id: "rt1" } });
});

test("on the receiver's own record, a slot that named the leaver is cleared rather than naming themselves", async () => {
  const { tx, writes } = world({ colleagueSlots: [{ id: 9 }] });
  await handOver(tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  assert.equal(of(writes, "employee", "updateMany").length, 0);
  assert.deepEqual(of(writes, "employee", "update")[0].args, { where: { id: 9 }, data: { leaveApprover1EmployeeId: null } });
});

test("the work cannot go to the leaver, to somebody not working here, or - for tasks - to somebody who cannot sign in", async () => {
  await assert.rejects(handOver(world().tx, { fromEmployeeId: 7, toEmployeeId: 7, actor }), /other than the person leaving/);
  await assert.rejects(handOver(world({ receiver: null }).tx, { fromEmployeeId: 7, toEmployeeId: 9, actor }), /active employee/);
  await assert.rejects(handOver(world({ receiverLogin: null }).tx, { fromEmployeeId: 7, toEmployeeId: 9, actor }), /no active login/);
  // With no open tasks, a receiver without a login can still take the rest - but is sent no notification.
  const noTasks = world({ receiverLogin: null, openTasks: 0 });
  const moved = await handOver(noTasks.tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  assert.equal(moved.tasks, 0);
  assert.equal(moved.projects, 1);
  assert.equal(of(noTasks.writes, "notification", "create").length, 0);
});

test("a project role moves only while its own part is still in progress", () => {
  const role = (label) => PROJECT_ROLES.find((entry) => entry[2] === label)[3];
  // CRM's part ends when the sale becomes a project: never handed over.
  assert.equal(role("CRM"), null);
  // Pre Production: not set Planned or Rejected, and a shoot whose production plan is not submitted.
  assert.deepEqual(role("Pre Production Coordinator").OR, [{ preProductionStatus: null }, { preProductionStatus: { notIn: ["PLANNED", "REJECTED"] } }]);
  assert.deepEqual(role("Pre Production Coordinator").shoots.some.OR, [{ production: null }, { production: { planSubmittedAt: null } }]);
  // Production: a shoot not yet completed, unless Production is set Rejected.
  assert.deepEqual(role("Production Manager").shoots.some.OR, [{ production: null }, { production: { currentStep: { not: "DONE" } } }]);
  assert.deepEqual(role("Production Manager").OR, [{ productionStatus: null }, { productionStatus: { not: "REJECTED" } }]);
  // A gift until it is sent.
  assert.deepEqual(role("Welcome Gift"), { OR: [{ welcomeGiftStatus: null }, { welcomeGiftStatus: "Yet To Sent" }] });
  assert.deepEqual(role("Shoot Completed Gift"), { OR: [{ shootCompletedGiftStatus: null }, { shootCompletedGiftStatus: "Yet To Sent" }] });
  // The rest run to the end of the project.
  for (const label of ["Project Manager", "Creative Manager", "Post Production Coordinator"]) assert.deepEqual(role(label), {}, label);
});

test("the CRM role on a project is not handed over, even when the leaver holds it", async () => {
  const { tx, writes } = world();
  const asked = [];
  tx.salesProject.findMany = async ({ where }) => { asked.push(where); return (where.AND || []).some((part) => part.crmEmployeeId === 7) ? [{ id: "crm" }] : []; };
  await handOver(tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  assert.ok(!asked.some((where) => (where.AND || []).some((part) => "crmEmployeeId" in part)), "never asked for");
  assert.ok(!of(writes, "salesProject", "updateMany").some((write) => "crmEmployeeId" in write.args.data));
});

test("each role handed over is remembered, so it reads \"New (Old)\" until changed", async () => {
  const { tx, writes } = world();
  await handOver(tx, { fromEmployeeId: 7, toEmployeeId: 9, actor });
  const remembered = of(writes, "handover", "createMany").flatMap((write) => write.args.data);
  assert.ok(remembered.some((row) => row.projectId === "p1" && row.role === "projectManagerEmployeeId" && row.fromEmployeeId === 7 && row.toEmployeeId === 9));
  assert.ok(remembered.some((row) => row.productionId === "prod1" && row.role === "productionCoordinatorEmployeeId"));
  assert.ok(remembered.some((row) => row.crewId === "crew1" && row.role === "crew"));
});
