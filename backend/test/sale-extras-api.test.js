const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const service = require("../src/modules/sales/sale-extras/service");
const projects = require("../src/modules/sales/projects/controller");
const { scopeOf } = require("../src/modules/sales/sale-extras/rules");
const { rebaselineProject } = require("../src/modules/sales/sale-extras/booking");

/*
 * Sale Extras' API: the section's state (lines found by reconcile, totals, revisions), a hand-typed
 * amount on a draft, and publishing - one locked transaction that refuses what was not reviewed,
 * an unpriced line, a repeat and a race, and writes an immutable revision. A quotation carrying a
 * revision cannot be unfinalized. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TSX-${STAMP}-${name}`;
const F = { projects: [], quotations: [] };
const user = () => ({ id: F.admin.id });

async function booked(name, { quotation = true } = {}) {
  const q = quotation ? await prisma.salesQuotation.create({ data: {
    quotationNumber: tag(`q${name}`), quotationId: tag(`q${name}-01`), publicToken: `a${name}${STAMP}`.padEnd(8, "s").slice(0, 8), payload: { rates: { gstPercent: 18 } },
    sourceBranch: "Erode TN", followedBy: "Test", status: "Generated", amount: 235000, version: 1, enquiryId: F.lead.enquiryId, finalizedAt: new Date(), finalizedByUserId: F.admin.id,
  } }) : null;
  if (q) F.quotations.push(q.id);
  const project = await prisma.salesProject.create({ data: {
    enquiryId: F.lead.enquiryId, eventId: tag(`p${name}`), whatsappGroupName: `WED ${tag(name)}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 235000, crmName: "Test", quotationId: q?.quotationId || null,
  } });
  F.projects.push(project.id);
  const shoot = await prisma.projectShoot.create({ data: { shootId: tag(`${name}-sh`), projectId: project.id, shoot: "Pre-wedding", dateCreated: new Date("2026-12-10"), saleBaseline: {} } });
  const svc = await prisma.projectPostProductionAllocation.create({ data: { projectId: project.id, shootId: shoot.id, serviceName: "Candid Video", quantity: 1, saleBaseline: scopeOf("SERVICE", { quantity: 1 }) } });
  /*
   * A booked project carries the deliverables its services bring with them, baselined like the rest
   * of the quoted plan - this is what booking does (`syncAutoDeliverablesForShoot`, then
   * `rebaselineProject`). Built here the same way, because a fixture holding the service and none of
   * its six deliverables is not a project the application can produce: anything that syncs them
   * later then creates them fresh, with no baseline, and they read as unpriced additions.
   */
  await projects.syncAutoDeliverablesForShoot(prisma, project.id, shoot.id);
  await rebaselineProject(prisma, project.id);
  return { project, shoot, service: svc, quotation: q };
}

const addShoot = (projectId, name) => prisma.projectShoot.create({ data: { shootId: tag(`${name}-${Math.random().toString(36).slice(2, 6)}`), projectId, shoot: name, dateCreated: new Date("2026-12-14") } });

