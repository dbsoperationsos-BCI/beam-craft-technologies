const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const service = require("../src/modules/hrm/referrals/service");

/*
 * Whose referrals the register shows.
 *
 * It showed everybody's to anybody holding `HRM / Employee Referral`, which is the wrong answer for
 * a record about money owed to a named person. The rule is the studio's usual one - yours if you
 * made it, or if somebody reporting to you made it - with the branch limb added for a holder of
 * `ADMIN / Branch Administration`.
 *
 * The branch is the part worth a suite of its own, because `EmployeeReferral` has **no `branch_id`**
 * and deliberately never got one: a referral's branch is the referrer's, read live through the
 * relation, so somebody transferring branches takes their referrals with them instead of leaving a
 * stale copy behind. That is a different query shape from every other module's branch limb, and the
 * only way to know it works is to run it.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TRF-${STAMP}-${name}`;
const F = {};

const idsFor = async (userId) => (await service.listReferrals({ userId })).map((row) => row.referralId).sort();

before(async () => {
  F.here = await prisma.branch.create({ data: { code: tag("BR"), name: `Referral Scope Branch ${STAMP}` } });
  F.away = await prisma.branch.create({ data: { code: tag("AWAY"), name: `Referral Scope Away ${STAMP}` } });

  const employee = (name, data) => prisma.employee.create({
    data: { employeeId: tag(name), employeeName: `Referral ${name}`, employmentStatus: "Active", ...data },
  });
  F.manager = await employee("manager", { branchId: F.here.id });
  F.report = await employee("report", { branchId: F.here.id, reportsToEmployeeId: F.manager.id });
  // Same branch, reporting to nobody in this cast: reachable by a branch administrator and by no
  // one else, which is the row that tells the branch limb from the reporting line.
  F.colleague = await employee("colleague", { branchId: F.here.id });
  F.outsider = await employee("outsider", { branchId: F.away.id });
  // A second person in the branch nobody in this cast reaches, so there is a referral the branch
  // administrator must not see that is not simply their own.
  F.stranger = await employee("stranger", { branchId: F.away.id });

  const user = (name, employeeId, roleId) => prisma.user.create({
    data: {
      name: tag(name),
      email: `${tag(name)}@example.com`,
      password: "not-a-real-hash",
      role: "EMPLOYEE",
      branchId: F.here.id,
      linkedEmployeeId: employeeId,
      roles: { create: [{ roleId }] },
    },
  });

  const referral = await prisma.permission.findFirst({ where: { module: "HRM", feature: "Employee Referral" } });
  const branchAdmin = await prisma.permission.findFirst({ where: { module: "ADMIN", feature: "Branch Administration" } });
  assert.ok(referral && branchAdmin, "the catalogue needs Employee Referral and Branch Administration");

  F.plainRole = await prisma.role.create({
    data: { name: tag("plain"), permissions: { create: [{ permissionId: referral.id, accessLevel: "READ_WRITE" }] } },
  });
  F.adminRole = await prisma.role.create({
    data: {
      name: tag("branch-admin"),
      permissions: { create: [
        { permissionId: referral.id, accessLevel: "READ_WRITE" },
        { permissionId: branchAdmin.id, accessLevel: "READ" },
      ] },
      branches: { create: [{ branchId: F.here.id }] },
    },
  });

  F.managerUser = await user("manager-user", F.manager.id, F.plainRole.id);
  F.reportUser = await user("report-user", F.report.id, F.plainRole.id);
  F.adminUser = await user("admin-user", F.outsider.id, F.adminRole.id);

  // One referral each, so every row is traceable to exactly one referrer.
  const referred = async (name) => (await employee(name, { branchId: F.here.id })).id;
  const make = (code, referrer, referredId) => prisma.employeeReferral.create({
    data: {
      referralId: tag(code),
      referrerEmployeeId: referrer.id,
      referrerName: referrer.employeeName,
      referredEmployeeId: referredId,
      referredOn: new Date(),
    },
  });
  await make("by-manager", F.manager, await referred("hire-a"));
  await make("by-report", F.report, await referred("hire-b"));
  await make("by-colleague", F.colleague, await referred("hire-c"));
  await make("by-outsider", F.outsider, await referred("hire-d"));
  await make("by-stranger", F.stranger, await referred("hire-e"));
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `TRF-${STAMP}-` } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: `TRF-${STAMP}-` } } });
  // The referral goes with the employee it was made for - `referred` is onDelete: Cascade.
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TRF-${STAMP}-` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TRF-${STAMP}-` } } });
  await prisma.$disconnect();
});

test("a referrer sees their own, and a manager sees their report's as well", async () => {
  assert.deepEqual(await idsFor(F.reportUser.id), [tag("by-report")], "the report sees only what they made");
  assert.deepEqual(await idsFor(F.managerUser.id), [tag("by-manager"), tag("by-report")].sort(),
    "the manager sees their own and the one below them, and neither colleague's nor the other branch's");
  assert.ok(!(await idsFor(F.managerUser.id)).includes(tag("by-colleague")),
    "reaching a branch is not on its own a claim on the work of the people in it");
});

test("a branch administrator sees the branch, and not the branch they do not reach", async () => {
  /*
   * The admin is filed in the *away* branch and reaches `here` through their role, so this also
   * checks the branch is read off the **referrer** rather than off the reader.
   *
   * `by-outsider` is in the list because it is the admin's own referral - their name is on it - and
   * not because of any branch. `by-stranger` is the same branch as their own and is still absent,
   * which is the honest reading: a branch administrator gets the branches their role names, and
   * being filed somewhere is not one of them.
   */
  const seen = await idsFor(F.adminUser.id);
  assert.deepEqual(seen, [tag("by-colleague"), tag("by-manager"), tag("by-outsider"), tag("by-report")].sort(),
    "every referral whose referrer works in the reachable branch, plus the admin's own");
  assert.ok(!seen.includes(tag("by-stranger")),
    "a referral from a branch the role does not name stays out, even one filed beside the reader");
});

