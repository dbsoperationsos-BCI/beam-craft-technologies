const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTROLLER = read("src/modules/hrm/payment-requests/controller.js");
const ROUTES = read("src/modules/hrm/payment-requests/routes.js");

const fn = (name) => {
  const start = CONTROLLER.indexOf(`async function ${name}(req, res) {`);
  assert.notEqual(start, -1, `${name} exists`);
  return CONTROLLER.slice(start, CONTROLLER.indexOf("\n}\n", start));
};

/*
 * Approving a request and paying it were one step, and the step did two jobs: it recorded a decision
 * and it moved money. So the approver had the cash book's fields in front of them, a request reached
 * Accounts Manager only once it had already been paid, and nobody could authorise a spend without
 * also releasing it.
 *
 * They are two steps now. Approve, on the Payment Requests screen, writes the decision and nothing
 * else. Pay, from Accounts Manager → Pending, writes the cash entries and - for a salary advance -
 * the payroll row that recovers it.
 */

test("approving writes the decision and not a rupee", () => {
  const approve = fn("approveRequest");
  assert.match(approve, /status: "APPROVED"/);
  // Nothing of the money's: no entries, no payroll row, no proof upload, no transaction.
  for (const forbidden of ["recordCashEntry", "recordSalaryAdvance", "attachProof", "$transaction", "filingsFor"]) {
    assert.doesNotMatch(approve, new RegExp(forbidden.replace(/[$]/g, "\\$")), `approving no longer calls ${forbidden}`);
  }
  // And it asks for nothing but a remark, so the approver is not shown a payment form.
  assert.match(approve, /const parsed = approvalSchema\.safeParse\(req\.body\);/);
  assert.match(CONTROLLER, /const approvalSchema = z\.object\(\{\s*\n\s*remarks: optionalText\(2000\),\s*\n\}\);/);
});