before(async () => {
  F.admin = await prisma.user.create({ data: { name: tag("admin"), email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.lead = await prisma.salesCrmLead.create({ data: { enquiryId: tag("enq"), name: tag("enq"), status: "Converted", crm: "Test" } });
});

after(async () => {
  await prisma.salesProject.deleteMany({ where: { id: { in: F.projects } } });
  await prisma.salesQuotation.deleteMany({ where: { id: { in: F.quotations } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: [F.lead?.enquiryId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.admin?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("a project with no finalized quotation has no section", async () => {
  const A = await booked("u", { quotation: false });
  const state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.equal(state.tracked, false);
});

/** Publish with the amounts typed on screen: `amountOf(line)` for each unpublished line. */
async function publishTyped(projectId, amountOf, { published = [], remarksOf = () => undefined, expectedRevision } = {}) {
  const state = await service.saleExtrasState(projectId, { userId: F.admin.id });
  const drafts = state.lines.filter((line) => line.status === "DRAFT");
  return service.publish(projectId, {
    draftIds: drafts.map((line) => line.id),
    reviewed: Object.fromEntries(drafts.map((line) => [line.id, line.updatedAt])),
    expectedRevision: expectedRevision ?? state.latestRevisionNumber,
    lines: drafts.filter((line) => line.kind !== "CORRECTION").map((line) => ({ id: line.id, amount: amountOf(line), remarks: remarksOf(line) })),
    published,
  }, user());
}

test("the section lists each change on its own, and Publish refuses an unpriced line keeping nothing", async () => {
  const A = await booked("a");
  F.a = A;
  const reception = await addShoot(A.project.id, "Reception");
  await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: reception.id, serviceName: "Candid Photo", quantity: 1 } });
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
  const state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.equal(state.tracked, true);
  assert.equal(state.quotation.amount, 235000);
  const shootLine = state.lines.find((line) => line.category === "SHOOT");
  const newService = state.lines.find((line) => line.category === "SERVICE" && line.kind === "ADDED");
  assert.equal(shootLine.included.length, 0, "the new shoot's service is a line of its own");
  assert.equal(newService.quantity, 1);
  assert.deepEqual(state.extraShoots.map((shoot) => [shoot.name, shoot.status]), [["Pre-wedding", null], ["Reception", "ADDED"]]);
  assert.ok(state.lines.every((line) => state.extraShoots.some((shoot) => shoot.id === line.shootRef)), "every line names the card it is drawn in");
  assert.equal(newService.shootCode, reception.shootId);

  // Every amount is required: one left empty refuses the publish, and nothing typed is kept.
  await assert.rejects(publishTyped(A.project.id, (line) => (line.id === newService.id ? "" : 1000)), { status: 400 });
  assert.equal(await prisma.projectSaleExtra.count({ where: { projectId: A.project.id, amount: { not: null } } }), 0, "a refused publish keeps nothing");
  // A line not on the reviewed list refuses the whole publish too.
  const drafts = state.lines.filter((line) => line.status === "DRAFT");
  await assert.rejects(service.publish(A.project.id, { draftIds: drafts.map((line) => line.id), reviewed: Object.fromEntries(drafts.map((line) => [line.id, line.updatedAt])), expectedRevision: 0, lines: [{ id: F.a.project.id, amount: 1 }] }, user()), { status: 409 });
  await assert.rejects(service.publish(A.project.id, { draftIds: [], reviewed: {}, expectedRevision: 0, lines: [{ id: "x", amount: 1 }, { id: "x", amount: 2 }] }, user()), { status: 400 }, "each line once");
  F.aState = state;
});

test("publishing applies the typed amounts with their sign, freezes R1, and refuses a repeat, a stale review and nothing new", async () => {
  const { project, quotation } = F.a;
  const state = F.aState;
  const amountOf = (line) => (line.category === "SHOOT" ? 15000 : line.kind === "REMOVED" ? 3000 : 0);
  const reviewed = Object.fromEntries(state.lines.map((line) => [line.id, line.updatedAt]));
  const stale = { ...reviewed, [state.lines[0].id]: "2000-01-01T00:00:00.000Z" };
  const typed = state.lines.map((line) => ({ id: line.id, amount: amountOf(line), remarks: line.category === "SHOOT" ? "Reception added" : undefined }));
  await assert.rejects(service.publish(project.id, { draftIds: state.lines.map((line) => line.id), reviewed: stale, expectedRevision: 0, lines: typed }, user()), { status: 409 });
  const before = await prisma.salesQuotation.findUnique({ where: { id: quotation.id } });
  const r1 = await service.publish(project.id, { draftIds: state.lines.map((line) => line.id), reviewed, expectedRevision: 0, lines: typed }, user());
  assert.equal(r1.revisionNumber, 1);
  assert.equal(r1.originalAmount, 235000);
  assert.equal(r1.netAdjustment, 12000, "+15,000, the removal typed 3,000 stored as -3,000, and ₹0");
  assert.equal(r1.updatedTotal, 247000);
  assert.equal(r1.gstPercent, 18);
  assert.deepEqual(r1.lines.map((line) => [line.category, line.included.length]).sort(), [["SERVICE", 0], ["SERVICE", 0], ["SHOOT", 0]], "every item is a line of its own in the revision");
  const stored = await prisma.projectSaleExtra.findMany({ where: { projectId: project.id, status: "PUBLISHED" } });
  assert.deepEqual(stored.map((row) => Number(row.amount)).sort((a, b) => a - b), [-3000, 0, 15000]);
  assert.equal(stored.find((row) => row.category === "SHOOT").remarks, "Reception added");
  assert.deepEqual(await prisma.salesQuotation.findUnique({ where: { id: quotation.id } }), before, "the quotation is never written");
  await assert.rejects(service.publish(project.id, { draftIds: state.lines.map((line) => line.id), reviewed, expectedRevision: 0, lines: typed }, user()), { status: 409 });
  await assert.rejects(service.publish(project.id, { draftIds: [], reviewed: {}, expectedRevision: 1 }, user()), { status: 400 });
  const after = await service.saleExtrasState(project.id, { userId: F.admin.id });
  assert.equal(after.publishedNet, 12000);
  assert.equal(after.updatedTotal, 247000);
  assert.equal(after.revisions.length, 1);
  assert.equal(after.lines.find((line) => line.category === "SHOOT").effectiveAmount, 15000);
});

test("two publishes racing: exactly one lands", async () => {
  const { project } = F.a;
  await addShoot(project.id, "Haldi");
  const state = await service.saleExtrasState(project.id, { userId: F.admin.id });
  const drafts = state.lines.filter((line) => line.status === "DRAFT");
  const body = { draftIds: drafts.map((line) => line.id), reviewed: Object.fromEntries(drafts.map((line) => [line.id, line.updatedAt])), expectedRevision: 1, lines: drafts.map((line) => ({ id: line.id, amount: 5000 })) };
  const results = await Promise.allSettled([service.publish(project.id, body, user()), service.publish(project.id, body, user())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  const r2 = await prisma.projectSaleExtraRevision.findFirst({ where: { projectId: project.id, revisionNumber: 2 } });
  assert.equal(Number(r2.netAdjustment), 17000, "R2 carries every published line");
});

test("a quotation carrying a published revision cannot be unfinalized; one without can", async () => {
  const QUOTATIONS = { module: "SALES", feature: "Quotation Management" };
  const answer = (id) => new Promise((resolve) => {
    const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }), json: (body) => resolve({ code: 200, body }) };
    projects.unfinalizeQuotation({ params: { id }, user: { id: F.admin.id, role: "SUPER_ADMIN" }, query: {}, headers: {}, body: {}, permission: QUOTATIONS }, res);
  });
  const blocked = await answer(F.a.quotation.id);
  assert.equal(blocked.code, 409);
  assert.match(blocked.body.message, /published extras/i);
  const B = await booked("b");
  assert.equal((await answer(B.quotation.id)).code, 200);
});

test("the routes use the guards Edit Sale Details is saved under; Remove and Add back the guards Service Creation changes rows under", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/projects\/:id\/sale-extras", readsTheRegister, saleExtras\.list\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/sale-extras\/publish", answersForAProject, requireProjectEditor, saleExtras\.publish\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/sale-extras\/:extraId\/restore", plansAProject, editsAStartedProject, saleExtras\.restore\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/sale-extras\/:extraId\/remove", plansAProject, editsAStartedProject, saleExtras\.remove\);/);
  assert.equal((routes.match(/sale-extras/g) || []).length, 5, "the require plus the four routes");
  for (const file of fs.readdirSync(path.join(__dirname, "..", "src", "modules", "sales", "sale-extras"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "sale-extras", file), "utf8"), /projectSaleExtraRevision\.(update|updateMany|delete|deleteMany|upsert)\(/, file);
  }
});

test("a published amount edited on screen becomes a correction in the next revision; the line itself never changes", async () => {
  const { project } = F.a;
  const state = await service.saleExtrasState(project.id, { userId: F.admin.id });
  const reception = state.lines.find((line) => line.status === "PUBLISHED" && line.category === "SHOOT" && line.itemName === "Reception");
  const r3 = await service.publish(project.id, { draftIds: [], reviewed: {}, expectedRevision: state.latestRevisionNumber, published: [{ id: reception.id, amount: 13500, remarks: "Typed 15,000 for 13,500" }] }, user());
  assert.ok(r3.lines.some((line) => line.kind === "CORRECTION" && line.amount === -1500), "the difference, published as its own line");
  const row = await prisma.projectSaleExtra.findUnique({ where: { id: reception.id } });
  assert.equal(Number(row.amount), 15000, "the published line keeps its amount");
  assert.equal(row.remarks, "Typed 15,000 for 13,500", "its remarks are internal and kept on the row");
  const after = await service.saleExtrasState(project.id, { userId: F.admin.id });
  assert.equal(after.lines.find((line) => line.id === reception.id).effectiveAmount, 13500);
  assert.equal(after.publishedNet, 17000 - 1500);
  // The same amount again changes nothing; a remark alone is kept without a revision.
  const same = await service.publish(project.id, { draftIds: [], reviewed: {}, expectedRevision: after.latestRevisionNumber, published: [{ id: reception.id, amount: 13500, remarks: "Agreed on call" }] }, user());
  assert.deepEqual(same, { remarksOnly: true });
  assert.equal((await service.saleExtrasState(project.id, { userId: F.admin.id })).latestRevisionNumber, after.latestRevisionNumber);
  await assert.rejects(service.publish(project.id, { draftIds: [], reviewed: {}, expectedRevision: after.latestRevisionNumber, published: [{ id: reception.id, amount: "" }] }, user()), { status: 400 }, "a published row's amount is required too");
  await addShoot(project.id, "Engagement");
  const draft = (await service.saleExtrasState(project.id, { userId: F.admin.id })).lines.find((line) => line.status === "DRAFT");
  await assert.rejects(service.publish(project.id, { draftIds: [draft.id], reviewed: { [draft.id]: draft.updatedAt }, expectedRevision: after.latestRevisionNumber, lines: [{ id: draft.id, amount: 1 }], published: [{ id: draft.id, amount: 1 }] }, user()), { status: 400 }, "each item once");
  await assert.rejects(service.publish(project.id, { draftIds: [draft.id], reviewed: { [draft.id]: draft.updatedAt }, expectedRevision: after.latestRevisionNumber, published: [{ id: draft.id, amount: 1 }] }, user()), { status: 409 }, "an unpublished line is not edited as a published one");
});

test("two readers at once record each change once", async () => {
  const C = await booked("d");
  await addShoot(C.project.id, "Mehendi");
  await Promise.all([service.saleExtrasState(C.project.id, { userId: F.admin.id }), service.saleExtrasState(C.project.id, { userId: F.admin.id }), service.saleExtrasState(C.project.id, { userId: F.admin.id })]);
  assert.equal(await prisma.projectSaleExtra.count({ where: { projectId: C.project.id, status: { in: ["DRAFT", "PUBLISHED"] } } }), 1);
});

test("unfinalizing while publishing leaves them consistent", async () => {
  const D = await booked("e");
  await addShoot(D.project.id, "Reception");
  const fresh = (await service.saleExtrasState(D.project.id, { userId: F.admin.id })).lines[0];
  const QUOTATIONS = { module: "SALES", feature: "Quotation Management" };
  const unfinalize = () => new Promise((resolve) => {
    const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }), json: (body) => resolve({ code: 200, body }) };
    projects.unfinalizeQuotation({ params: { id: D.quotation.id }, user: { id: F.admin.id, role: "SUPER_ADMIN" }, query: {}, headers: {}, body: {}, permission: QUOTATIONS }, res);
  });
  await Promise.allSettled([service.publish(D.project.id, { draftIds: [fresh.id], reviewed: { [fresh.id]: fresh.updatedAt }, expectedRevision: 0, lines: [{ id: fresh.id, amount: 1000 }] }, user()), unfinalize()]);
  const quotation = await prisma.salesQuotation.findUnique({ where: { id: D.quotation.id } });
  const revisions = await prisma.projectSaleExtraRevision.count({ where: { salesQuotationId: D.quotation.id } });
  assert.ok(revisions === 0 || quotation.unfinalizedAt === null, "never a revision on an unfinalized version");
});

