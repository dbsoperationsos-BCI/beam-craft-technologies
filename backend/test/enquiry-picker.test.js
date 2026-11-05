const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { listEnquiries } = require("../src/modules/sales/projects/controller");

/*
 * What Create Project offers to book a project against.
 *
 * One rule, and it is the whole of this file: **the picker is Leads & Followups**. Whatever is on
 * that board is offerable here and whatever is not on it is not, because an enquiry id that cannot
 * be opened in the CRM is one a project must not be booked against. Four separate faults each
 * broke it in a different direction.
 *
 *   1. It offered *deleted* leads. `deleted_at` was not in the query at all, so a studio that had
 *      cleared its leads out saw an empty board and a full picker - and a project booked against one
 *      of those rows pointed at an enquiry nobody could open.
 *   2. It offered leads the reader may not see. The board narrows by `leadScope`; this narrowed by
 *      nothing.
 *   3. It hid most of the board. It ordered by `enquiryId` descending, which is a *text* sort
 *      across every vertical - `QQ` above `DD` above `CORP` - and took the first twenty. On thirty
 *      live leads that was the whole of Qua Qua, part of Dum Dum, and not one Corp enquiry: the
 *      studio's complaint was "I have many enquiries and get only a few".
 *   4. It offered Callyzer's calls. The old webhook minted a lead per delivered call, and those rows
 *      are on the Calls board rather than on Leads & Followups - so a wrong number was offerable as
 *      an enquiry, and there were enough of them to fill the page on their own.
 *
 * Needs MySQL, like test/iam.test.js. Fixtures carry the `TEP-` prefix and are removed either way;
 * see `scripts/clear-test-fixtures.js` for what happens when a run does not reach its end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TEP-${STAMP}-${name}`;
const F = {};

/** The controller answers a request; this is the smallest thing that counts as one. */
function fakeRes() {
  const res = {};
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const ask = async (user, search) => {
  const res = fakeRes();
  await listEnquiries({ query: search === undefined ? {} : { search }, user }, res);
  assert.ok(!res.code || res.code === 200, `the picker answered ${res.code}: ${JSON.stringify(res.body)}`);
  return res.body;
};

/** Only the rows this file made, so the studio's own leads never decide the answer. */
const mine = (body) => (body?.data || []).map((row) => row.enquiryId).filter((id) => id.startsWith(`TEP-${STAMP}`));

/**
 * Runs `body` with `user` holding exactly `permission` at READ, reaching exactly `branchIds`.
 *
 * The grant is built and torn down around the call, the way data-scope-crm.test.js does it, so no
 * test leaves a role behind that would change another's answer.
 */
async function withGrant(user, permission, branchIds, body) {
  const row = await prisma.permission.findFirst({ where: permission, select: { id: true } });
  assert.ok(row, `the seed no longer has ${permission.module} / ${permission.feature}`);
  const role = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 6)}`) } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: row.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (branchIds.length) await prisma.roleBranch.createMany({ data: branchIds.map((id) => ({ roleId: role.id, branchId: id })) });
  try {
    return await body();
  } finally {
    // `user_role`, `role_permission` and `role_branch` are all onDelete: Cascade from the role.
    await prisma.role.delete({ where: { id: role.id } });
  }
}

before(async () => {
  F.br1 = await prisma.branch.create({ data: { code: tag("BR1"), name: `Picker Branch ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("BR2"), name: `Picker Other ${STAMP}` } });
  // A branch with nothing enquired into it, for the "no leads on the board" case below.
  F.empty = await prisma.branch.create({ data: { code: tag("BR3"), name: `Picker Empty ${STAMP}` } });
  F.me = await prisma.employee.create({ data: { employeeId: tag("me"), employeeName: `Picker Me ${STAMP}` } });
  F.stranger = await prisma.employee.create({ data: { employeeId: tag("str"), employeeName: `Picker Stranger ${STAMP}` } });
  F.login = await prisma.user.create({
    data: {
      name: "Picker scope me",
      email: `${tag("me")}@test.local`.toLowerCase(),
      username: tag("me").toLowerCase(),
      password: "x",
      role: "ADMIN",
      branchId: F.br1.id,
      linkedEmployeeId: F.me.id,
    },
  });
  /*
   * A login with no employee behind it and no lead of its own.
   *
   * The scope rule is not only about branches - a lead is yours if you are its CRM, if somebody
   * reporting to you is, or if you entered it - so `F.login`, which owns one, keeps seeing it
   * wherever it is filed. That is correct, and it is why the empty-board case needs somebody who
   * owns nothing: otherwise the test proves the branch rule is broken when it is working.
   */
  F.outsider = await prisma.user.create({
    data: {
      name: "Picker outsider",
      email: `${tag("out")}@test.local`.toLowerCase(),
      username: tag("out").toLowerCase(),
      password: "x",
      role: "ADMIN",
      branchId: F.empty.id,
    },
  });
  F.admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  assert.ok(F.admin, "a super admin is needed to read the unnarrowed list");
  invalidate();

  const dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const lead = (name, data) => prisma.salesCrmLead.create({
    data: { enquiryId: tag(name), name: `Picker ${name}`, verticalName: "Dum Dum", verticalId: dumDum?.id ?? null, ...data },
  });
  // Live, mine, in my branch. The one everything else is compared against.
  await lead("live", { assignedBranch: F.br1.name, branchId: F.br1.id, ownerEmployeeId: F.me.id, phone: "9000000001" });
  // Deleted: on no board, so offerable nowhere.
  await lead("gone", { assignedBranch: F.br1.name, branchId: F.br1.id, ownerEmployeeId: F.me.id, deletedAt: new Date() });
  // Somebody else's, in a branch I do not reach: on their board and not on mine.
  await lead("stranger", { assignedBranch: F.br2.name, branchId: F.br2.id, ownerEmployeeId: F.stranger.id, phone: "9000000002" });
  /*
   * An untriaged Callyzer call: source Callyzer and no vertical, which is what the stored
   * `board_key` column reads as the Calls board. Written without a vertical on purpose - the two
   * fields together are the whole definition, and this is exactly the shape the old webhook left
   * behind by the thousand.
   */
  await prisma.salesCrmLead.create({
    data: { enquiryId: tag("call"), name: "Unknown", verticalName: null, verticalId: null, source: "Callyzer", assignedBranch: F.br1.name, branchId: F.br1.id, ownerEmployeeId: F.me.id, phone: "9000000003" },
  });
});

