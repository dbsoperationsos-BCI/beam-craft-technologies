const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

/*
 * Nebula's attendance lookup, and every access rule it holds - run against stand-ins for the
 * register, the IAM service and the data scope, so no database is needed and each rule can be
 * switched on and off on its own.
 *
 *   1. HRM / Employee Attendance at READ opens it (the registry, from the module).
 *   2. Your own day, always.
 *   3. Anybody else's only with HRM / Attendance Approval at READ.
 *   4. And only within that grant's data scope.
 *   5. Today or the last 31 days; never the future.
 */

const src = (...parts) => path.join(__dirname, "..", "src", ...parts);
const ROWS = [
  { employeeId: 1, employeeName: "Me Myself", status: "Present", attended: true, checkInAt: "2026-10-03T09:00:00Z", checkOutAt: null, loginPlace: "secret", checkInSelfieEventId: "secret" },
  { employeeId: 2, employeeName: "Arun Kumar", status: "Late", attended: true, checkInAt: "2026-10-03T10:05:00Z", checkOutAt: null },
  { employeeId: 3, employeeName: "Karthik Selvam", status: "Absent", attended: false, checkInAt: null, checkOutAt: null },
];
const servicePath = require.resolve(src("modules", "hrm", "attendance", "service.js"));
// The ids the Dashboard's range count was asked for - so a test can show it never reaches past scope.
const overviewAsked = [];
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
  attendanceRegister: async (day) => ({ date: day.toISOString().slice(0, 10), rows: ROWS }),
  // Saturday and Sunday off, no holidays.
  readSettings: async () => ({ weeklyOffDays: "0,6" }),
  holidayDateSet: async () => new Set(),
  attendanceOverview: async (_from, _to, { employeeIds }) => {
    overviewAsked.push([...employeeIds]);
    return { employees: ROWS.filter((row) => employeeIds.includes(row.employeeId)).map((row) => ({ employeeName: row.employeeName, present: 1, absent: 3, onLeave: 1, late: 0 })) };
  },
} };

const iamService = require("../src/services/iam.service");
const dataScope = require("../src/services/dataScope.service");
const prisma = require("../src/config/db");
const { TOOLS, dayFor, clearRegisterCache, ATTENDANCE_WORDS, rangeIn, spanFor } = require("../src/services/ai/tools/attendance");
const tool = TOOLS[0];
const session = { userId: 50 };

function as({ approves = false, scope = { unlimited: false, where: { branchId: 1 } }, inScope = [2], self = 1 }, run) {
  clearRegisterCache();
  const real = { perm: iamService.hasPermission, self: dataScope.selfIds, resolve: dataScope.resolve, find: prisma.employee.findMany };
  iamService.hasPermission = async (_user, module, feature) => approves && module === "HRM" && feature === "Attendance Approval";
  dataScope.selfIds = async () => ({ employeeId: self, userId: 50 });
  dataScope.resolve = async (asked) => { assert.equal(asked.feature, "Attendance Approval", "scoped on the grant that lets them see others"); return scope; };
  // The scope's own query (no id list) answers who is in scope; a name search answers within the ids given.
  prisma.employee.findMany = async ({ where }) => {
    if (!where.id) return inScope.map((id) => ({ id }));
    const names = (where.OR || []).map((entry) => entry.employeeName.contains.toLowerCase());
    return ROWS.filter((row) => where.id.in.includes(row.employeeId) && (!names.length || names.some((name) => row.employeeName.toLowerCase().includes(name))))
      .map((row) => ({ id: row.employeeId, employeeName: row.employeeName }));
  };
  return Promise.resolve().then(run).finally(() => {
    iamService.hasPermission = real.perm; dataScope.selfIds = real.self; dataScope.resolve = real.resolve; prisma.employee.findMany = real.find;
  });
}

test("rule 1: the lookup answers to HRM / Employee Attendance, and only reads", () => {
  require("../src/services/ai/tools").registerAllTools();
  const registered = require("../src/services/ai/tools/registry").findTool("attendance.getDay");
  assert.equal(registered.permissionModule, "HRM");
  assert.equal(registered.feature, "Employee Attendance");
  assert.equal(registered.risk, "READ");
});

test("rules 2-3: without Attendance Approval you see your own day, and nobody else's", () => as({ approves: false }, async () => {
  const result = await tool.execute({ names: "Arun Kumar, Me Myself" }, session);
  assert.equal(result.reach, "only your own attendance");
  assert.equal(result.counts.total, 1);
  assert.deepEqual(result.people.map((person) => person.name), ["Me Myself"]);
  assert.deepEqual(result.notFound, ["Arun Kumar"], "a colleague is simply not found");
}));

