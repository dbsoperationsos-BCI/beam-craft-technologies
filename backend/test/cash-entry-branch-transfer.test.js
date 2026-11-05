const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { entrySchema, importEntrySchema, transferFields, toRow } = require("../src/modules/accounts/cash-entries/controller");
const { accountsByBranch } = require("../src/services/branchBankAccounts");
const { paymentModes } = require("../src/services/paymentOptionLists");

/*
 * A branch transfer: one cash entry, the studio's own money leaving one branch's account for
 * another's. Read-only against the local database - two open branches are borrowed, nothing written.
 */
let branches = [];
let mode = "";

test.before(async () => {
  branches = await accountsByBranch();
  [mode] = await paymentModes();
});

test.after(async () => {
  await prisma.$disconnect();
});

const transfer = (values = {}) => ({
  entryType: "Transfer",
  category: "Branch Transfer",
  amount: 1000,
  entryDate: "2026-10-27",
  paymentMode: mode,
  handlerIsOther: true,
  handlerName: "Ravi",
  ...values,
});

test("a transfer names two different branches", async () => {
  const same = await entrySchema.safeParseAsync(transfer({ fromBranchId: 1, toBranchId: 1 }));
  assert.equal(same.success, false);
  assert.ok(same.error.issues.some((issue) => issue.path[0] === "toBranchId" && /different branch/.test(issue.message)));
  const missing = await entrySchema.safeParseAsync(transfer());
  assert.ok(missing.error.issues.some((issue) => issue.path[0] === "fromBranchId"));
});

test("a spreadsheet row cannot be a transfer, and says where to record one", async () => {
  const parsed = await importEntrySchema.safeParseAsync(transfer({ fromBranchId: 1, toBranchId: 2 }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /cannot be imported\. Record it from Add Entry/);
});

test("a transfer is filed in the branch it left, by id, with no project or client", async (t) => {
  if (branches.length < 2) return t.skip("needs two open branches");
  const [from, to] = branches;
  const fields = await transferFields({ fromBranchId: from.id, toBranchId: to.id });
  assert.deepEqual(fields, { projectId: null, shootId: null, clientName: null, branch: from.name, branchId: from.id, toBranchId: to.id });
  await assert.rejects(transferFields({ fromBranchId: from.id, toBranchId: 999999999 }), /valid branch the money went to/);
});

test("each end's account must belong to its own branch", async (t) => {
  const [from, to] = branches.filter((branch) => branch.accounts.length);
  if (!from || !to) return t.skip("needs two open branches with an account each");
  await assert.rejects(
    transferFields({ fromBranchId: from.id, toBranchId: to.id, paidFromAccount: to.accounts[0] }),
    new RegExp(`Choose an account of ${from.name}`),
  );
  await assert.rejects(
    transferFields({ fromBranchId: from.id, toBranchId: to.id, receivedAccount: from.accounts[0] }),
    new RegExp(`Choose an account of ${to.name}`),
  );
  const fields = await transferFields({ fromBranchId: from.id, toBranchId: to.id, paidFromAccount: from.accounts[0], receivedAccount: to.accounts[0] });
  assert.equal(fields.toBranchId, to.id);
});

test("a transfer adds nothing to the totals and reads its receiving branch through the link", () => {
  const row = toRow({ entryType: "Transfer", amount: "2500.00", toBranch: { id: 2, name: "Madurai" } });
  assert.equal(row.signedAmount, 0);
  assert.equal(row.toBranchName, "Madurai");
  assert.equal(toRow({ entryType: "Spent", amount: "100" }).signedAmount, -100);
});
