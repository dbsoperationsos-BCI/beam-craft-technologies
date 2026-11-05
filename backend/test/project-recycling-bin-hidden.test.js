const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const projects = require("../src/modules/sales/projects/controller");
const bin = require("../src/modules/assets/recycling-bin.service");
const binController = require("../src/modules/assets/recycling-bin.controller");
const cashEntries = require("../src/modules/accounts/cash-entries/controller");
const cashRead = require("../src/modules/accounts/cash-entries/read.service");
const paymentRequests = require("../src/modules/hrm/payment-requests/controller");
const extras = require("../src/modules/sales/extra-quotations/controller");
const tasks = require("../src/modules/hrm/tasks/service");
const chats = require("../src/modules/client/chats/service");
const { getCrmLeadById, PROJECT_DELETED_SQL } = require("../src/modules/sales/crm-leads/crmLeadService");
const { requireModule } = require("../src/middleware/permissionMiddleware");

/*
 * A project in Resource Management → Recycling Bin shows nowhere else: its children - cash entries,
 * payment request lines, extra quotations, feedback tasks, client chats - are never deleted, so every
 * read of them asks for the project to be live. Its CRM lead reads "Project deleted" while every one
 * of its projects is in the bin. Restore brings all of it back. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TBH-${STAMP}-${name}`;
const F = {};

async function answer(handler, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }), json: (body) => { out = { code: 200, body }; } };
  await handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res);
  return out;
}
async function guard(middleware, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }) };
  await middleware(req, res, () => { out = { code: "next" }; });
  return out;
}

before(async () => {
  F.admin = await prisma.user.create({ data: { name: "Hidden admin", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.nobody = await prisma.user.create({ data: { name: "Hidden nobody", email: `${tag("nobody")}@test.local`.toLowerCase(), username: tag("nobody").toLowerCase(), password: "x", role: "EMPLOYEE" } });
  F.lead = await prisma.salesCrmLead.create({ data: { enquiryId: tag("enq"), name: tag("enq"), status: "Converted", crm: "Test" } });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: F.lead.enquiryId, eventId: tag("project"), whatsappGroupName: `WED ${tag("project")}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
  } });
  F.cash = await prisma.cashEntry.create({ data: { entryId: tag("cash"), entryType: "RECEIVED", category: "Advance", amount: 100, entryDate: new Date(), branch: "Erode TN", paymentMode: "Cash", projectId: F.project.id, clientName: tag("cash") } });
  F.request = await prisma.paymentRequest.create({ data: { requestCode: tag("req"), type: "EXPENSE_SUBMISSION", requestedByName: tag("req"), branch: "Erode TN", amount: 50, termsAcceptedAt: new Date(),
    expenses: { create: [{ expenseDate: new Date(), expenseType: "Travel", amount: 50, projectId: F.project.id }] } } });
  F.extra = await prisma.projectExtraQuotation.create({ data: { requestCode: tag("extra"), projectId: F.project.id, service: "Drone", amount: 10, requestedByName: "Test" } });
  F.task = await prisma.hrmTask.create({ data: { taskCode: tag("task"), title: tag("task"), description: "x", taskType: "Feedback", assignedToName: "A", assignedByName: "B", assignedToUserId: F.admin.id } });
  F.feedback = await prisma.projectFeedback.create({ data: { feedbackCode: tag("fb"), feedbackVersion: 1, projectId: F.project.id, review: "Poor" } });
  await prisma.projectFeedbackIssue.create({ data: { feedbackId: F.feedback.id, reviewKey: "overall", review: "Poor", taskId: F.task.id } });
  F.thread = await prisma.clientChatThread.create({ data: { projectId: F.project.id, topic: "general" } });
});

after(async () => {
  await prisma.clientChatThread.deleteMany({ where: { id: { in: [F.thread?.id].filter(Boolean) } } });
  await prisma.projectFeedback.deleteMany({ where: { id: { in: [F.feedback?.id].filter(Boolean) } } });
  await prisma.projectExtraQuotation.deleteMany({ where: { id: { in: [F.extra?.id].filter(Boolean) } } });
  await prisma.paymentRequest.deleteMany({ where: { id: { in: [F.request?.id].filter(Boolean) } } });
  await prisma.cashEntry.deleteMany({ where: { id: { in: [F.cash?.id].filter(Boolean) } } });
  // The project takes its feedback and the feedback its issue (`onDelete: Cascade`), which is what
  // frees the task the issue holds (`onDelete: Restrict`) to be deleted after it.
  await prisma.salesProject.deleteMany({ where: { id: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.hrmTask.deleteMany({ where: { id: { in: [F.task?.id].filter(Boolean) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: [F.lead?.enquiryId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.admin?.id, F.nobody?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

const admin = () => ({ id: F.admin.id, role: "SUPER_ADMIN" });

/** Whether each child is listed where the studio reads it. */
async function seen() {
  const cash = await answer(cashEntries.listEntries, { user: admin(), permission: { module: "ACCOUNTS", feature: "Cash Management" }, query: { search: tag("cash") } });
  const searched = await cashRead.searchEntries({ search: tag("cash") });
  const requests = await answer(paymentRequests.listRequests, { user: admin(), query: { search: tag("req") } });
  const extraList = await answer(extras.listExtras, { user: admin(), permission: { module: "PROJECT", feature: "Projects" }, query: { projectId: F.project.id } });
  const taskList = await tasks.listTasks({ scope: "mine", userId: F.admin.id, role: "SUPER_ADMIN" });
  const threads = await chats.teamThreads();
  const [lead] = await prisma.$queryRawUnsafe(`SELECT ${PROJECT_DELETED_SQL} AS \`projectDeleted\` FROM \`sales_crm_lead\` WHERE \`enquiry_id\` = ?`, F.lead.enquiryId);
  return {
    cash: cash.body.data.some((row) => row.id === F.cash.id) && searched.items.some((row) => row.entryId === F.cash.entryId),
    request: requests.body.data.some((row) => row.id === F.request.id),
    extra: extraList.body.data.some((row) => row.id === F.extra.id),
    task: taskList.some((row) => row.id === F.task.id),
    chat: threads.some((row) => row.id === F.thread.id),
    leadDeleted: Boolean(Number(lead.projectDeleted)) && (await getCrmLeadById(F.lead.enquiryId)).lead.projectDeleted === true,
  };
}