test("rule 4: with Attendance Approval, colleagues only within the grant's scope", () => as({ approves: true, inScope: [2] }, async () => {
  const result = await tool.execute({ names: "Arun Kumar, Karthik Selvam" }, session);
  assert.equal(result.reach, "the people you may see");
  assert.equal(result.counts.total, 2, "yourself and Arun - Karthik is outside the scope");
  assert.deepEqual(result.people.map((person) => [person.name, person.status]), [["Arun Kumar", "Late"]]);
  assert.deepEqual(result.notFound, ["Karthik Selvam"]);
}));

test("rule 4: an unlimited scope sees the whole register", () => as({ approves: true, scope: { unlimited: true } }, async () => {
  const result = await tool.execute({}, session);
  assert.deepEqual(result.counts, { total: 3, present: 2, late: 1, absent: 1, onLeave: 0 });
}));

test("nothing beyond the day leaves: no selfie, no place", () => as({ approves: true, scope: { unlimited: true } }, async () => {
  const result = await tool.execute({ names: "Me Myself" }, session);
  assert.deepEqual(Object.keys(result.people[0]).sort(), ["checkedInAt", "checkedOutAt", "name", "status"]);
}));

test("rule 5: today or the last 31 days, never the future", () => {
  const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  assert.ok(dayFor().day, "today by default");
  assert.ok(dayFor(iso(-3)).day);
  assert.match(dayFor(iso(2)).error, /today and the days before/);
  assert.match(dayFor(iso(-40)).error, /last 31 days/);
});

test("gathered only for a question about attendance, with the names the question or the turn before named", () => {
  assert.equal(tool.summaryWhen("how many of them are present today"), true);
  assert.equal(tool.summaryWhen("is Arun absent?"), true);
  assert.equal(tool.summaryWhen("how many projects are in pre production"), false);
  const args = tool.prefetchArgs({ asked: "how many of them are present today", priorTurns: [{ role: "assistant", content: "Arun Kumar and Karthik Selvam manage them." }] });
  // The text travels; who it names is decided against the employees within reach (`namedIn`).
  assert.match(args.mentionedIn, /Arun Kumar and Karthik Selvam/);
});

test("asked about attendance without it, Nebula says so rather than answering from nothing", async () => {
  const { answerWithTools } = require("../src/services/ai/orchestrator");
  const result = await answerWithTools({
    system: "",
    messages: [{ role: "user", content: "Is Arun present today?" }],
    context: { userId: 50, modules: ["PROJECT"], scope: "PROJECT" },
  });
  assert.match(result.answer, /cannot see attendance/);
});

test("the project summary counts per project manager, one line each", () => {
  const { TOOLS: projectTools } = require("../src/services/ai/tools/project");
  const rendered = projectTools.find((entry) => entry.name === "project.getProjectSummary").renderSummary({
    total: 2, unassigned: 0, byStatus: [{ status: "Work in Progress - Pre & Production", count: 2 }],
    byManager: [
      { manager: "Arun Kumar", count: 1, byStatus: [{ status: "Work in Progress - Pre & Production", count: 1 }] },
      { manager: "Karthik Selvam", count: 1, byStatus: [{ status: "Work in Progress - Pre & Production", count: 1 }] },
    ],
  });
  assert.match(rendered, /By project manager:\n- Arun Kumar: 1\n  - Work in Progress - Pre & Production: 1\n- Karthik Selvam: 1/);
});

test("a login with no employee behind it, and no Attendance Approval, sees nobody", () => as({ approves: false, self: null }, async () => {
  const result = await tool.execute({ names: "Me Myself" }, session);
  assert.equal(result.counts.total, 0);
  assert.deepEqual(result.people, []);
}));

test("rule 1 at the moment it runs: without HRM / Employee Attendance the lookup is refused", async () => {
  require("../src/services/ai/tools").registerAllTools();
  const registry = require("../src/services/ai/tools/registry");
  const real = iamService.hasPermission;
  iamService.hasPermission = async () => false;
  try {
    // Even with ATTENDANCE in the session's modules (a stale session, a role changed since).
    await assert.rejects(
      () => registry.executeTool("attendance.getDay", {}, { userId: 50, modules: ["PROJECT", "ATTENDANCE"] }),
      (error) => error.code === "AI_TOOL_FORBIDDEN",
    );
  } finally {
    iamService.hasPermission = real;
  }
});

test("attendance words need their context - 'present the pipeline' is not a question about who is in", () => {
  for (const question of ["how many of them are present today", "Is Arun present today?", "who is absent today", "Is Karthik on leave?", "show attendance for today"]) {
    assert.ok(ATTENDANCE_WORDS.test(question), question);
  }
  for (const question of ["Present the pipeline summary", "How many leads came in today?", "Is the payment late?", "present the leads to me"]) {
    assert.ok(!ATTENDANCE_WORDS.test(question), question);
  }
});

