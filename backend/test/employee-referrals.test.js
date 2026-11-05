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

/* ----------------------------------------------------- paid through payroll, and who is still here */

const { referralBonusDueIn, settleReferralBonus, STOPPED } = require("../src/modules/hrm/referrals/service");

const WORKING = ["Active", "Probation"];
const active = { employmentStatus: "Active", archivedAt: null };
const left = { employmentStatus: "Resigned", archivedAt: null };
const instalment = (overrides = {}) => ({ id: 1, status: "Pending", dueOn: new Date("2026-07-12T00:00:00Z"), amount: 3000, ...overrides });
const madeFor = (referred, payouts) => ({ referralId: "DBS-REF-000001", referred, payouts });

test("a referral instalment reaches payroll in its due month, and only while both are still here", () => {
  /*
   * The bonus is paid as the referrer's Referral Bonus on the month the instalment falls due. Both
   * people have to be working: the referrer because the money is theirs and there is nobody to pay
   * once they have gone, and the hire they introduced because the bonus is for that person staying.
   */
  const referrals = [madeFor(active, [instalment()])];
  const due = referralBonusDueIn(2026, 7, referrals, { referrer: active, working: WORKING });
  assert.deepEqual([due.amount, due.referralIds, due.payoutIds], [3000, ["DBS-REF-000001"], [1]]);
  // Not in any other month, whatever is outstanding.
  assert.equal(referralBonusDueIn(2026, 8, referrals, { referrer: active, working: WORKING }).amount, 0);
  // The referrer has left: nobody to pay.
  assert.equal(referralBonusDueIn(2026, 7, referrals, { referrer: left, working: WORKING }).amount, 0);
  // The hire has left: the bonus was for them staying.
  assert.equal(referralBonusDueIn(2026, 7, [madeFor(left, [instalment()])], { referrer: active, working: WORKING }).amount, 0);
  // An archived employee is never working, whatever their status says.
  assert.equal(referralBonusDueIn(2026, 7, referrals, { referrer: { ...active, archivedAt: new Date() }, working: WORKING }).amount, 0);
  // Already paid, or called off: not due again. This is what stops a corrected month paying twice.
  for (const status of ["Paid", "Cancelled"]) {
    assert.equal(referralBonusDueIn(2026, 7, [madeFor(active, [instalment({ status })])], { referrer: active, working: WORKING }).amount, 0);
  }
  // Two instalments of two referrals in one month add up, and each referral is named once.
  const both = [madeFor(active, [instalment(), instalment({ id: 2, amount: 2000 })])];
  const sum = referralBonusDueIn(2026, 7, both, { referrer: active, working: WORKING });
  assert.deepEqual([sum.amount, sum.referralIds, sum.payoutIds], [5000, ["DBS-REF-000001"], [1, 2]]);
});

test("paying the month records the instalment paid, against the row that paid it", async () => {
  // The register has no Mark paid of its own: money recordable in two places can be handed over
  // twice. The `status: "Pending"` in the where is what makes paying a corrected month harmless, and
  // the row's id is what lets the month find its own instalments again.
  const asked = [];
  const tx = { employeeReferralPayout: { updateMany: async (args) => { asked.push(args); return { count: 1 }; } } };
  const paidOn = new Date("2026-07-31T00:00:00Z");
  assert.equal(await settleReferralBonus(tx, [1, 2], { paidOn, userId: 7, payrollEntryId: 55 }), 1);
  assert.deepEqual(asked[0].where, { id: { in: [1, 2] }, status: "Pending" });
  assert.deepEqual(asked[0].data, { status: "Paid", paidOn, paidByUserId: 7, payrollEntryId: 55 });
  // Nothing due, nothing asked: a month with no referral bonus writes nothing at all.
  assert.equal(await settleReferralBonus(tx, [], {}), 0);
  assert.equal(asked.length, 1);
});

test("a month set back to Pending owes its instalments again - and only the ones it paid", async () => {
  /*
   * The other half. Without it, reopening a paid month left its instalments Paid while the next
   * Refresh recomputed the row's figure from what was still Pending - nothing - so the month lost
   * the bonus it had paid and re-paying it settled nothing: the studio was quietly short.
   */
  const { unsettleReferralBonus } = require("../src/modules/hrm/referrals/service");
  const asked = [];
  const tx = { employeeReferralPayout: { updateMany: async (args) => { asked.push(args); return { count: 2 }; } } };
  assert.equal(await unsettleReferralBonus(tx, 55), 2);
  assert.deepEqual(asked[0].where, { payrollEntryId: 55, status: "Paid" });
  assert.deepEqual(asked[0].data, { status: "Pending", paidOn: null, paidByUserId: null, payrollEntryId: null });
  // No row, nothing asked.
  assert.equal(await unsettleReferralBonus(tx, null), 0);
  assert.equal(asked.length, 1);
});

test("a paid month still knows what it paid, and does not offer to pay it again", () => {
  /*
   * `entryId` is the row asking. An instalment it has already settled still counts towards the
   * figure - so a paid month reads the amount it paid and names its Referral IDs - but it is not
   * among the ids to settle, because paying a month again must not move a date already set.
   */
  const paid = instalment({ status: "Paid", payrollEntryId: 55 });
  const referrals = [madeFor(active, [paid])];
  const mine = referralBonusDueIn(2026, 7, referrals, { referrer: active, working: WORKING, entryId: 55 });
  assert.deepEqual([mine.amount, mine.referralIds, mine.payoutIds], [3000, ["DBS-REF-000001"], []]);
  // Another month's row asking sees nothing: it is not its instalment to count or to settle.
  assert.equal(referralBonusDueIn(2026, 7, referrals, { referrer: active, working: WORKING, entryId: 56 }).amount, 0);
  // And a month being generated, which has no row yet, reads only what is still to pay.
  assert.equal(referralBonusDueIn(2026, 7, referrals, { referrer: active, working: WORKING }).amount, 0);
});

