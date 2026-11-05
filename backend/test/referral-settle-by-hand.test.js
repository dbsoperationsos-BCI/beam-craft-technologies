const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controller = require("../src/modules/hrm/referrals/controller");

/*
 * Employee Referral → ⋮ → Mark 3rd month paid: the inputs the route refuses before anything is read,
 * and payroll refusing to pay an instalment that was marked paid by hand while it was paying.
 * The reach, once-only and stopped rules run against the database in `referral-scope.test.js`.
 */

const call = async (params, body) => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await controller.updatePayout({ params, body, user: { id: 1 } }, res);
  return res;
};

test("a bad id or a body other than Paid is refused with 400, before anything is read", async () => {
  for (const id of ["abc", "0", "-3"]) assert.equal((await call({ payoutId: id }, { status: "Paid" })).statusCode, 400, id);
  for (const body of [{ status: "Pending" }, { status: "Cancelled" }, {}, { status: "Paid", amount: 1 }, { status: "Paid", paidOn: "not a date" }]) {
    const res = await call({ payoutId: "5" }, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(typeof res.body.message, "string");
  }
});

test("Delete refuses a malformed referral id with 400, before anything is read", async () => {
  for (const id of ["abc", "0", "1.5"]) {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await controller.deleteReferral({ params: { id }, user: { id: 1 } }, res);
    assert.equal(res.statusCode, 400, id);
  }
});

test("paying a payroll month settles every referral instalment its figure carries, or refuses", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/payroll-register/service.js"), "utf8");
  // Both places a month is paid - on its own, and held then paid in a full and final settlement.
  assert.equal((source.match(/if \(await settleReferralBonus\(tx, due\.payoutIds, \{ paidOn, userId, payrollEntryId: (id|held\.id) \}\) !== due\.payoutIds\.length\) throw fail\(409, REFERRAL_SETTLED_UNDERNEATH\);/g) || []).length, 2);
  assert.doesNotMatch(source, /^\s*await settleReferralBonus\(/m, "no settle whose count is ignored");
});