after(async () => {
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TEP-${STAMP}` } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: `TEP-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `TEP-${STAMP}` } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TEP-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TEP-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("a deleted lead is not offered as an enquiry to book against", async () => {
  const offered = mine(await ask(F.admin));
  assert.ok(offered.includes(tag("live")), "the live enquiry is missing from the picker");
  assert.ok(!offered.includes(tag("gone")), "a deleted enquiry is still offered in Create Project");
});

test("the same is true of a search, which takes the other path through the query", async () => {
  // The `where` used to be built only when something had been typed, so the filter has to hold on
  // both paths - and the searched one is how somebody reaches a lead past the first page.
  const offered = mine(await ask(F.admin, `TEP-${STAMP}`));
  assert.ok(offered.includes(tag("live")));
  assert.ok(!offered.includes(tag("gone")), "a deleted enquiry is offered as soon as it is searched for");
});

test("the picker offers only the leads this reader's own board would show", async () => {
  /*
   * The board narrows by `leadScope` and this list narrowed by nothing, so a reader could book a
   * project against an enquiry they cannot open. Reaching branch 1 only: my own lead is offered,
   * the stranger's in branch 2 is not.
   */
  await withGrant(F.login, { module: "SALES", feature: "CRM Leads" }, [F.br1.id], async () => {
    const offered = mine(await ask({ id: F.login.id }));
    assert.ok(offered.includes(tag("live")), "the reader's own enquiry is missing from their picker");
    assert.ok(!offered.includes(tag("stranger")), "the picker offers an enquiry this reader's board hides");
  });
});

test("a sales manager who does not hold the CRM can still create a project", async () => {
  /*
   * The trap this fix had to avoid, and it is the documented one: a screen may not be given a finer
   * permission than the endpoint it reads. This route is guarded by `SALES / Sales Manager`, and
   * `dataScope.resolve` answers *closed* - no rows at all - for a permission the caller does not
   * hold. Scoping on `SALES / CRM Leads` alone would therefore have handed every sales manager
   * without the CRM an empty picker and no way to book anything, which is a worse bug than the one
   * being fixed. Both permissions are named, so whichever they hold narrows them.
   */
  await withGrant(F.login, { module: "SALES", feature: "Sales Manager" }, [F.br1.id], async () => {
    const offered = mine(await ask({ id: F.login.id }));
    assert.ok(offered.includes(tag("live")), "a sales manager without the CRM is locked out of the enquiry picker");
    // And they are still narrowed - holding Sales Manager is not a way past the branch rule.
    assert.ok(!offered.includes(tag("stranger")), "Sales Manager is being read as unlimited");
  });
});

test("the newest enquiries are the newest, not the ones that sort last", async () => {
  /*
   * `enquiryId` descending is a text sort across every vertical, so the page was filled by
   * `DBS-EID-QQ-...` before `DBS-EID-DD-...` before `DBS-EID-CORP-...` - whole verticals fell off
   * the end whatever their dates. Ordering by `createdAt` is what "newest" was always meant to say.
   */
  const body = await ask(F.admin);
  const rows = body?.data || [];
  if (rows.length < 2) return;

  const created = await prisma.salesCrmLead.findMany({
    where: { enquiryId: { in: rows.map((row) => row.enquiryId) } },
    select: { enquiryId: true, createdAt: true },
  });
  const at = new Map(created.map((row) => [row.enquiryId, row.createdAt.getTime()]));
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(
      at.get(rows[index - 1].enquiryId) >= at.get(rows[index].enquiryId),
      `the picker is not in date order: ${rows[index - 1].enquiryId} before ${rows[index].enquiryId}`,
    );
  }
});