test("a live project's children are listed, and its lead reads its own status", async () => {
  assert.deepEqual(await seen(), { cash: true, request: true, extra: true, task: true, chat: true, leadDeleted: false });
});

test("in the bin, none of its children are listed and its lead reads Project deleted; restored, all come back", async () => {
  const removed = await answer(projects.deleteProject, { user: admin(), params: { id: F.project.id } });
  assert.equal(removed.code, 200, JSON.stringify(removed));
  assert.deepEqual(await seen(), { cash: false, request: false, extra: false, task: false, chat: false, leadDeleted: true });
  // Opened by id, too: each answers as not found.
  assert.equal((await answer(paymentRequests.getRequest, { user: admin(), params: { id: String(F.request.id) } })).code, 404);
  await assert.rejects(() => tasks.getTask(F.task.id, F.admin.id, true, "SUPER_ADMIN"), (error) => error.status === 404);
  assert.equal(await chats.teamThread(F.thread.id), null);
  // The stored lead status is untouched.
  assert.equal((await prisma.salesCrmLead.findUnique({ where: { enquiryId: F.lead.enquiryId } })).status, "Converted");

  const restored = await answer(binController.restoreProject, { user: admin(), params: { id: F.project.id } });
  assert.equal(restored.code, 200, JSON.stringify(restored));
  assert.deepEqual(await seen(), { cash: true, request: true, extra: true, task: true, chat: true, leadDeleted: false });
});

test("the lead's status SQL reads Project deleted first, and the Converted and Rejected tabs leave it out", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"), "utf8");
  const display = source.slice(source.indexOf("function statusDisplaySql"), source.indexOf("// Column id -> the SQL"));
  assert.ok(display.indexOf("PROJECT_DELETED_SQL") < display.indexOf("UNASSIGNED_SQL"));
  assert.match(source, /'converted&followup'\) AND NOT \$\{PROJECT_DELETED_SQL\}/);
  assert.match(source, /'rejected' AND NOT \$\{PROJECT_DELETED_SQL\}/);
});

test("the bin's read-only view: READ at the bin's scope, 404 for a live project, 403 without the permission", async () => {
  // Live again after the restore above: not in the bin.
  assert.equal((await answer(binController.getProject, { user: admin(), params: { id: F.project.id } })).code, 404);
  await projects.deleteProjectRecord({ user: admin() }, F.project.id);
  const out = await answer(binController.getProject, { user: admin(), params: { id: F.project.id } });
  assert.equal(out.code, 200, JSON.stringify(out));
  assert.equal(out.body.data.eventId, tag("project"));
  assert.equal(out.body.data.deletedBy?.id, F.admin.id);
  assert.equal(out.body.data.branchId, undefined);
  // Nobody without ASSET / Recycling Bin reads it; the service answers 404 to them as well.
  assert.equal((await guard(requireModule("ASSET", "Recycling Bin"), { method: "GET", user: { id: F.nobody.id, role: "EMPLOYEE" } })).code, 403);
  await assert.rejects(() => bin.getDeletedProject(F.nobody.id, F.project.id), (error) => error.status === 404);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "recycling-bin.routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/projects\/:id", controller\.getProject\);/);
  await answer(binController.restoreProject, { user: admin(), params: { id: F.project.id } });
});