test("Stopped is worked out, never stored", () => {
  // It is not one of the statuses anything may write - the register reads the employee's own status
  // every time instead, so nobody has to remember to write it when somebody is relieved, and
  // somebody who rejoins is simply due again.
  const { PAYOUT_STATUSES } = require("../src/modules/hrm/referrals/service");
  assert.equal(STOPPED, "Stopped");
  assert.ok(!PAYOUT_STATUSES.includes(STOPPED));
});

test("the six cases: who is still here decides whether a referral shows, and where", async () => {
  /*
   * The studio's own list, in its words. A referral is between two people and **either** of them
   * leaving ends the instalments still to come: the hire, because the bonus is for them staying, and
   * the referrer, because the money is theirs and there is nobody to pay once they have gone.
   *
   *   1. both stay the whole way        -> both instalments paid, **Settled**
   *   2. one left before the 1st        -> **off the register**: no payment was ever made
   *   3. one left after the 1st         -> **Settled** on what was paid
   *   4. both left before the 1st       -> off the register
   *   5. both left after the 1st        -> Settled
   *   6. both still here, one paid      -> **Outstanding**: not settled until the last instalment is
   */
  const service = require("../src/modules/hrm/referrals/service");
  const { applyLeavers } = service._internals;
  const { STOPPED_REASONS } = service;
  const paid = { id: 1, monthOffset: 3, dueOn: new Date("2026-07-12T00:00:00Z"), amount: 3000, status: "Paid", paidOn: new Date("2026-07-31T00:00:00Z"), remarks: null };
  const unpaid = { id: 2, monthOffset: 6, dueOn: new Date("2026-10-12T00:00:00Z"), amount: 3000, status: "Pending", paidOn: null, remarks: null };
  const hire = (status) => ({ employmentStatus: status, archivedAt: null, employeeName: "Vikram", employeeId: "DBS-EMP-004" });
  const referral = (referrerStatus, referredStatus, payouts) => ({
    id: 1, referralId: "DBS-REF-000001", referrerEmployeeId: 9, referrerName: "Asha", referredEmployeeId: 4,
    referredOn: new Date("2026-04-12T00:00:00Z"), remarks: null,
    referrer: { employmentStatus: referrerStatus, archivedAt: null }, referred: hire(referredStatus), payouts,
  });
  const shown = (rows) => rows.map((row) => [row.payouts.map((payout) => payout.status), row.total, row.stoppedReason]);

  // 1. Both stayed and both instalments were paid: nothing stopped, and it is settled by being paid.
  assert.deepEqual(shown(applyLeavers([referral("Active", "Active", [paid, { ...unpaid, status: "Paid" }])], WORKING)),
    [[["Paid", "Paid"], 6000, null]]);

  // 2. One left before the first payment, either one: off the register, since nothing was ever paid.
  for (const [referrer, referred] of [["Active", "Resigned"], ["Resigned", "Active"]]) {
    assert.deepEqual(applyLeavers([referral(referrer, referred, [{ ...paid, status: "Pending", paidOn: null }, unpaid])], WORKING), []);
  }

  // 3. One left after the first and before the second: it stays, settled on what was paid, and the
  // screen can say which of the two it was.
  assert.deepEqual(shown(applyLeavers([referral("Active", "Resigned", [paid, unpaid])], WORKING)),
    [[["Paid", STOPPED], 3000, STOPPED_REASONS.REFERRED]]);
  assert.deepEqual(shown(applyLeavers([referral("Resigned", "Active", [paid, unpaid])], WORKING)),
    [[["Paid", STOPPED], 3000, STOPPED_REASONS.REFERRER]]);

  // 4. Both left before the first: off the register.
  assert.deepEqual(applyLeavers([referral("Resigned", "Resigned", [{ ...paid, status: "Pending", paidOn: null }, unpaid])], WORKING), []);

  // 5. Both left after the first: settled, and named as both.
  assert.deepEqual(shown(applyLeavers([referral("Resigned", "Resigned", [paid, unpaid])], WORKING)),
    [[["Paid", STOPPED], 3000, STOPPED_REASONS.BOTH]]);

  // 6. Both still here with one instalment paid: still owed, so it must not read as settled.
  const half = applyLeavers([referral("Active", "Active", [paid, unpaid])], WORKING);
  assert.deepEqual(shown(half), [[["Paid", "Pending"], 6000, null]]);
  // The register's one word for the row, which is what the Settled tab reads (`referralPayouts.js`).
  assert.ok(half[0].payouts.some((payout) => payout.status === "Pending"), "Outstanding, not Settled");

  // A referrer deleted from the repository - only the name kept beside the cleared id - reads as
  // left: there is no employee to pay it to.
  assert.deepEqual(shown(applyLeavers([{ ...referral("Active", "Active", [paid, unpaid]), referrer: null }], WORKING)),
    [[["Paid", STOPPED], 3000, STOPPED_REASONS.REFERRER]]);
});

test("the register's status filter takes only a status something is stored as", () => {
  // `Stopped` is worked out on the way out, so asking the database for it would answer nothing; an
  // unknown word narrows nothing rather than emptying the register.
  const service = require("../src/modules/hrm/referrals/service");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/modules/hrm/referrals/service.js"), "utf8");
  assert.match(source, /const wanted = PAYOUT_STATUSES\.includes\(status\) \? status : "";/);
  assert.match(source, /\.\.\.\(wanted \? \[\{ payouts: \{ some: \{ status: wanted \} \} \}\] : \[\]\)/);
  assert.ok(!service.PAYOUT_STATUSES.includes(service.STOPPED));
});