test("every write holds the project lock: publishing, the quotation re-link", () => {
  const svc = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "sale-extras", "service.js"), "utf8");
  const publish = svc.slice(svc.indexOf("async function publish("));
  assert.ok(publish.indexOf("reconcileSaleExtras(tx") > -1 && publish.indexOf("reconcileSaleExtras(tx") < publish.indexOf("applyAmount(tx"), "typed amounts are applied under the lock reconcile takes");
  const reconcile = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "sale-extras", "reconcile.js"), "utf8");
  const body = reconcile.slice(reconcile.indexOf("async function reconcileSaleExtras("));
  assert.ok(body.indexOf("FOR UPDATE") < body.indexOf("trackedQuotation("), "the lock is taken before anything is read");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  const relink = controller.slice(controller.indexOf("const keepsItsQuotation"), controller.indexOf("rebaselineProject(transaction"));
  assert.match(relink, /FROM sales_project WHERE id = \$\{[^}]+\} FOR UPDATE/);
});

test("revisions accumulate: each row its own change, every total cumulative", async () => {
  const Q = await booked("q");
  // Original ₹2,35,000 here; the arithmetic is the owner's QA, shifted onto this booking.
  await prisma.projectPostProductionAllocation.create({ data: { projectId: Q.project.id, shootId: Q.shoot.id, serviceName: "Drone", quantity: 1 } });
  await publishTyped(Q.project.id, () => 2000, { expectedRevision: 0 });
  await prisma.projectPostProductionAllocation.update({ where: { id: Q.service.id }, data: { deletedAt: new Date() } });
  const r2 = await publishTyped(Q.project.id, () => 1500, { expectedRevision: 1 });
  assert.equal(r2.netAdjustment, 500, "R2 carries R1's +2,000 and its own -1,500");
  assert.equal(r2.updatedTotal, 235500);
  await addShoot(Q.project.id, "Reception");
  await publishTyped(Q.project.id, () => 3000, { expectedRevision: 2 });
  const state = await service.saleExtrasState(Q.project.id, { userId: F.admin.id });
  assert.equal(state.publishedNet, 3500);
  assert.equal(state.updatedTotal, 238500);
  assert.equal(state.publishedCount, 3);
  assert.deepEqual(state.revisions.map((revision) => [revision.revisionNumber, revision.revisionAdjustment, revision.netAdjustment, revision.updatedTotal]),
    [[1, 2000, 2000, 237000], [2, -1500, 500, 235500], [3, 3000, 3500, 238500]]);
  // A line waiting to be published moves no published figure.
  await addShoot(Q.project.id, "Haldi");
  const withDraft = await service.saleExtrasState(Q.project.id, { userId: F.admin.id });
  assert.equal(withDraft.publishedNet, 3500);
  assert.equal(withDraft.updatedTotal, 238500);
});

