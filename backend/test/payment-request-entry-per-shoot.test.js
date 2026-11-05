const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { filingsFor, entryGroups, commonProject } = require("../src/modules/hrm/payment-requests/controller");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/*
 * Spend is per shoot, so an approved Payment Request is one Cash Entry per shoot it itemised. It
 * used to be a single entry for the whole total — and because one entry carries one shoot, a
 * request naming two shoots was filed against neither, so that spend reached no shoot's books.
 */

const line = (shootId, projectId, amount) => ({ shootId, projectId, amount });
/** Money out: a row per shoot. Money in: a row per project. */
const spent = (expenses) => entryGroups(expenses, { perShoot: true });
const received = (expenses) => entryGroups(expenses, { perShoot: false });

test("a request itemising two shoots is two rows, each worth what was spent on it", () => {
  const groups = spent([line("s1", "p1", "6000.00"), line("s2", "p1", "4000.00")]);
  assert.deepEqual(groups, [
    { projectId: "p1", shootId: "s1", amount: 6000 },
    { projectId: "p1", shootId: "s2", amount: 4000 },
  ]);
});

test("several lines on one shoot are that shoot's one row, added up", () => {
  const groups = spent([line("s1", "p1", "6000.00"), line("s2", "p1", "4000.00"), line("s1", "p1", "500.50")]);
  assert.equal(groups.length, 2, "two shoots, two rows - not three lines, three rows");
  assert.equal(groups[0].amount, 6500.5);
  assert.equal(groups[0].shootId, "s1", "and in the order the lines were entered");
});

test("a shoot's total is exact to the paisa, not a float that drifts off its lines", () => {
  // Added as floats, 0.10 + 0.20 is 0.30000000000000004, and the row would be a paisa out.
  const groups = spent([line("s1", "p1", "0.10"), line("s1", "p1", "0.20")]);
  assert.equal(groups[0].amount, 0.3);
  assert.equal(spent([line("s1", "p1", "1234567.89"), line("s1", "p1", "0.01")])[0].amount, 1234567.9);
});

test("the lines naming no shoot are one more row, filed against the project the rest of them name", () => {
  const groups = spent([line("s1", "p1", "6000.00"), line(null, null, "120.25"), line(null, null, "80.00")]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[1], { projectId: "p1", shootId: null, amount: 200.25 }, "one General row, worth both lines");
});

test("a General line no longer takes the project away from the lines that name one", () => {
  // The whole request used to be filed against nothing when one courier line sat beside the shoots.
  assert.equal(commonProject([line("s1", "p1", "10.00"), line(null, null, "5.00")]), "p1");
  assert.equal(commonProject([line("s1", "p1", "10.00"), line("s2", "p2", "5.00")]), null, "two projects claim neither");
  assert.equal(commonProject([]), null);
});

test("a request with nothing itemised stays the one entry it always was", () => {
  // A salary advance has no lines to split, so it is one entry for the amount asked for.
  assert.deepEqual(spent([]), []);
  const request = { amount: "15000.00", expenses: [] };
  assert.deepEqual(filingsFor(request, false), [{ projectId: null, shootId: null, amount: 15000 }]);
});

test("money coming back is per project, not per shoot: two shoots of one project are one row", () => {
  // An excess settling against one project: the lines name two shoots, the receipt names the project.
  const request = { amount: "10000.00", expenses: [line("s1", "p1", "6000.00"), line("s2", "p1", "4000.00")] };
  assert.deepEqual(filingsFor(request, true), [{ projectId: "p1", shootId: null, amount: 10000 }]);
  assert.equal(filingsFor(request, false).length, 2, "the same request paid out is two rows, one per shoot");
});

test("an excess returning money for two projects is a row per project", () => {
  // It used to be one entry naming neither project, so the money came back to nobody's books.
  const expenses = [line("s1", "p1", "6000.00"), line("s2", "p1", "4000.00"), line("s3", "p2", "1000.00")];
  assert.deepEqual(filingsFor({ amount: "11000.00", expenses }, true), [
    { projectId: "p1", shootId: null, amount: 10000 },
    { projectId: "p2", shootId: null, amount: 1000 },
  ]);
});

test("a returned line naming no project is folded into the one project the rest name", () => {
  const folded = received([line("s1", "p1", "500.00"), line(null, null, "120.00")]);
  assert.deepEqual(folded, [{ projectId: "p1", shootId: null, amount: 620 }], "one row, worth both lines");
  // With two projects there is no single one to fold it into, so it stands on its own.
  const alone = received([line("s1", "p1", "500.00"), line("s2", "p2", "300.00"), line(null, null, "120.00")]);
  assert.deepEqual(alone.map((group) => [group.projectId, group.amount]), [["p1", 500], ["p2", 300], [null, 120]]);
});

