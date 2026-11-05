const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addMonths, splitReferralAmount, syncEmployeeReferral,
  DEFAULT_INSTALMENT_MONTHS, MAX_INSTALMENTS, INSTALMENT_INTERVAL_MONTHS,
  monthsForCount, readInstalmentCount, parseInstalmentMonths, validateInstalmentMonths,
} = require("../src/modules/hrm/referrals/service");

/*
 * When a referral instalment falls due.
 *
 * Both dates are counted from the referred employee's joining date, so the arithmetic here decides
 * when the studio parts with money. The case worth holding on to is the month end: `setMonth` on a
 * 31st rolls into the following month, which would put a June instalment on 1 July.
 */

const at = (iso) => addMonths(new Date(iso), 3).toISOString().slice(0, 10);

test("a studio that has set no schedule still pays at the third month and the sixth", () => {
  // The column default and the fallback both, so a settings row written before the column existed
  // still produces a schedule rather than none.
  assert.deepEqual(parseInstalmentMonths(""), [3, 6]);
  assert.deepEqual(parseInstalmentMonths(null), [3, 6]);
  assert.deepEqual(parseInstalmentMonths("nonsense"), [3, 6]);
});

/* ----------------------------------------------------- how many instalments it is paid in */

test("a count becomes one instalment every three months, starting at the third", () => {
  // What the settings form asks for. The spacing has never varied, so the studio answers "how many"
  // and this turns it into the offsets a payout row carries.
  assert.equal(INSTALMENT_INTERVAL_MONTHS, 3);
  assert.deepEqual(monthsForCount(1), [3]);
  assert.deepEqual(monthsForCount(2), [3, 6], "the pair the register was built on");
  assert.deepEqual(monthsForCount(3), [3, 6, 9]);
  assert.deepEqual(monthsForCount(4), [3, 6, 9, 12]);
  assert.deepEqual(monthsForCount(0), []);
  assert.deepEqual(monthsForCount(-1), []);
  assert.deepEqual(monthsForCount(2.5), []);
});

test("two instalments is what a studio that has set nothing still gets", () => {
  assert.deepEqual(DEFAULT_INSTALMENT_MONTHS, [3, 6]);
  assert.deepEqual(monthsForCount(2), DEFAULT_INSTALMENT_MONTHS);
});

test("a count nobody could be paid on is refused, and says why", () => {
  assert.deepEqual(readInstalmentCount(2).months, [3, 6]);
  assert.deepEqual(readInstalmentCount("3").months, [3, 6, 9], "the form sends text");
  assert.equal(readInstalmentCount(2).error, null);
  assert.match(readInstalmentCount("").error, /how many instalments/);
  assert.match(readInstalmentCount("0").error, /whole number/);
  assert.match(readInstalmentCount("-2").error, /whole number/);
  assert.match(readInstalmentCount("2.5").error, /whole number/, "half an instalment has no due date");
  assert.match(readInstalmentCount("abc").error, /whole number/);
  assert.match(readInstalmentCount(MAX_INSTALMENTS + 1).error, /at most 24 instalments/);
  // The furthest instalment a studio may set still lands inside the ten years the months allow.
  assert.equal(readInstalmentCount(MAX_INSTALMENTS).error, null);
  assert.equal(validateInstalmentMonths(monthsForCount(MAX_INSTALMENTS)), null);
});

/* ----------------------------------------------------- the months those instalments fall on */

test("the stored months are read however they were written", () => {
  assert.deepEqual(parseInstalmentMonths("3,6"), [3, 6]);
  assert.deepEqual(parseInstalmentMonths("3, 6, 12"), [3, 6, 12], "spaces are how a person types a list");
  assert.deepEqual(parseInstalmentMonths("3,6,"), [3, 6], "a trailing comma is a half-finished edit, not a month");
  assert.deepEqual(parseInstalmentMonths("6,3"), [3, 6], "due order, not typed order");
  assert.deepEqual(parseInstalmentMonths("3,3,6"), [3, 6], "one instalment per month - the table's unique index says so too");
  assert.deepEqual(parseInstalmentMonths([3, 6, 12]), [3, 6, 12], "a list saves the same as a string");
});

test("a schedule nobody could be paid on is refused, and says why", () => {
  assert.equal(validateInstalmentMonths("3,6"), null);
  assert.equal(validateInstalmentMonths([1]), null, "one instalment is a schedule - the whole amount, once");
  assert.match(validateInstalmentMonths(""), /at least one month/);
  assert.match(validateInstalmentMonths("0"), /not a month/, "month zero is the joining day, not an instalment");
  assert.match(validateInstalmentMonths("-3"), /not a month/);
  assert.match(validateInstalmentMonths("abc"), /not a month/);
  assert.match(validateInstalmentMonths("2.5"), /not a month/, "half a month has no due date");
  assert.match(validateInstalmentMonths("3,999"), /further out than/);
  assert.match(
    validateInstalmentMonths(Array.from({ length: MAX_INSTALMENTS + 1 }, (_, index) => index + 1)),
    /at most 24 instalments/,
  );
});

test("the amount divides equally however many months it is settled over", () => {
  const months = (amount, list) => splitReferralAmount(amount, list).map((part) => part.amount);
  assert.deepEqual(months(6000, [3, 6]), [3000, 3000]);
  assert.deepEqual(months(6000, [3, 6, 12]), [2000, 2000, 2000]);
  assert.deepEqual(months(6000, [3]), [6000], "one instalment is the whole amount");

  // The remainder lands on the last instalment rather than being lost, whatever the count - the
  // parts must add back up to what the referrer was promised.
  assert.deepEqual(months(1000, [3, 6, 12]), [333.33, 333.33, 333.34]);
  assert.deepEqual(months(1000.01, [3, 6]), [500, 500.01]);
  for (const list of [[3, 6], [3, 6, 12], [1, 2, 3, 4, 5, 6, 7]]) {
    const parts = months(1000, list);
    assert.equal(
      Math.round(parts.reduce((sum, part) => sum + part, 0) * 100),
      100000,
      `${list.length} instalments do not add back up to the amount`,
    );
  }
});

