const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * **Raising money and allowing it are two permissions.**
 *
 * One permission used to do both: `ACCOUNTS / Payment Request` at Read / Write let somebody
 * raise a request *and* approve it, so a holder could ask the studio for money and allow it in two
 * clicks. The row then named one person as who requested it and who decided it, and nothing marked
 * that as unusual.
 *
 * So, now:
 *
 *   * the **requester** may view their own rows and **withdraw** one - nothing else;
 *   * the **approver** (`Payment Request Approver`) may view the queue, **correct** a request and
 *     decide it - and may **not** withdraw, because withdrawing deletes the row while rejecting
 *     records who decided and why.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTROLLER = read("src/modules/hrm/payment-requests/controller.js");
const ROUTES = read("src/modules/hrm/payment-requests/routes.js");
const MIGRATION = read("prisma/migrations/20261104100000_payment_request_approver_permission/migration.sql");
const ACTIONS = read("../frontend/src/components/accounts/usePaymentRequestActions.js");

test("deciding answers to the approver's own permission, and the guard is above the raiser's", () => {
  assert.match(CONTROLLER, /const canDecide = \(user\) => iamService\.hasPermission\(user\?\.id, "ACCOUNTS", "Payment Request Approver", "READ_WRITE"\);/);
  const decides = ROUTES.indexOf('const decides = checkPermission("ACCOUNTS", "Payment Request Approver", "READ_WRITE")');
  const raiser = ROUTES.indexOf('requireModule("ACCOUNTS", "Payment Request")');
  assert.ok(decides > 0 && raiser > 0);
  /*
   * Above it, or an approver would need the raiser's Read / Write as well - `requireModule` asks that
   * of every non-GET - which is exactly the pairing the two permissions exist to separate.
   */
  assert.ok(decides < raiser, "the decision routes are mounted above the router-wide guard");
  for (const route of ['router.post("/:id/approve", decides,', 'router.post("/:id/reject", decides,', 'router.patch("/:id", decides,']) {
    assert.ok(ROUTES.includes(route), route);
  }
});

test("withdrawing is the requester's alone - not an approver's, not a Super Admin's", () => {
  assert.match(CONTROLLER, /if \(!ownedBy\(request, req\.user\)\) throw forbidden\("Only the person who raised a request can withdraw it\./);
  // It answers to the raiser's permission, so it stays under the router-wide guard.
  const withdraw = ROUTES.indexOf('router.delete("/:id", controller.withdrawRequest)');
  assert.ok(withdraw > ROUTES.indexOf('requireModule("ACCOUNTS", "Payment Request")'));
  // And the old rule - "yours, or anybody who could have decided it" - is gone from both verbs.
  assert.doesNotMatch(CONTROLLER, /You can only withdraw a request you raised/);
  assert.doesNotMatch(CONTROLLER, /!ownsIt && !\(await canDecide/);
});

test("correcting a request is the approver's, so the figure cannot change under them", () => {
  assert.match(CONTROLLER, /Only a payment request approver can correct a request\. Withdraw yours and raise the one you meant\./);
  assert.doesNotMatch(CONTROLLER, /You can only edit a request you raised/);
});

test("the row is compared on the employee record, which is what a request stores", () => {
  assert.match(CONTROLLER, /const ownedBy = \(request, user\) => Boolean\(request\?\.requestedById\) && request\.requestedById === Number\(user\?\.linkedEmployeeId\);/);
  // A requester with no employee record behind their login owns nothing, and `-1` matches no row
  // rather than falling through to every row.
  assert.match(CONTROLLER, /return \{ requestedById: employeeId \|\| -1 \};/);
  // The wide view's own narrowing is resolved on the permission that grants it.
  assert.match(CONTROLLER, /feature: "Payment Request Approver", columns: REQUEST_SCOPE_COLUMNS/);
});

test("the screen offers each action to the one who holds it, and Withdraw only on your own row", () => {
  assert.match(ACTIONS, /if \(canDecide && pending\) \{\n\s*list\.push\(\{ label: "Approve"/);
  assert.match(ACTIONS, /if \(canDecide && pending\) list\.push\(\{ label: "Edit"/);
  assert.match(ACTIONS, /if \(canWrite && pending && mine\(request\)\) list\.push\(\{ label: "Withdraw"/);
  // Approve no longer asks for the raiser's permission beside the approver's.
  assert.doesNotMatch(ACTIONS, /canWrite && canDecide/);
  assert.match(ACTIONS, /const mine = useCallback\(\(request\) => Boolean\(myEmployeeId\) && Number\(request\?\.requestedById\) === Number\(myEmployeeId\)/);
});

test("the permission ships in a migration, to Super Admin alone, and says what else it needs", () => {
  assert.match(MIGRATION, /INSERT INTO `permission`[\s\S]*'Payment Request Approver'/);
  assert.match(MIGRATION, /WHERE NOT EXISTS \(\n\s*SELECT 1 FROM `permission` AS `existing`/);
  assert.match(MIGRATION, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(MIGRATION, /`role`\.`name` IN|'BRANCH_ADMIN'/, "no other role is granted it");
  // A route names one permission, so an approver needs the screen's as well - said where it is read.
  assert.match(MIGRATION, /Also needs ACCOUNTS \/ Payment Request Read/);
  const catalogue = require("../prisma/seeds/permission-catalogue");
  const rows = catalogue.PERMISSIONS || catalogue;
  assert.ok(rows.some((row) => row.module === "ACCOUNTS" && row.feature === "Payment Request Approver"));
  // The older one is still there: every grant the studio has already made keeps meaning what it did.
  assert.ok(rows.some((row) => row.module === "ACCOUNTS" && row.feature === "Payment Request"));
});