test("a spend is refused rather than paid as rows that do not add up to the amount approved", () => {
  // The amount and the lines are written at different moments; approving must not paper over a
  // request whose figure has drifted from the lines underneath it.
  const drifted = { amount: "10000.00", expenses: [line("s1", "p1", "6000.00"), line("s2", "p1", "3999.99")] };
  assert.throws(() => filingsFor(drifted, false), /no longer add up to the amount being approved/);
  const sound = { amount: "9999.99", expenses: drifted.expenses };
  assert.equal(filingsFor(sound, false).length, 2, "and paid when they do add up");
});

test("the rule is the direction's, not the request kind's, so all four kinds follow it", () => {
  /*
   * Every spend is per shoot and every receipt is per project, whichever kind raised it: a vendor's
   * bill, an advance against expenses and a reimbursement are all money out, and an excess is the
   * only money in. The split keys off the direction alone, so a kind added later needs no case here.
   */
  const expenses = [line("s1", "p1", "600.00"), line("s2", "p2", "400.00")];
  for (const type of ["VENDOR_PAYMENT", "ADVANCE_EXPENSE", "EXPENSE_SUBMISSION"]) {
    const rows = filingsFor({ type, amount: "1000.00", expenses }, false);
    assert.deepEqual(rows.map((row) => row.shootId), ["s1", "s2"], `${type} paid out is a row per shoot`);
  }
  const back = filingsFor({ type: "EXPENSE_SUBMISSION", amount: "1000.00", expenses }, true);
  assert.deepEqual(back.map((row) => [row.projectId, row.shootId]), [["p1", null], ["p2", null]], "money in is a row per project");

  const controller = read("src/modules/hrm/payment-requests/controller.js");
  assert.doesNotMatch(controller, /perShoot: [^!]*type/, "the split never reads the request's kind");
});

test("a line naming a shoot but no project leaves the project to be read off the shoot", () => {
  const groups = spent([line("s1", null, "500.00")]);
  assert.deepEqual(groups, [{ projectId: null, shootId: "s1", amount: 500 }]);
});

test("the entry names the request, so every row of a payment is traceable back to it", () => {
  const controller = read("src/modules/hrm/payment-requests/controller.js");
  // One column on the request could name only the first of the rows it wrote.
  assert.doesNotMatch(controller, /cashEntryId: entry\.id/);
  assert.match(controller, /await tx\.cashEntry\.updateMany\(\{ where: \{ id: \{ in: written \} \}, data: \{ paymentRequestId: id \} \}\);/);
  /*
   * The request's row is locked inside the transaction and its entries counted behind the lock, so
   * two people releasing the same request at once cannot each write a full set. `FOR UPDATE` rather
   * than a conditional claim because there is no "paid" column to claim - the entries are the fact,
   * and they live in another table.
   */
  assert.match(controller, /await tx\.\$queryRaw`SELECT id FROM payment_request WHERE id = \$\{id\} FOR UPDATE`;/);
  assert.match(controller, /const already = await tx\.cashEntry\.count\(\{ where: \{ paymentRequestId: id, deletedAt: null \} \}\);/);
  assert.match(controller, /if \(already\) throw badRequest\("This request has just been paid by somebody else\."\);/);
  // One payment, one upload: the proof is stored once and attached to every row.
  assert.match(controller, /const \{ proof, uploads \} = await attachProof\(parsed\.data\.paymentProof, null, actorId\);/);
  assert.match(controller, /\}, actorId, tx, \{ proof \}\);/);
  assert.match(read("src/modules/accounts/cash-entries/controller.js"), /const \{ proof, uploads \} = stored === undefined\n\s+\? await attachProof\(parsed\.data\.paymentProof, null, actorId\)\n\s+: \{ proof: stored, uploads: \[\] \};/);
  assert.match(controller, /cashEntryCode: \(request\.cashEntries \|\| \[\]\)\.map\(\(entry\) => entry\.entryId\)\.join\(", "\)/);

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /paymentRequestId {2}Int\? {13}@map\("payment_request_id"\)/, "the link sits on the entry");
  assert.match(schema, /cashEntries CashEntry\[\]/);
  assert.doesNotMatch(schema, /@map\("cash_entry_id"\)/, "and no longer on the request");
});

test("the migration backfills before it keys, and drops the old link last", () => {
  const sql = read("prisma/migrations/20261102120000_payment_request_cash_entries_per_shoot/migration.sql");
  const at = (needle) => sql.indexOf(needle);
  assert.ok(at("ADD COLUMN `payment_request_id`") < at("UPDATE `cash_entry`"), "the column exists before it is filled");
  assert.ok(at("UPDATE `cash_entry`") < at("ADD CONSTRAINT `cash_entry_payment_request_id_fkey`"), "filled before the key, so the key cannot fail on data already there");
  assert.ok(at("DROP FOREIGN KEY `payment_request_cash_entry_id_fkey`") < at("DROP INDEX `payment_request_cash_entry_id_idx`"), "MySQL refuses to drop an index a key still uses");
  assert.ok(at("DROP INDEX `payment_request_cash_entry_id_idx`") < at("DROP COLUMN `cash_entry_id`"));
  assert.match(sql, /MIN\(`id`\) AS `request_id`/, "two requests naming one entry resolve to the earliest, not to whichever row was reached last");
});