test("no months is no instalments, rather than a division by zero", () => {
  // Callers reach the split through `parseInstalmentMonths`, which never produces an empty list -
  // this is the guarantee that makes that safe rather than load-bearing.
  assert.deepEqual(splitReferralAmount(6000, []), []);
});

test("an instalment falls on the same day of the month, three and six months on", () => {
  const joined = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(addMonths(joined, 3).toISOString().slice(0, 10), "2026-04-15");
  assert.equal(addMonths(joined, 6).toISOString().slice(0, 10), "2026-07-15");
});

test("a day the target month does not have is clamped to its last, not rolled into the next", () => {
  // 31 March + 3 months is June, which has 30 days. Rolling would read 1 July - the right amount
  // on the wrong month, which is exactly the kind of thing a payslip is audited on.
  assert.equal(at("2026-03-31T00:00:00.000Z"), "2026-06-30");
  // 31 December + 3 is March, which has 31, so nothing is clamped away.
  assert.equal(at("2026-12-31T00:00:00.000Z"), "2027-03-31");
  // The February case, including a leap year.
  assert.equal(addMonths(new Date("2026-11-30T00:00:00.000Z"), 3).toISOString().slice(0, 10), "2027-02-28");
  assert.equal(addMonths(new Date("2023-11-30T00:00:00.000Z"), 3).toISOString().slice(0, 10), "2024-02-29");
});

test("counting months crosses the year end", () => {
  assert.equal(addMonths(new Date("2026-10-10T00:00:00.000Z"), 6).toISOString().slice(0, 10), "2027-04-10");
});

test("the joining date itself is never modified", () => {
  const joined = new Date("2026-03-31T00:00:00.000Z");
  const before = joined.toISOString();
  addMonths(joined, 3);
  assert.equal(joined.toISOString(), before, "addMonths must not mutate the date it is given");
});

/*
 * One amount, halved.
 *
 * The studio configures what a referral is worth in total - 6,000 - and it is handed over as two
 * equal instalments. The halves are what actually reach somebody's pay, so they have to add back
 * up to the amount configured however awkwardly it divides.
 */

const parts = (amount) => splitReferralAmount(amount).map((instalment) => instalment.amount);

test("an even amount halves cleanly across the two instalments", () => {
  assert.deepEqual(parts(6000), [3000, 3000]);
  assert.deepEqual(parts(10000), [5000, 5000]);
});

test("the halves always add back up to the amount configured", () => {
  for (const amount of [6000, 5001, 1000.01, 999.99, 7, 0.01]) {
    const [first, second] = parts(amount);
    assert.equal(Math.round((first + second) * 100), Math.round(amount * 100), `${amount} did not split evenly`);
  }
});

test("an amount that will not halve to the paisa puts the remainder on the last instalment", () => {
  // 1,000.01 cannot be two equal halves. Rounding both up would pay out a paisa the studio never
  // agreed to; rounding both down would short the referrer by one.
  assert.deepEqual(parts(1000.01), [500, 500.01]);
});

test("nothing configured pays nothing, rather than NaN", () => {
  assert.deepEqual(parts(0), [0, 0]);
  assert.deepEqual(parts(null), [0, 0]);
  assert.deepEqual(parts(undefined), [0, 0]);
});

/*
 * Taking a referral back off the register.
 *
 * A referral is not a field of its own: it *is* the Referred By answered on the employee, and the
 * register reads the row this writes. So emptying that field has to remove the row, or somebody
 * added by mistake stays owed money on a screen nobody can correct - which is exactly what happened
 * while the picker had no way back to no answer at all (`withClearOption` in the browser).
 *
 * The service takes its Prisma client as an argument, because it runs inside the transaction that
 * saves the employee. That is what lets these stand one up rather than reach for a database.
 */
function clientHolding(existing) {
  const calls = { deleted: [] };
  return [{
    employeeReferral: {
      findUnique: async () => existing,
      delete: async (args) => { calls.deleted.push(args.where.id); return existing; },
    },
  }, calls];
}

test("clearing who referred an employee removes the referral from the register", async () => {
  const [client, calls] = clientHolding({ id: 7, referralId: "DBS-REF-000007", payouts: [{ status: "Pending" }, { status: "Pending" }] });
  assert.equal(await syncEmployeeReferral(client, 41, { referrerEmployeeId: null }), null);
  assert.deepEqual(calls.deleted, [7], "the referral row outlived the answer that recorded it");
});

// An empty field on somebody who was never referred is the ordinary case - every hire who came in
// without a referral is saved this way - and it must not go looking for a row to delete.
test("an employee who was never referred is saved without a referral being touched", async () => {
  const [client, calls] = clientHolding(null);
  assert.equal(await syncEmployeeReferral(client, 41, { referrerEmployeeId: null }), null);
  assert.deepEqual(calls.deleted, []);
});

// Money that has actually changed hands is a fact about the studio's cash, not a field somebody may
// clear by emptying a dropdown. The refusal is a 409 so the form can say why rather than fail.
test("a referral with an instalment already paid refuses to be removed", async () => {
  const [client, calls] = clientHolding({ id: 7, payouts: [{ status: "Paid" }, { status: "Pending" }] });
  await assert.rejects(
    () => syncEmployeeReferral(client, 41, { referrerEmployeeId: null }),
    (error) => error.status === 409 && /already been paid/.test(error.message),
  );
  assert.deepEqual(calls.deleted, []);
});
