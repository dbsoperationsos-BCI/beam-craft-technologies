const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const controller = require("../src/modules/sales/projects/controller");

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

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ_WRITE" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
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
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Scope Branch ${STAMP}` } });
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const person = (name) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Quotation Scope ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name } });
  F.booker = await person("booker");
  F.quoter = await person("quoter");
  F.stranger = await person("str");
  const login = (name, employee) => prisma.user.create({ data: { name: `Quotation scope ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: employee.id } });
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
  const quotation = (name, enquiryId, version = 1) => prisma.salesQuotation.create({ data: {
    quotationNumber: tag(name), quotationId: tag(`${name}-${version}`), publicToken: tag(name).slice(-16),
    payload: {}, version, sourceBranch: F.br.name, branchId: F.br.id,
    enquiryId, followedBy: F.quoter.employeeName, ownerEmployeeId: F.quoter.id,
  } });
  await quotation("q-booked", F.enquiryBooked);
  await quotation("q-open", F.enquiryOpen);

  // The project the booker runs, raised from the quoted enquiry.
  await prisma.salesProject.create({ data: {
    enquiryId: F.enquiryBooked, eventId: tag("evt"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: "+919876543210",
    sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED", verticalId: F.dumDum.id,
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", projectManagerEmployeeId: F.booker.id,
  } });
});

after(async () => {
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TQE-${STAMP}` } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQE-${STAMP}` } } });
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
