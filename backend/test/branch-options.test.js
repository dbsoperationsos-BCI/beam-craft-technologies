const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { branchOptions } = require("../src/services/branchOptions");
const { branches: crmBranches } = require("../src/modules/sales/crm-leads/controller");

/*
 * One branch list for the whole application.
 *
 * The quotation's Source Branch has always read the `branch` table. The CRM did not: it carried six
 * names in the browser - `Erode`, `Tiruppur`, `Coimbatore`, `Bangalore`, `Hyderabad`, `Vizag` - and
 * not one of them is a branch the studio has, which are `Erode TN`, `Tiruppur TN`, `Coimbatore TN`,
 * `Bangalore KA`, `Hyderabad TL` and `Visakhapatnam AP`. So Assigned Branch on a lead offered six
 * values that matched nothing, and a branch added or renamed in Settings never reached the CRM.
 *
 * The two screens answer from one place now, and these hold that: the same rows and the same rule,
 * from the branch table alone.
 *
 * Needs MySQL, like test/iam.test.js. Fixtures carry the `TBO-` prefix and are removed either way.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TBO-${STAMP}-${name}`;
const F = {};

function fakeRes() {
  const res = {};
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test.before(async () => {
  F.mine = await prisma.branch.create({ data: { code: tag("MINE"), name: `Picker Branch ${STAMP}` } });
  F.other = await prisma.branch.create({ data: { code: tag("OTHER"), name: `Picker Other ${STAMP}` } });
  // Disabled: it exists, and a lead must not be filed against it.
  F.closed = await prisma.branch.create({ data: { code: tag("CLOSED"), name: `Picker Closed ${STAMP}`, isActive: false } });
  F.admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  assert.ok(F.admin, "a super admin is needed to read the unnarrowed list");
});

test.after(async () => {
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TBO-${STAMP}` } } });
  await prisma.$disconnect();
});

test("the list is the branch table, active only", async () => {
  const names = await branchOptions(prisma);
  assert.ok(names.includes(F.mine.name), "an active branch is missing from the picker");
  assert.ok(!names.includes(F.closed.name), "a disabled branch can still be filed against");
  // Sorted, because it is read as a list rather than searched: an unordered picker is unusable.
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("the CRM answers from the same list as every other branch picker", async () => {
  /*
   * The whole point. `sourceBranchOptions` in the projects controller *is* `branchOptions` now, so
   * the quotation's Source Branch and the CRM's Assigned Branch cannot describe two studios.
   */
  const res = fakeRes();
  await crmBranches({ user: { id: F.admin.id } }, res);
  assert.ok(!res.code || res.code === 200, `the CRM branch list answered ${res.code}`);

  /*
   * Asserted as properties of the one answer rather than by comparing it with a second live read.
   * The suites run in parallel against one database and several of them create and delete branches,
   * so two reads a moment apart can honestly differ - a test that demanded they match would fail for
   * a reason that has nothing to do with the picker. That the CRM calls `branchOptions` at all is
   * the case below; this is what its answer has to look like.
   */
  const offered = (res.body?.data || []).map((row) => row.value);
  assert.ok(offered.includes(F.mine.name), "an active branch is missing from the CRM's picker");
  assert.ok(!offered.includes(F.closed.name), "the CRM offers a disabled branch");
  assert.deepEqual(offered, [...offered].sort((a, b) => a.localeCompare(b)), "the CRM's list is unordered");
  // `{ value, label, id }`: the first two are what `Dropdown` takes without a caller reshaping it,
  // and the id is what lets a screen match a record's `branch_id` to its option.
  for (const row of res.body.data) assert.equal(row.value, row.label);
});

test("the CRM's list is narrowed to what the reader reaches", async () => {
  // Not a formality: the picker is what a save is checked against elsewhere, so a list that is not
  // narrowed offers a branch the person cannot file to and turns a save into a 403 nobody expected.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");
  const handler = controller.slice(controller.indexOf("async function branches("), controller.indexOf("// Every vertical's fields"));
  /*
   * Either function: `branchOptionRows` is `branchOptions` with each row's id still attached - the
   * CRM asks for that form so Assigned Branch can show the branch a lead is *filed under* rather
   * than the text it was written with. Both apply the same narrowing, which is what this is about;
   * what must never disappear is the `req.user.id` passed into it.
   */
  /*
   * And narrowed **by the board's own permission**, not by every branch the reader reaches anywhere.
   * Somebody may hold CRM Leads across all six branches through one role and Asset Management in one
   * through another; a picker that asked without naming the permission would take the wider of the
   * two, which is the fault the per-permission rule exists to remove.
   */
  assert.match(
    handler,
    /branchOption(?:Rows)?\(prisma, Number\(req\.user\.id\), \{ module: "SALES", feature: "CRM Leads" \}\)/,
    "the CRM branch list is not narrowed to the reader, by this board's own permission",
  );
});

test("only the branch table answers; nothing is written down to stand in for it", async () => {
  // With branches recorded, the answer is the table's own rows - this file's fixture among them.
  const names = await branchOptions(prisma);
  assert.ok(names.includes(F.mine.name));
  const source = require("node:fs").readFileSync(require.resolve("../src/services/branchOptions"), "utf8");
  assert.doesNotMatch(source, /FALLBACK_BRANCHES|\[\s*"Erode TN"/, "a written-down branch list is back");
});

test("a reader who reaches no branch is offered none", async () => {
  const iamService = require("../src/services/iam.service");
  const original = iamService.reachableBranchIds;
  iamService.reachableBranchIds = async () => [];
  try {
    assert.deepEqual(await branchOptions(prisma, 1), []);
  } finally {
    iamService.reachableBranchIds = original;
  }
});

test("the projects controller no longer keeps a branch list of its own", () => {
  // `sourceBranchOptions` is the shared one under an old name; the array it used to hold is gone.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  assert.match(controller, /const sourceBranchOptions = branchOptions;/);
  assert.ok(!controller.includes("const fallbackSourceBranches ="), "the projects controller wrote its branches down again");
});

test("a lead's Assigned Branch text is the branch's own name", async () => {
  /*
   * The migration that followed the picker: leads held `Erode` while the branch is `Erode TN`, and
   * `Dropdown` shows its placeholder for a value it cannot find among its options - so every lead
   * would have read as having no branch at all once the picker started offering the real names.
   *
   * Rewritten from `branch_id`, which `referenceMatchers` had resolved correctly all along. Asserted
   * as the property rather than as a list of spellings: whatever the studio's data is, a lead that
   * names a branch must name it the way the branch does.
   */
  const wrong = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS `n` FROM `sales_crm_lead` `l` JOIN `branch` `b` ON `b`.`id` = `l`.`branch_id`"
    + " WHERE `l`.`branch_id` IS NOT NULL AND TRIM(COALESCE(`l`.`assigned_branch`, '')) <> `b`.`name`",
  );
  assert.equal(Number(wrong[0].n), 0, "a lead's Assigned Branch disagrees with the branch it points at");
});