test("removal-only reads negative; additions and removals that cancel read zero with their history kept", async () => {
  const R = await booked("r");
  await prisma.projectPostProductionAllocation.update({ where: { id: R.service.id }, data: { deletedAt: new Date() } });
  await publishTyped(R.project.id, () => 4000, { expectedRevision: 0 });
  const removed = await service.saleExtrasState(R.project.id, { userId: F.admin.id });
  assert.equal(removed.publishedNet, -4000);
  assert.equal(removed.updatedTotal, 231000);
  await addShoot(R.project.id, "Reception");
  await publishTyped(R.project.id, () => 4000, { expectedRevision: 1 });
  const zero = await service.saleExtrasState(R.project.id, { userId: F.admin.id });
  assert.equal(zero.publishedNet, 0);
  assert.equal(zero.publishedCount, 2, "both lines are still there");
  assert.deepEqual(zero.revisions.map((revision) => revision.revisionAdjustment), [-4000, 4000]);
});

test("Extras draws a card for each shoot something changed on, headed as Service Creation heads it", () => {
  const at = (minute) => new Date(Date.UTC(2026, 10, 1, 0, minute));
  const shoots = [
    { id: "s-new", shootId: "DBS-SID-11", shoot: "Reception", saleBaseline: null, deletedAt: null, createdAt: at(5), dateCreated: "2026-11-02" },
    { id: "s-hal", shootId: "DBS-SID-09", shoot: "Bride Haldi", shootPlace: "aerigh", district: "Agra", state: "Uttar Pradesh", saleBaseline: {}, deletedAt: null, createdAt: at(1) },
    { id: "s-eng", shootId: "DBS-SID-10", shoot: "Engagement", saleBaseline: {}, deletedAt: at(9), createdAt: at(2) },
    { id: "s-same", shootId: "DBS-SID-13", shoot: "Unchanged", saleBaseline: {}, deletedAt: null, createdAt: at(3) },
    { id: "s-gone", shootId: "DBS-SID-12", shoot: "Mehendi", saleBaseline: null, deletedAt: at(9), createdAt: at(6) },
  ];
  const lines = [{ shootId: "s-new" }, { shootId: "s-hal" }, { shootId: "s-eng" }, { shootId: "s-gone" }, { shootId: null }];
  const cards = service.extraShootsOf({ shoots, lines });
  assert.deepEqual(cards.map((shoot) => [shoot.name, shoot.shootCode, shoot.status]), [
    ["Bride Haldi", "DBS-SID-09", null],
    ["Engagement", "DBS-SID-10", "REMOVED"],
    ["Reception", "DBS-SID-11", "ADDED"],
    ["Mehendi", "DBS-SID-12", "REMOVED"],
  ], "booked shoots first, then added ones; a shoot with nothing changed has no card");
  assert.equal(cards[0].place, "aerigh, Agra, Uttar Pradesh");
});