test("an instalment is settled by hand only inside the reader's reach, once, and payroll then leaves it out", async () => {
  /*
   * Employee Referral → ⋮ → Mark 3rd month paid, for money handed over outside payroll. Hiding a row
   * from the register is no protection while its id can still be sent to the write, so the write asks
   * the same question the list does - and answers 404, as the list does, for one out of reach.
   */
  const payoutOf = async (code) => {
    const referral = await prisma.employeeReferral.findFirst({ where: { referralId: tag(code) } });
    return prisma.employeeReferralPayout.create({ data: { referralId: referral.id, monthOffset: 3, dueOn: new Date(Date.UTC(2031, 0, 15)), amount: 3000 } });
  };
  const mine = await payoutOf("by-report");
  const theirs = await payoutOf("by-stranger");

  await assert.rejects(service.updatePayout(theirs.id, {}, F.reportUser.id), { status: 404 }, "a referral out of reach cannot be paid by its id");
  assert.equal((await prisma.employeeReferralPayout.findUnique({ where: { id: theirs.id } })).status, "Pending");

  const paid = await service.updatePayout(mine.id, { paidOn: "2031-01-10", remarks: "Paid by cash" }, F.reportUser.id);
  assert.equal(paid.status, "Paid");
  assert.equal(paid.payrollEntryId, null, "settled by hand, not by a payroll row");
  assert.equal(paid.paidByUserId, F.reportUser.id);
  assert.equal(paid.remarks, "Paid by cash");
  await assert.rejects(service.updatePayout(mine.id, {}, F.reportUser.id), { status: 409 }, "paid once, never twice");

  // Payroll carries only what is still Pending, so the month it falls due in pays nothing for it.
  const referrals = await prisma.employeeReferral.findMany({ where: { referralId: tag("by-report") }, ...service.REFERRAL_BONUS_SELECT });
  const due = service.referralBonusDueIn(2031, 1, referrals, { referrer: { employmentStatus: "Active", archivedAt: null }, working: ["Active"] });
  assert.equal(due.amount, 0);
  assert.deepEqual(due.payoutIds, []);
});

test("a stopped instalment - the hire has left - cannot be settled by hand", async () => {
  const referral = await prisma.employeeReferral.findFirst({ where: { referralId: tag("by-manager") } });
  const payout = await prisma.employeeReferralPayout.create({ data: { referralId: referral.id, monthOffset: 3, dueOn: new Date(Date.UTC(2031, 0, 15)), amount: 3000 } });
  await prisma.employee.update({ where: { id: referral.referredEmployeeId }, data: { employmentStatus: "Relieved" } });
  try {
    await assert.rejects(service.updatePayout(payout.id, {}, F.managerUser.id), { status: 409 });
    assert.equal((await prisma.employeeReferralPayout.findUnique({ where: { id: payout.id } })).status, "Pending");
  } finally {
    await prisma.employee.update({ where: { id: referral.referredEmployeeId }, data: { employmentStatus: "Active" } });
  }
});

test("the route is guarded by the router's Employee Referral guard - READ_WRITE for a PATCH", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/referrals/routes.js"), "utf8");
  assert.ok(routes.indexOf('router.use(requireModule("HRM", "Employee Referral"));') < routes.indexOf('router.patch("/payouts/:payoutId", updatePayout);'));
  assert.match(routes, /router\.get\("\/", listReferrals\);/);
});

test("a referral is deleted only inside the reader's reach, never once anything on it was paid", async () => {
  const idOf = async (code) => (await prisma.employeeReferral.findFirst({ where: { referralId: tag(code) } })).id;
  await assert.rejects(service.deleteReferral(await idOf("by-stranger"), F.reportUser.id), { status: 404 }, "out of reach answers as missing");
  // Its own paid instalment, so this does not lean on the settle test having run first.
  await prisma.employeeReferralPayout.upsert({
    where: { referralId_monthOffset: { referralId: await idOf("by-report"), monthOffset: 9 } },
    update: { status: "Paid" },
    create: { referralId: await idOf("by-report"), monthOffset: 9, dueOn: new Date(Date.UTC(2031, 6, 15)), amount: 3000, status: "Paid", paidOn: new Date() },
  });
  await assert.rejects(service.deleteReferral(await idOf("by-report"), F.reportUser.id), { status: 409 }, "money that left the studio stays on record");
  await assert.rejects(service.deleteReferral("abc", F.reportUser.id), { status: 404 }, "a bulk Delete counts a bad id as missed");

  const id = await idOf("by-manager");
  await service.deleteReferral(id, F.managerUser.id);
  assert.equal(await prisma.employeeReferral.findUnique({ where: { id } }), null);
  assert.equal(await prisma.employeeReferralPayout.count({ where: { referralId: id } }), 0, "its instalments go with it");
  assert.ok(!(await idsFor(F.managerUser.id)).includes(tag("by-manager")));
});

test("Delete is under the register's guard, the bulk one also behind Table Select All, /bulk before /:id", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/referrals/routes.js"), "utf8");
  const guard = routes.indexOf('router.use(requireModule("HRM", "Employee Referral"));');
  const bulk = routes.indexOf('mountBulkDelete(router, { deleteOne: (id, req) => deleteReferralRecord(id, req.user.id), noun: "referral" });');
  const one = routes.indexOf('router.delete("/:id", deleteReferral);');
  assert.ok(guard > 0 && guard < bulk && bulk < one);
});
