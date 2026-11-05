const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const controller = require("../src/modules/sales/projects/controller");
const { retrying } = require("./helpers/retrying");

/*
 * A quotation belongs to an enquiry, not to whoever typed it.
 *
 * One enquiry is quoted, re-quoted and eventually booked as a project, and the people who touch it
 * along the way are rarely the same person. So the enquiry counts as a name: a quotation is yours
 * if you may read the lead it was raised against, or the project it became.
 *
 * And the two halves of the screen ask different questions. The **register** shows a person their
 * own rows. The **version dropdown on the project form** shows every version raised for the enquiry
 * being booked, whoever raised them - a project is booked against a quotation somebody else wrote,
 * and a narrowed dropdown means the plan cannot be brought across.
 *
 * Driven through the controller with a fake request and response, because the seam between those
 * two questions is the query string and nothing below the handler can see it.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TQE-${STAMP}-${name}`;
const F = {};
// A project is keyed to its lead (20260924150000), so every enquiry a fixture names gets one.
const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await retrying(() => prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } }));
  await retrying(() => prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ_WRITE" } }));
  await retrying(() => prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } }));
  if (reachBranchIds.length) await retrying(() => prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) }));
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

/** A request and a response thin enough to call a handler with, and read what it answered. */
function call(handler, { userId, query = {}, params = {} }) {
  return new Promise((resolve) => {
    const req = { user: { id: userId }, query, params, permission: { module: "SALES", feature: "Quotation Management", level: "READ" } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler(req, res);
  });
}

const numbersOf = (body) => (body?.data || [])
  .map((row) => String(row.quotationNumber || ""))
  .filter((number) => number.startsWith(`TQE-${STAMP}`))
  .map((number) => number.replace(`TQE-${STAMP}-`, ""))
  .sort();

before(async () => {
  F.br = await retrying(() => prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Scope Branch ${STAMP}` } }));
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const person = (name) => retrying(() => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Quotation Scope ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name } }));
  F.booker = await person("booker");
  F.quoter = await person("quoter");
  F.stranger = await person("str");
  const login = (name, employee) => retrying(() => prisma.user.create({ data: { name: `Quotation scope ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: employee.id } }));
  F.bookerLogin = await login("booker", F.booker);
  F.strangerLogin = await login("str", F.stranger);
  invalidate();

  /*
   * The scenario the studio described: one person quotes an enquiry, a different person books the
   * project from it. Every quotation below is owned by the quoter, and the booker is named on
   * nothing but the project.
   */
  F.enquiryBooked = tag("ENQ-BOOKED");
  F.enquiryOpen = tag("ENQ-OPEN");
  await leadFor(F.enquiryBooked);
  await leadFor(F.enquiryOpen);
  const quotation = (name, enquiryId, version = 1) => retrying(() => prisma.salesQuotation.create({ data: {
    quotationNumber: tag(name), quotationId: tag(`${name}-${version}`), publicToken: tag(name).slice(-16),
    payload: {}, version, sourceBranch: F.br.name, branchId: F.br.id,
    enquiryId, followedBy: F.quoter.employeeName, ownerEmployeeId: F.quoter.id,
  } }));
  await quotation("q-booked", F.enquiryBooked);
  await quotation("q-open", F.enquiryOpen);

  // The project the booker runs, raised from the quoted enquiry.
  await retrying(() => prisma.salesProject.create({ data: {
    enquiryId: F.enquiryBooked, eventId: tag("evt"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: "+919876543210",
    sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED", verticalId: F.dumDum.id,
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", projectManagerEmployeeId: F.booker.id,
  } }));
});

after(async () => {
  await prisma.salesQuotationShare.deleteMany({ where: { quotationNumber: { startsWith: `TQE-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TQE-${STAMP}` } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQE-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TQE-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.bookerLogin.id, F.strangerLogin.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.bookerLogin.id, F.strangerLogin.id] } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TQE-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TQE-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the person who books a project gets the quotation it was sold on", async () => {
  const undo = await grant(F.bookerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    const { body } = await call(controller.listQuotations, { userId: F.bookerLogin.id });
    /*
     * `q-booked` is somebody else's quotation by every column on it - a different owner, and this
     * login did not create it. It is on the register because its enquiry became the project this
     * person runs, which is what "a quotation belongs to an enquiry" means.
     *
     * `q-open` is the control: same owner, same branch, an enquiry nobody has booked. It stays with
     * the person who quoted it.
     */
    assert.deepEqual(numbersOf(body), ["q-booked"]);
  } finally { await undo(); }
});

test("sharing a branch with the quoter is still not a claim on their quotations", async () => {
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    const { body } = await call(controller.listQuotations, { userId: F.strangerLogin.id });
    assert.deepEqual(numbersOf(body), [], "reaching the branch grants nothing on its own");
  } finally { await undo(); }
});