test("Publish refuses what is not an amount, and a blank box is unpriced rather than ₹0", async () => {
  const controller = require("../src/modules/sales/sale-extras/controller");
  const call = (body) => new Promise((resolve) => {
    const res = { status: (code) => ({ json: (payload) => resolve({ code, payload }) }), json: (payload) => resolve({ code: 200, payload }) };
    controller.publish({ params: { id: "none" }, body: { expectedRevision: 0, ...body }, user: user() }, res);
  });
  assert.equal((await call({ lines: [{ id: "x", amount: "abc" }] })).code, 400, "not a number");
  assert.equal((await call({ lines: [{ id: "x", amount: true }] })).code, 400, "a boolean is not an amount");
  assert.equal((await call({ published: [{ id: "x", amount: [] }] })).code, 400, "nor is a list");
  assert.equal((await call({ lines: Array.from({ length: 501 }, (_, index) => ({ id: `x${index}`, amount: 1 })) })).code, 400, "at most 500 lines");
  // A blank box parses to "unpriced" and the request goes on to the project lookup (404 here).
  assert.equal((await call({ lines: [{ id: "x", amount: "   " }] })).code, 404);
});

test("Restore puts a quoted service removed and not yet published back as quoted - no Removed line, no Added line", async () => {
  const A = await booked("x");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
  let state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  const removed = state.lines.find((line) => line.status === "DRAFT" && line.kind === "REMOVED" && line.category === "SERVICE");
  assert.ok(removed, "a removal waits to be priced");
  const restored = await service.restoreRemoved(A.project.id, removed.id, { userId: F.admin.id });
  assert.equal(restored.category, "SERVICE");
  const row = await prisma.projectPostProductionAllocation.findUnique({ where: { id: A.service.id } });
  assert.equal(row.deletedAt, null, "the same row, back on the shoot");
  assert.ok(row.saleBaseline, "still the quotation's");
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.deepEqual(state.lines.filter((line) => line.status === "DRAFT"), [], "nothing reads as removed or added");
  // Once more is refused: it is no longer removed.
  await assert.rejects(() => service.restoreRemoved(A.project.id, removed.id, { userId: F.admin.id }), (error) => error.status === 409);
});