test("projects per manager: the linked employee's name wins, the copied text only where nothing is linked", async () => {
  const readService = require("../src/modules/sales/projects/read.service");
  const real = { count: prisma.salesProject.count, groupBy: prisma.salesProject.groupBy, find: prisma.employee.findMany };
  prisma.salesProject.count = async () => 3;
  prisma.salesProject.groupBy = async ({ by }) => (by.includes("projectManagerEmployeeId")
    ? [
      { projectManagerEmployeeId: 9, projectManager: "Arun K (old copy)", projectStatus: "WIP", _count: { _all: 1 } },
      { projectManagerEmployeeId: null, projectManager: "Karthik Selvam", projectStatus: "WIP", _count: { _all: 1 } },
      { projectManagerEmployeeId: null, projectManager: "", projectStatus: "Yet to Start", _count: { _all: 1 } },
    ]
    : []);
  prisma.employee.findMany = async () => [{ id: 9, employeeName: "Arun Kumar" }];
  try {
    const summary = await readService.projectSummary({ access: {} });
    assert.deepEqual(summary.byManager.map((row) => [row.manager, row.count]), [["Arun Kumar", 1], ["Karthik Selvam", 1]]);
  } finally {
    prisma.salesProject.count = real.count; prisma.salesProject.groupBy = real.groupBy; prisma.employee.findMany = real.find;
  }
});

test("a range is read from the question - the last five working days, a week, two dates", () => {
  assert.deepEqual(rangeIn("I need to know the last five working days records of Mukesh"), { workingDays: 5 });
  assert.deepEqual(rangeIn("Last 3 working days of Arun"), { workingDays: 3 });
  assert.deepEqual(rangeIn("how was attendance last week"), { week: "last" });
  assert.match(rangeIn("attendance from 28 sep to 2 oct").from, /-09-28$/);
  assert.equal(rangeIn("is Arun present today"), null);
});

test("the last five working days skip the studio's weekly offs, and end at the last finished day", async () => {
  const span = await spanFor({ workingDays: 5 });
  const iso = (date) => date.toISOString().slice(0, 10);
  assert.equal(span.lastWorkingDays, 5);
  assert.equal(span.workingDays, 5);
  assert.ok(span.to < new Date(), "never today, never ahead");
  for (const day of [span.from, span.to]) assert.ok(![0, 6].includes(day.getUTCDay()), `${iso(day)} is a weekly off`);
});

test("a range keeps every rule: past 31 days or into the future is refused", async () => {
  const iso = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  assert.match((await spanFor({ from: iso(-40), to: iso(-35) })).error, /last 31 days/);
  assert.match((await spanFor({ from: iso(-2), to: iso(3) })).error, /today and the days before/);
});

test("a range's totals reach no further than the day's: without Attendance Approval, only your own", () => as({ approves: false }, async () => {
  overviewAsked.length = 0;
  const result = await tool.execute({ names: "Arun Kumar, Me Myself", workingDays: 5 }, session);
  assert.deepEqual(overviewAsked, [[1]], "the Dashboard count was asked about nobody else");
  assert.deepEqual(result.people.map((person) => person.name), ["Me Myself"]);
  assert.deepEqual(result.notFound, ["Arun Kumar"]);
}));

test("a range with Attendance Approval: colleagues within the scope, by the Dashboard's own count", () => as({ approves: true, inScope: [2] }, async () => {
  overviewAsked.length = 0;
  const result = await tool.execute({ names: "Arun Kumar, Karthik Selvam", workingDays: 5 }, session);
  assert.deepEqual(overviewAsked, [[2]], "Karthik is outside the scope and never counted");
  // Five working days: present 1, absent 3, on leave 1 - none left over.
  assert.deepEqual(result.people, [{ name: "Arun Kumar", present: 1, absent: 3, onLeave: 1, late: 0, neither: 0 }]);
  assert.match(TOOLS[0].renderSummary(result), /Arun Kumar:\n- Working days: 5\n- Present: 1\n- Absent: 3\n- On leave: 1\n- Neither present, absent nor on leave[^\n]*: 0/);
}));

test("a person is recognised by their own name in the question, within reach - not by an unusual-looking word", () => as({ approves: true, inScope: [2] }, async () => {
  const result = await tool.execute({ mentionedIn: "I need to know the last five working days records of Arun", workingDays: 5 }, session);
  assert.deepEqual(result.people.map((person) => person.name), ["Arun Kumar"]);
  // Karthik is out of this person's scope, so naming him finds nobody.
  const outside = await tool.execute({ mentionedIn: "the last five working days of Karthik", workingDays: 5 }, session);
  assert.deepEqual(outside.people, [], "no colleague's figures listed in his place");
  assert.equal(outside.aggregate.people, 2, "only totals for everyone within reach");
  assert.match(TOOLS[0].renderSummary(outside), /not any one person's/);
}));