test("a quotation shared with somebody is on their register, with every version of it", async () => {
  /*
   * Sharing is how a quotation reaches a colleague whose own work does not: the stranger owns none
   * of these and books none of the projects, and the test above has them seeing nothing at all. A
   * share is of the **chain**, so the second version of `q-open` comes with the first.
   */
  await retrying(() => prisma.salesQuotation.create({ data: {
    quotationNumber: tag("q-open"), quotationId: tag("q-open-2"), publicToken: tag("q-open-v2").slice(-16),
    payload: {}, version: 2, sourceBranch: F.br.name, branchId: F.br.id,
    enquiryId: F.enquiryOpen, followedBy: F.quoter.employeeName, ownerEmployeeId: F.quoter.id,
  } }));
  await retrying(() => prisma.salesQuotationShare.create({ data: { quotationNumber: tag("q-open"), employeeId: F.stranger.id, employeeName: F.stranger.employeeName } }));
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    const { body } = await call(controller.listQuotations, { userId: F.strangerLogin.id });
    assert.deepEqual(numbersOf(body), ["q-open"], "the shared chain, and nothing else of the quoter's");
    const row = (body.data || []).find((item) => item.quotationNumber === tag("q-open"));
    assert.equal(row.versionCount, 2, "both versions come with the chain");
    // And the row says who it is shared with, which is what the form reopens on.
    assert.deepEqual(row.sharedWith, [{ employeeId: F.stranger.id, employeeName: F.stranger.employeeName }]);
  } finally { await undo(); }
});

test("somebody a quotation is shared with may change it; somebody it is not may not", async () => {
  // `scopedQuotation` is the one gate on every write path - the next version, the draft, the
  // delete - so a share reaching it is what makes a shared quotation editable rather than readable.
  const sharedVersion = await prisma.salesQuotation.findFirst({ where: { quotationNumber: tag("q-open"), version: 2 }, select: { id: true } });
  const ownOnly = await prisma.salesQuotation.findFirst({ where: { quotationNumber: tag("q-booked") }, select: { id: true } });
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  const req = { user: { id: F.strangerLogin.id }, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } };
  try {
    await assert.rejects(controller.deleteQuotationRecord(req, ownOnly.id), /not found/, "nothing is reachable by sharing something else");
    await controller.deleteQuotationRecord(req, sharedVersion.id);
    const gone = await prisma.salesQuotation.findUnique({ where: { id: sharedVersion.id }, select: { deletedAt: true } });
    assert.ok(gone.deletedAt, "the shared quotation was theirs to change");
  } finally { await undo(); }
});

test("who a quotation is shared with stays with the people whose own work it is", async () => {
  /*
   * A sharee edits the quotation - that is what a share is for - but the share list itself is the
   * owner's. Otherwise anybody shared with could drop the colleagues already on it or pass the
   * chain on to somebody else, which is a second permission system nobody granted.
   */
  const quotations = require("../src/services/quotationShares");
  const strangerScope = { employeeId: F.stranger.id };
  const req = { user: { id: F.strangerLogin.id }, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } };
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    assert.deepEqual([...await quotations.sharedChainNumbers(strangerScope)], [tag("q-open")], "the share is what they reach it by");
    // `maySetShares` is not exported; the behaviour is the register's `canShare`, which says no.
    const { body } = await call(controller.listQuotations, { userId: F.strangerLogin.id });
    const row = (body.data || []).find((item) => item.quotationNumber === tag("q-open"));
    assert.equal(row.canShare, false, "theirs to edit, not theirs to share on");
    // The quoter, whose quotation it is, sets the list.
    assert.deepEqual([...await quotations.sharedChainNumbers({ employeeId: F.quoter.id })], [], "and the owner holds it by their own name");
  } finally { await undo(); }
  // A name that is not a working employee refuses the save outright, rather than being dropped in
  // silence - and nothing is written before the check, so no version is raised on a bad list.
  await assert.rejects(quotations.shareablePeople([999999999]), (error) => error.status === 400 && /no longer a working employee/.test(error.message));
  await prisma.salesQuotationShare.deleteMany({ where: { quotationNumber: tag("q-open") } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: tag("q-open"), version: 2 } });
});