test("a quoted service picked again later - not only in the same save - reads as quoted; after a published removal it is an addition at the value it had", async () => {
  const A = await booked("y");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });
  await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Candid Video", quantity: 1 } });
  const state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.deepEqual(state.lines.filter((line) => line.status === "DRAFT").map((line) => `${line.kind} ${line.category}`), [], "three hours apart, still the quoted service");
  // Its removal published first: putting it back is then an addition - by Add back, starting at the value it had.
  const B = await booked("z");
  await prisma.projectPostProductionAllocation.update({ where: { id: B.service.id }, data: { deletedAt: new Date() } });
  await publishTyped(B.project.id, () => 1200);
  const published = await service.saleExtrasState(B.project.id, { userId: F.admin.id });
  const line = published.lines.find((entry) => entry.kind === "REMOVED" && entry.status === "PUBLISHED");
  assert.equal(line.action, "ADD_BACK", "the published removal is the item's newest line, so its ⋮ offers Add back");
  await service.restoreRemoved(B.project.id, line.id, { userId: F.admin.id });
  const after = await service.saleExtrasState(B.project.id, { userId: F.admin.id });
  const readded = after.lines.find((entry) => entry.status === "DRAFT" && entry.kind === "ADDED" && entry.category === "SERVICE");
  assert.ok(readded, "added back after the client was shown it gone: an addition");
  assert.equal(readded.amount, 1200, "starting at the value it had when it was removed");
  assert.equal(readded.details.addedBack, true);
  assert.equal(readded.action, "REMOVE");
  assert.equal(after.lines.find((entry) => entry.id === line.id).action, null, "the older line offers nothing");
});

test("Remove in an Added line's ⋮: an addition never published simply goes; a published one becomes a Removed line at its amount, and back again", async () => {
  const A = await booked("k");
  const added = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Photo Booth", quantity: 1 } });
  let state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  let line = state.lines.find((entry) => entry.kind === "ADDED" && entry.itemName === "Photo Booth");
  assert.equal(line.action, "REMOVE");
  await service.removeAdded(A.project.id, line.id, { userId: F.admin.id });
  assert.ok((await prisma.projectPostProductionAllocation.findUnique({ where: { id: added.id } })).deletedAt, "off the shoot");
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.deepEqual(state.lines.filter((entry) => entry.status === "DRAFT"), [], "never published: nothing left");

  // Published at 3,000, then taken off and put back twice over.
  const again = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Photo Booth", quantity: 1 } });
  await publishTyped(A.project.id, () => 3000);
  for (let round = 1; round <= 2; round += 1) {
    state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
    line = state.lines.find((entry) => entry.status === "PUBLISHED" && entry.kind === "ADDED" && entry.itemName === "Photo Booth");
    assert.equal(line.action, "REMOVE", `round ${round}: the published addition offers Remove`);
    await service.removeAdded(A.project.id, line.id, { userId: F.admin.id });
    state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
    const removed = state.lines.find((entry) => entry.status === "DRAFT" && entry.kind === "REMOVED");
    assert.deepEqual([removed.amount, removed.details.source, removed.action], [-3000, "EXTRA", "ADD_BACK"], `round ${round}`);
    await service.restoreRemoved(A.project.id, removed.id, { userId: F.admin.id });
    state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
    assert.deepEqual(state.lines.filter((entry) => entry.status === "DRAFT"), [], `round ${round}: back at 3,000`);
  }
  assert.equal((await prisma.projectPostProductionAllocation.findUnique({ where: { id: again.id } })).deletedAt, null);
  // An item already off cannot be removed again, and one on cannot be added back.
  await assert.rejects(() => service.restoreRemoved(A.project.id, line.id, { userId: F.admin.id }), (error) => error.status === 409);
});