test("no vertical is dropped off the end of the list", async () => {
  /*
   * The studio's own report, as a property: on a list shorter than the page, every live lead the
   * reader may see is offered - so Corp cannot be missing because of where it sorts.
   *
   * "Live lead" excludes the Calls board, which is not a vertical and is not an enquiry; the test
   * below is what holds that end.
   */
  const body = await ask(F.admin);
  if (body.capped) return; // A studio past the page size answers this by typing; see below.

  const live = await prisma.salesCrmLead.count({ where: { deletedAt: null, boardKey: { not: "calls" } } });
  assert.equal(body.data.length, live, "the picker is showing fewer enquiries than the board has");
  assert.equal(body.total, live);
});

test("a Callyzer call is not offered as an enquiry to book a project against", async () => {
  /*
   * The webhook used to mint a lead for every call it was delivered, out of the same run the studio
   * counts its real enquiries in - so the picker filled up with `DBS-EID-DD-ERD-000260`, "Unknown"
   * and a bare mobile number, one per wrong number and misdial, and every one of them pushed a real
   * enquiry off the fifty it shows. Those rows are still in the table; they belong to the Calls
   * board, and by this file's one rule a row that is not on Leads & Followups is not offerable.
   */
  const offered = mine(await ask(F.admin));
  assert.ok(offered.includes(tag("live")), "the live enquiry is missing from the picker");
  assert.ok(!offered.includes(tag("call")), "an untriaged Callyzer call is offered in Create Project");

  // And searched for by name or by number, which is the other path through the query.
  assert.ok(!mine(await ask(F.admin, "9000000003")).includes(tag("call")), "the call is offered as soon as its number is searched for");
  assert.ok(!mine(await ask(F.admin, tag("call"))).includes(tag("call")), "the call is offered as soon as its id is searched for");
});

test("a call that somebody triages does become an enquiry", async () => {
  /*
   * The other half, and the one that would make this fix a bug if it were missing: adding a caller
   * to a vertical is what turns a call into an enquiry, and from that moment a project may be booked
   * against it. `board_key` is generated from the vertical, so writing one is the whole of the move.
   */
  await prisma.salesCrmLead.update({ where: { enquiryId: tag("call") }, data: { verticalName: "Dum Dum" } });
  try {
    assert.ok(mine(await ask(F.admin)).includes(tag("call")), "a triaged call is still refused by the picker");
  } finally {
    await prisma.salesCrmLead.update({ where: { enquiryId: tag("call") }, data: { verticalName: null } });
  }
});

test("a list longer than its page says so, rather than stopping silently", async () => {
  // A picker that stops at its page reads as a list that has lost entries, which is exactly how the
  // old cap was experienced. `capped` is what lets the screen say "keep typing" instead.
  const body = await ask(F.admin);
  assert.equal(typeof body.total, "number");
  assert.equal(body.capped, body.total > body.data.length);
});

test("no leads on the board means no enquiry ids in Create Project", async () => {
  /*
   * The question the studio asked, put directly: with nothing on Leads & Followups the picker must
   * be empty rather than finding something somewhere else. A login that owns no lead and reaches
   * only a branch nothing was enquired into is exactly that state, and it can be arranged without
   * emptying anybody's CRM to prove it.
   */
  await withGrant(F.outsider, { module: "SALES", feature: "CRM Leads" }, [F.empty.id], async () => {
    const body = await ask({ id: F.outsider.id });
    assert.deepEqual(mine(body), [], "an enquiry is offered to a reader whose board is empty");
    assert.equal(body.capped, false, "an empty picker is claiming there is more behind it");
  });
});

test("a lead is still the reader's own wherever it is filed", async () => {
  /*
   * The other half of the rule, and the one that made the case above need an outsider: a lead is
   * yours if you are its CRM even when it was enquired into a branch you do not administer. The
   * picker has to agree with the board about that too, or somebody would be unable to book the
   * project for an enquiry sitting on their own board.
   */
  await withGrant(F.login, { module: "SALES", feature: "CRM Leads" }, [F.empty.id], async () => {
    const offered = mine(await ask({ id: F.login.id }));
    assert.ok(offered.includes(tag("live")), "a reader is refused the enquiry they own");
    assert.ok(!offered.includes(tag("stranger")), "owning one lead is not a way to see somebody else's");
  });
});