test("paying is what writes the money, and only on an approved request", () => {
  const pay = fn("payRequest");
  assert.match(pay, /const parsed = paymentSchema\.safeParse\(req\.body\);/);
  assert.match(pay, /if \(request\.status === "PENDING"\) throw badRequest\("This request has not been approved yet\./);
  assert.match(pay, /if \(request\.status !== "APPROVED"\) throw badRequest\(/);
  assert.match(pay, /await recordCashEntry\(\{/);
  assert.match(pay, /await recordSalaryAdvance\(tx, request, actorId, parsed\.data\.entryDate \|\| new Date\(\)\);/);
});

test("a request already paid cannot be paid again", () => {
  const pay = fn("payRequest");
  // Once before the transaction, for the message that names the entries, and once behind the row
  // lock, which is what actually stops two people releasing the same request at the same moment.
  assert.match(pay, /if \(request\.cashEntries\.length\) throw badRequest\(`This request has already been paid/);
  assert.match(pay, /FOR UPDATE`;/);
  assert.match(pay, /if \(already\) throw badRequest\("This request has just been paid by somebody else\."\);/);
  // The status is re-read behind the lock too, rather than trusted from before the transaction.
  assert.match(pay, /if \(locked\?\.status !== "APPROVED"\) throw badRequest\("This request is no longer approved/);
  /*
   * And a salary advance whose entries were deleted - which makes it payable again - is refused with
   * a sentence rather than with the unique constraint on `PayrollAdvance.paymentRequestId`, which
   * would have surfaced as a 500 carrying a Prisma message.
   */
  assert.match(pay, /await tx\.payrollAdvance\.findUnique\(\{ where: \{ paymentRequestId: id \}, select: \{ advanceId: true \} \}\);/);
  assert.match(pay, /throw badRequest\(`This advance is already on the payroll as \$\{recovery\.advanceId\}/);
});

test("the lock has to be the transaction's first statement, and says so", () => {
  /*
   * Under REPEATABLE READ the snapshot is taken by the first non-locking read, and `FOR UPDATE`
   * takes none - so the count that follows sees what the winner committed. A plain read placed above
   * the lock would pin a stale snapshot and bring the double payment back, which is a thing the next
   * person to edit this needs told.
   */
  const pay = fn("payRequest");
  const transaction = pay.slice(pay.indexOf("$transaction"));
  const lock = transaction.indexOf("FOR UPDATE");
  const count = transaction.indexOf("tx.cashEntry.count");
  assert.ok(lock > -1 && count > lock, "the entries are counted behind the lock, not before it");
  assert.match(pay, /\*\*This has to stay the first statement in the transaction\.\*\*/);
});

test("awaiting payment is only ever said of an approved request", () => {
  // A pending one awaits a decision, not a payment, and a rejected one never will be: both read as
  // nothing rather than as a queue they are not in.
  assert.match(CONTROLLER, /\? "Paid"\s*\n\s*: \(request\.status === "APPROVED" \? "Awaiting Payment" : ""\),/);
});

test("paid is read off the cash entries, not stored as a fourth status", () => {
  // A status column would have needed backfilling for every request approved before the split, and
  // would have been a second copy of what the entries already say.
  assert.match(CONTROLLER, /const STATUSES = \["PENDING", "APPROVED", "REJECTED"\];/);
  assert.match(CONTROLLER, /paid: \(request\.cashEntries \|\| \[\]\)\.length > 0,/);
  // A soft-deleted entry is not a payment, on the row and in the filter alike.
  assert.match(CONTROLLER, /cashEntries: \{ where: \{ deletedAt: null \}, orderBy: \{ entryId: "asc" \}/);
  assert.match(CONTROLLER, /paid === "yes" \? \{ some: \{ deletedAt: null \} \} : \{ none: \{ deletedAt: null \} \}/);
});

test("Accounts Manager's queue is askable: approved, unpaid", () => {
  assert.match(CONTROLLER, /paid: z\.enum\(\["yes", "no"\]\)\.optional\(\),/);
  assert.match(CONTROLLER, /const \{ type, status, paid, search \} = parsed\.data;/);
});

test("paying names its own two permissions, above the approver's router-wide guard", () => {
  /*
   * The separation has to work in both directions. `requireModule` asks Read / Write on Payment
   * Request Approval of every non-GET - the approver's level - so a `/pay` mounted under it would
   * have let only an approver pay, and somebody holding the cash book alone would have been locked
   * out of the one thing that is theirs.
   *
   * So it sits above that guard with its own pair: Read on Payment Request, because the
   * queue it is reached from is that permission's list, and Read / Write on Cash Management, because
   * what it writes is cash entries.
   */
  // `checkPermission` joined the import when deciding became its own permission; what this is about
  // is the pair below, and the guard it sits above.
  assert.match(ROUTES, /const \{ checkPermission, checkPermissions, requireModule \} = require\("\.\.\/\.\.\/\.\.\/middleware\/permissionMiddleware"\);/);
  assert.match(ROUTES, /\{ module: "ACCOUNTS", feature: "Payment Request", level: "READ" \},\n\s+\{ module: "ACCOUNTS", feature: "Cash Management", level: "READ_WRITE" \},/);
  const payAt = ROUTES.indexOf('router.post(\n  "/:id/pay"');
  const guardAt = ROUTES.indexOf('router.use(requireModule("ACCOUNTS", "Payment Request"));');
  assert.ok(payAt > -1 && guardAt > -1 && payAt < guardAt, "mounted above the router-wide guard");
  // Still behind authentication, which is mounted first of all.
  assert.ok(ROUTES.indexOf("router.use(protect);") < payAt);
});

test("the approver's remark stays the approver's; the payer's goes on the entry", () => {
  assert.match(fn("approveRequest"), /decisionRemarks: parsed\.data\.remarks \?\? null,/);
  const pay = fn("payRequest");
  assert.doesNotMatch(pay, /decisionRemarks:/, "paying never overwrites what the approver wrote");
  assert.match(pay, /parsed\.data\.remarks,\s*\n\s*\]\.filter\(Boolean\)\.join\(" · "\),/);
});