test("a save that changes nothing in the document raises no version", async () => {
  /*
   * A version says "this replaces what I sent you". Opening a quotation and saving it without
   * changing the document - the case that brought this in was changing only who it is shared with -
   * used to raise one all the same, leaving a chain of identical documents and moving the client's
   * link onto the newest of them.
   */
  const source = await prisma.salesQuotation.findFirst({ where: { quotationNumber: tag("q-booked") } });
  const undo = await grant(F.bookerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    // Against the version being edited, which is what the form sends: Save changes carries the id
    // of the version open in it, and the next save carries the one it just raised.
    const save = (body, id) => new Promise((resolve) => {
      const req = { user: { id: F.bookerLogin.id }, params: { id }, body, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } };
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(answer) { resolve({ status: this.statusCode, body: answer }); return this; } };
      controller.createQuotationVersion(req, res);
    });
    // The document as the form sends it, raised once...
    const document = { enquiryId: source.enquiryId, clientName: "Asha", subtotal: 40000, discount: 0, amount: 40000, deliverables: [{ deliverableName: "AI Retouch", quantity: 1 }] };
    const raised = await save(document, source.id);
    assert.equal(raised.status, 201);
    assert.equal(raised.body.data.version, 2);
    // ...and sent again, unchanged: there is nothing to replace, so nothing is raised.
    const again = await save(document, raised.body.data.id);
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, true);
    assert.equal(await prisma.salesQuotation.count({ where: { quotationNumber: tag("q-booked") } }), 2);
    /*
     * And the same document reopened, which is never byte-identical: the form fills in each line's
     * rate from the catalogue and marks which discount box was typed, neither of which the client
     * reads. This is the case that brought the rule in - a quotation raised before the app asked
     * for those gained them on the first save, so every save raised a version.
     */
    const reopened = await save({
      ...document,
      discountInputSource: "PERCENTAGE",
      deliverables: [{ deliverableName: "AI Retouch", quantity: 1, unitPrice: 1000, deliverableDefinition: { id: "def-1", sortOrder: 14 } }],
    }, raised.body.data.id);
    assert.equal(reopened.body.unchanged, true, "the form's own working is not the document");
    // A line the client would read differently is a change, even with the same total.
    const relined = await save({ ...document, deliverables: [{ deliverableName: "AI Retouch", quantity: 2 }] }, raised.body.data.id);
    assert.equal(relined.status, 201);
    // A figure that differs is a different document, and that does raise one.
    const changed = await save({ ...document, subtotal: 50000, amount: 50000 }, raised.body.data.id);
    assert.equal(changed.status, 201);
  } finally {
    await undo();
    await prisma.salesQuotation.deleteMany({ where: { quotationNumber: tag("q-booked"), version: { gt: 1 } } });
  }
});

test("the version dropdown answers for one enquiry with every version raised for it", async () => {
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    /*
     * The same login the register just answered with nothing. Asked about a named enquiry it gets
     * that enquiry's versions in full: this is the project form's dropdown, and booking a project
     * means reading the quotation it is being booked from.
     */
    const { body } = await call(controller.listQuotations, { userId: F.strangerLogin.id, query: { enquiryId: F.enquiryOpen } });
    assert.deepEqual(numbersOf(body), ["q-open"]);
  } finally { await undo(); }
});

test("the picker cannot be turned into a way to read the table", async () => {
  const undo = await grant(F.strangerLogin, "SALES", "Quotation Management", [F.br.id]);
  try {
    // It answers for one enquiry at a time, and an enquiry has to be named to be asked about. An
    // empty enquiry id is not a wildcard - it is the register, which is narrowed.
    const blank = await call(controller.listQuotations, { userId: F.strangerLogin.id, query: { enquiryId: "   " } });
    assert.deepEqual(numbersOf(blank.body), []);
    const unknown = await call(controller.listQuotations, { userId: F.strangerLogin.id, query: { enquiryId: tag("ENQ-NOBODY") } });
    assert.deepEqual(numbersOf(unknown.body), []);
  } finally { await undo(); }
});