test("a removed line starts at the value the item stood at: its quotation line price (0 if complimentary), or what it was published as added at", async () => {
  const A = await booked("v");
  // The quotation's own lines, priced: Candid Video at 4,000 x 2 under "Pre-wedding", a complimentary Drone.
  const definition = await prisma.projectServiceDefinition.findFirst({ where: { isActive: true }, select: { id: true } });
  const drone = await prisma.projectServiceDefinition.findFirst({ where: { isActive: true, id: { not: definition.id } }, select: { id: true } });
  await prisma.salesQuotation.update({ where: { id: A.quotation.id }, data: { payload: { rates: { gstPercent: 18 }, shoots: [{ id: "qs1", shoot: "Pre-wedding" }], services: [
    { shootId: "qs1", serviceDefinitionId: definition.id, unitPrice: 4000, quantity: 2, complimentary: false },
    { shootId: "qs1", serviceDefinitionId: drone.id, unitPrice: 9000, quantity: 1, complimentary: true },
  ] } } });
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { serviceDefinitionId: definition.id, deletedAt: new Date() } });
  const freeRow = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceDefinitionId: drone.id, serviceName: "Drone", quantity: 1, saleBaseline: scopeOf("SERVICE", { quantity: 1 }), deletedAt: new Date() } });
  let state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  const quoted = state.lines.find((line) => line.status === "DRAFT" && line.kind === "REMOVED" && line.itemName === "Candid Video");
  const free = state.lines.find((line) => line.status === "DRAFT" && line.kind === "REMOVED" && line.itemName === "Drone");
  assert.equal(Number(quoted.amount), -8000, "4,000 x 2 off");
  assert.deepEqual([quoted.details.source, quoted.details.value], ["QUOTATION", 8000]);
  assert.equal(Number(free.amount), 0, "a complimentary line takes nothing off");

  // An extra published as added at 2,500, then removed: it starts at 2,500, and Add back keeps it at that.
  await service.restoreRemoved(A.project.id, quoted.id, { userId: F.admin.id });
  await service.restoreRemoved(A.project.id, free.id, { userId: F.admin.id });
  const extra = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Photo Booth", quantity: 1 } });
  await publishTyped(A.project.id, () => 2500);
  await prisma.projectPostProductionAllocation.update({ where: { id: extra.id }, data: { deletedAt: new Date() } });
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  const removedExtra = state.lines.find((line) => line.status === "DRAFT" && line.kind === "REMOVED" && line.itemName === "Photo Booth");
  assert.deepEqual([Number(removedExtra.amount), removedExtra.details.source], [-2500, "EXTRA"]);
  await service.restoreRemoved(A.project.id, removedExtra.id, { userId: F.admin.id });
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.deepEqual(state.lines.filter((line) => line.status === "DRAFT"), [], "back at the amount it was added at: nothing waits");
  assert.equal(state.publishedNet, 2500);
});

test("an item can be removed and added back again and again - each removal offers Add back", async () => {
  const A = await booked("w");
  for (let round = 1; round <= 3; round += 1) {
    await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
    const state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
    const removed = state.lines.filter((line) => line.status === "DRAFT" && line.kind === "REMOVED");
    assert.equal(removed.length, 1, `round ${round}: one Removed line`);
    await service.restoreRemoved(A.project.id, removed[0].id, { userId: F.admin.id });
    const back = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
    assert.deepEqual(back.lines.filter((line) => line.status === "DRAFT"), [], `round ${round}: back as quoted`);
  }
});

test("an item an approved raised request added shows under Added as already counted; removed, it starts at the amount approved for it", async () => {
  const A = await booked("m");
  const row = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Photo Booth", quantity: 1, saleBaseline: scopeOf("SERVICE", { quantity: 1 }) } });
  const extra = await prisma.projectExtraQuotation.create({ data: { requestCode: tag("EXT"), projectId: A.project.id, service: "Photo Booth", amount: 4500, requestedByName: "T", status: "APPROVED" } });
  await prisma.projectChangeRequest.create({ data: {
    requestCode: tag("CRQ"), projectId: A.project.id, requestType: "SERVICE", shootId: A.shoot.id, status: "ACCEPTED", requestedById: F.admin.id, decidedAt: new Date(), extraQuotationId: extra.id,
    items: { create: [{ itemType: "SERVICE", itemName: "Photo Booth", quantity: 1, decision: "APPROVED", approvedAmount: 4500, appliedRecordId: row.id }] },
  } });
  let state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  const shown = state.lines.find((line) => line.status === "EXTRA_QUOTATION");
  assert.deepEqual([shown.kind, shown.itemName, shown.amount, shown.details.reference, shown.action], ["ADDED", "Photo Booth", 4500, extra.requestCode, "REMOVE"]);
  assert.equal(state.extraQuotationTotal, 4500, "approved extra quotations, for the section's Updated Total");
  assert.deepEqual(state.lines.filter((line) => line.status === "DRAFT"), [], "nothing to price: it is counted on its extra quotation");

  await service.removeAdded(A.project.id, shown.id, { userId: F.admin.id });
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  const removed = state.lines.find((line) => line.status === "DRAFT" && line.kind === "REMOVED");
  assert.deepEqual([removed.amount, removed.details.source, removed.details.reference, removed.action], [-4500, "EXTRA_QUOTATION", extra.requestCode, "ADD_BACK"]);
  assert.equal(state.lines.some((line) => line.status === "EXTRA_QUOTATION"), false, "off the shoot: shown as removed, not as added");

  await service.restoreRemoved(A.project.id, removed.id, { userId: F.admin.id });
  state = await service.saleExtrasState(A.project.id, { userId: F.admin.id });
  assert.deepEqual(state.lines.filter((line) => line.status === "DRAFT"), []);
  assert.ok(state.lines.some((line) => line.status === "EXTRA_QUOTATION"), "back, and read as its extra quotation again");
});

test("the client's quotation lists what approved extra quotations added - no prices - and its updated total counts them", async () => {
  const { publicSaleExtrasFor } = require("../src/modules/sales/sale-extras/totals");
  const A = await booked("n");
  // Nothing published, nothing approved: the page is as it always was.
  assert.equal(await publicSaleExtrasFor(A.quotation), null);

  const row = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Photo Booth", quantity: 2, saleBaseline: scopeOf("SERVICE", { quantity: 2 }) } });
  const viaRequest = await prisma.projectExtraQuotation.create({ data: { requestCode: tag("EXTn1"), projectId: A.project.id, service: "CRQ · Photo Booth", amount: 4500, requestedByName: "T", status: "APPROVED", decidedAt: new Date("2026-11-20") } });
  await prisma.projectChangeRequest.create({ data: {
    requestCode: tag("CRQn"), projectId: A.project.id, requestType: "SERVICE", shootId: A.shoot.id, status: "ACCEPTED", requestedById: F.admin.id, decidedAt: new Date("2026-11-20"), extraQuotationId: viaRequest.id,
    items: { create: [{ itemType: "SERVICE", itemName: "Photo Booth", quantity: 2, decision: "APPROVED", approvedAmount: 4500, approvedQuantity: 2, appliedRecordId: row.id }] },
  } });
  await prisma.projectExtraQuotation.create({ data: { requestCode: tag("EXTn2"), projectId: A.project.id, shootId: A.shoot.id, service: "Drone add-on", amount: 1500, requestedByName: "T", status: "APPROVED", decidedAt: new Date("2026-11-21") } });
  // A pending one is not agreed yet: neither listed nor counted.
  await prisma.projectExtraQuotation.create({ data: { requestCode: tag("EXTn3"), projectId: A.project.id, service: "Not agreed", amount: 999, requestedByName: "T", status: "PENDING" } });

  let shown = await publicSaleExtrasFor(A.quotation);
  assert.deepEqual(shown.added.map((item) => [item.item, item.category, item.relatedShoot, item.detail]), [["Photo Booth", "SERVICE", "Pre-wedding", "Quantity 2"], ["Drone add-on", null, "Pre-wedding", null]]);
  assert.deepEqual(shown.removed, []);
  assert.equal(shown.updatedTotal, 235000 + 4500 + 1500, "the quotation plus the approved extra quotations");
  assert.ok(!JSON.stringify(shown.added).includes("4500") && !JSON.stringify(shown.added).includes("EXT"), "no price or code per item");

  // With a published revision beside them: both lists, and a total counting the revision and the extras.
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
  await publishTyped(A.project.id, () => 2000);
  shown = await publicSaleExtrasFor(A.quotation);
  assert.deepEqual(shown.removed.map((item) => item.item), ["Candid Video"]);
  assert.ok(shown.added.some((item) => item.item === "Photo Booth"));
  assert.equal(shown.updatedTotal, 235000 - 2000 + 4500 + 1500);
});
