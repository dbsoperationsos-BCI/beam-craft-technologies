import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { INSTALMENT_INTERVAL_MONTHS, MAX_INSTALMENTS, PAYOUT_STATUSES, STOPPED, instalmentLabel, isOverdue, monthsForCount, outstandingTotal, previewSplit, readInstalmentCount, referralStatus } from "../src/components/hrm/referralPayouts.js";

/*
 * The referral register's arithmetic and wording.
 *
 * Everything here is about money the studio owes somebody: an instalment counted into the wrong
 * total, or drawn as still due after it was paid, is a figure a person acts on. That is the whole
 * reason this is a module beside the panel rather than four expressions inside it.
 */

const payout = (over = {}) => ({ id: 1, monthOffset: 3, dueOn: "2026-04-15T00:00:00.000Z", amount: 3000, status: "Pending", paidOn: null, ...over });
const referral = (...payouts) => ({ id: 1, payouts });

test("the statuses match the ones the backend stores", () => {
  assert.deepEqual(PAYOUT_STATUSES, ["Pending", "Paid", "Cancelled"]);
});

/*
 * The ordinal was "3rd, or else th", which is right for the two months the studio pays at today and
 * wrong for almost any month added to that list later.
 */
test("an instalment is named by a real ordinal, not by the two the studio happens to use", () => {
  assert.equal(instalmentLabel(3), "3rd month");
  assert.equal(instalmentLabel(6), "6th month");
  assert.equal(instalmentLabel(1), "1st month");
  assert.equal(instalmentLabel(2), "2nd month");
  assert.equal(instalmentLabel(21), "21st month");
  assert.equal(instalmentLabel(22), "22nd month");
});

test("the eleven-to-thirteen exception is handled, where the last digit alone gets it wrong", () => {
  assert.equal(instalmentLabel(11), "11th month");
  assert.equal(instalmentLabel(12), "12th month");
  assert.equal(instalmentLabel(13), "13th month");
});

test("a month offset that is not a number reads as a dash rather than as NaN", () => {
  assert.equal(instalmentLabel(undefined), "—");
  assert.equal(instalmentLabel(null), "—");
  assert.equal(instalmentLabel("later"), "—");
});

/*
 * Overdue is the one thing on the panel that draws in red, so being wrong about it either nags
 * about money already handed over or stays silent about money that is late.
 */
test("only a pending instalment past its date is overdue", () => {
  const now = new Date("2026-05-01T00:00:00.000Z");
  assert.equal(isOverdue(payout(), now), true);
  assert.equal(isOverdue(payout({ dueOn: "2026-06-15T00:00:00.000Z" }), now), false, "not yet due");
});

test("an instalment already settled is never overdue, however long ago its date was", () => {
  const now = new Date("2027-01-01T00:00:00.000Z");
  assert.equal(isOverdue(payout({ status: "Paid", paidOn: "2026-04-20T00:00:00.000Z" }), now), false);
  assert.equal(isOverdue(payout({ status: "Cancelled" }), now), false);
});

test("the due date itself is not yet overdue, and a missing or unreadable one never is", () => {
  const due = new Date("2026-04-15T00:00:00.000Z");
  assert.equal(isOverdue(payout(), due), false, "on the date it is due, not late");
  assert.equal(isOverdue(payout({ dueOn: null }), new Date("2030-01-01")), false);
  assert.equal(isOverdue(payout({ dueOn: "not a date" }), new Date("2030-01-01")), false);
  assert.equal(isOverdue(null, new Date()), false);
});

/*
 * The outstanding total is the number somebody might budget against, so it counts what is still
 * owed and nothing else.
 */
test("outstanding counts pending instalments only", () => {
  const rows = [
    referral(payout({ id: 1, amount: 3000 }), payout({ id: 2, monthOffset: 6, amount: 3000, status: "Paid" })),
    referral(payout({ id: 3, amount: 2500 }), payout({ id: 4, monthOffset: 6, amount: 2500, status: "Cancelled" })),
  ];
  // 3000 still owed on the first, 2500 on the second; the paid and cancelled halves are not owed.
  assert.equal(outstandingTotal(rows), 5500);
});

test("a referral with nothing pending contributes nothing, and an empty register is zero", () => {
  assert.equal(outstandingTotal([referral(payout({ status: "Paid" }), payout({ status: "Cancelled" }))]), 0);
  assert.equal(outstandingTotal([]), 0);
  assert.equal(outstandingTotal(null), 0);
  assert.equal(outstandingTotal(undefined), 0);
});

test("a missing or unreadable amount counts as nothing rather than poisoning the total", () => {
  // One bad row must not turn the whole figure into NaN, which would render as "₹NaN".
  const rows = [referral(payout({ amount: null }), payout({ id: 2, amount: "oops" }), payout({ id: 3, amount: 1200 }))];
  assert.equal(outstandingTotal(rows), 1200);
  assert.equal(outstandingTotal([{ id: 9 }]), 0, "a referral with no payouts array at all");
});

test("decimal amounts add up as money, not as rounded figures", () => {
  // An odd referral amount halves into paise; the register must not lose them.
  assert.equal(outstandingTotal([referral(payout({ amount: 2500.5 }), payout({ id: 2, amount: 2500.5 }))]), 5001);
});

test("the register's ⋮ marks an instalment paid outside payroll again, for Read / Write only", async () => {
  /*
   * Brought back after it was taken out on 25 Oct 2026: the studio settles some instalments by hand
   * (cash, a transfer). Payroll carries only what is still Pending, so one marked paid here is never
   * paid there too; the server refuses a second settle and a stopped one.
   */
  const page = fs.readFileSync(new URL("../src/components/hrm/EmployeeReferralsPage.js", import.meta.url), "utf8");
  assert.match(page, /const \{ canWrite \} = useRouteAccess\(\);/);
  assert.match(page, /\{ id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false \}/);
  // Absent without Read / Write, not present and refusing.
  assert.match(page, /\.filter\(\(column\) => column\.id !== "actions" \|\| canWrite\), \[canWrite, monthsKey, rowActionItems\]\);/);
  assert.match(page, /const settleable = \(referral\.payouts \|\| \[\]\)\.filter\(isSettleable\);/);
  assert.match(page, /label: `Mark \$\{instalmentLabel\(payout\.monthOffset\)\} paid`/);
  assert.match(page, /await updateReferralPayout\(paying\.payout\.id, \{ status: "Paid", paidOn: new Date\(\)\.toISOString\(\) \}\);/);
  assert.match(page, /title="Mark this instalment paid\?"/);
  assert.match(page, /paid outside payroll\. Payroll will not pay it again\./);
  assert.match(fs.readFileSync(new URL("../src/services/hrm/referrals.service.js", import.meta.url), "utf8"), /apiRequest\(`\/api\/hrm\/referrals\/payouts\/\$\{payoutId\}`, \{ method: "PATCH",/);

  const { isSettleable } = await import("../src/components/hrm/referralPayouts.js");
  assert.equal(isSettleable({ status: "Pending" }), true);
  for (const status of ["Paid", "Cancelled", "Stopped"]) assert.equal(isSettleable({ status }), false, status);
});

test("the cell says which of the two left, and a half-paid referral is not settled", () => {
  const page = fs.readFileSync(new URL("../src/components/hrm/EmployeeReferralsPage.js", import.meta.url), "utf8");
  // Either person leaving stops the instalments; the cell names which, since the two mean different
  // things - the hire the bonus was for, or the referrer it was owed to.
  assert.match(page, /REFERRED_LEFT: "employee left"/);
  assert.match(page, /REFERRER_LEFT: "referrer left"/);
  assert.match(page, /BOTH_LEFT: "both left"/);
  assert.match(page, /stopped · \$\{STOPPED_BECAUSE\[referral\?\.stoppedReason\] \|\| "employee left"\}/);
  // And while both are still here, one instalment paid is still Outstanding - the Settled tab reads
  // this one word, so a referral must not reach it until the last instalment is handed over.
  assert.equal(referralStatus(referral(payout({ status: "Paid" }), payout({ id: 2, dueOn: "2099-01-01" }))), "Outstanding");
});

test("an instalment stopped by the employee leaving is nothing to chase", () => {
  // Not outstanding, not overdue however old, and it settles the referral on what was paid.
  assert.equal(STOPPED, "Stopped");
  assert.equal(outstandingTotal([referral(payout({ status: STOPPED }))]), 0);
  assert.equal(isOverdue(payout({ status: STOPPED, dueOn: "2020-01-01" })), false);
  assert.equal(referralStatus(referral(payout({ status: "Paid" }), payout({ id: 2, status: STOPPED }))), "Paid");
  // Nothing paid and nothing to come is not a row the register shows at all - the server leaves it
  // out (`applyLeavers`) - but if one ever arrives it reads as settled rather than as owed.
  assert.equal(referralStatus(referral(payout({ status: STOPPED }))), "Cancelled");
});

/*
 * The one word the register puts against a whole referral. Two instalments, one status: what a
 * reader has to act on wins, which is why anything late outranks anything merely owed.
 */

test("a referral with an instalment past its date reads as Overdue", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  assert.equal(referralStatus(referral(payout({ dueOn: "2026-05-01T00:00:00.000Z" }), payout({ monthOffset: 6, dueOn: "2026-08-01T00:00:00.000Z" })), now), "Overdue");
});

test("a referral with something still owed but nothing late reads as Outstanding", () => {
  const now = new Date("2026-04-01T00:00:00.000Z");
  assert.equal(referralStatus(referral(payout({ status: "Paid", paidOn: "2026-03-01T00:00:00.000Z" }), payout({ monthOffset: 6, dueOn: "2026-08-01T00:00:00.000Z" })), now), "Outstanding");
});

test("a referral with both instalments handed over reads as Paid", () => {
  assert.equal(referralStatus(referral(payout({ status: "Paid" }), payout({ monthOffset: 6, status: "Paid" })))
    , "Paid");
});

test("a referral called off entirely reads as Cancelled, and one half-paid still reads as Paid", () => {
  assert.equal(referralStatus(referral(payout({ status: "Cancelled" }), payout({ monthOffset: 6, status: "Cancelled" }))), "Cancelled");
  assert.equal(referralStatus(referral(payout({ status: "Paid" }), payout({ monthOffset: 6, status: "Cancelled" }))), "Paid");
});

test("a referral with no instalments at all is not called settled", () => {
  // Nothing has been handed over, and reading that as Paid would drop a promise off the register.
  assert.equal(referralStatus(referral()), "Outstanding");
});

/* --------------------------------------- the schedule the studio sets, and what it comes to */

/*
 * The Settings section asks for an amount and how many instalments it is paid in, and answers with
 * what falls due in each of them. Both halves are here rather than in the panel so the arithmetic can
 * be checked without rendering a form - and because these are the figures that reach somebody's pay.
 *
 * `readInstalmentCount` mirrors the function of the same name in the referrals service, which is the
 * copy that decides; `previewSplit` mirrors `splitReferralAmount`. A drift between either pair is a
 * form that previews one thing and saves another, so the cases below are deliberately the same ones
 * the backend test pins.
 */

test("a count becomes one instalment every three months, starting at the third", () => {
  assert.equal(INSTALMENT_INTERVAL_MONTHS, 3);
  assert.deepEqual(monthsForCount(1), [3]);
  assert.deepEqual(monthsForCount(2), [3, 6], "the pair the register was built on");
  assert.deepEqual(monthsForCount(3), [3, 6, 9]);
  assert.deepEqual(monthsForCount(0), []);
  assert.deepEqual(monthsForCount(2.5), []);
});

test("a count nobody could be paid on says so while it is still being typed", () => {
  assert.deepEqual(readInstalmentCount("2").months, [3, 6]);
  assert.equal(readInstalmentCount("2").count, 2);
  assert.equal(readInstalmentCount("2").error, null);
  assert.match(readInstalmentCount("").error, /how many instalments/);
  assert.match(readInstalmentCount("0").error, /whole number/);
  assert.match(readInstalmentCount("2.5").error, /whole number/);
  assert.match(readInstalmentCount(String(MAX_INSTALMENTS + 1)).error, /at most 24/);
  assert.equal(readInstalmentCount(String(MAX_INSTALMENTS)).error, null);
});

test("the amount divides equally across however many instalments are set", () => {
  const split = (amount, months) => previewSplit(amount, months).map((part) => part.amount);
  assert.deepEqual(split(6000, [3, 6]), [3000, 3000]);
  assert.deepEqual(split(6000, monthsForCount(3)), [2000, 2000, 2000]);
  assert.deepEqual(split(6000, [3]), [6000]);
  assert.deepEqual(split(1000, monthsForCount(3)), [333.33, 333.33, 333.34], "the remainder lands on the last");
  assert.deepEqual(previewSplit(6000, monthsForCount(0)), [], "no instalments is no split, not a division by zero");
});

test("the parts always add back up to what the referrer was promised", () => {
  // The one property that matters: a preview that does not sum to the amount is a figure somebody
  // budgets against and a referrer who is short.
  for (const months of [monthsForCount(2), monthsForCount(3), monthsForCount(7)]) {
    for (const amount of [1000, 1000.01, 6000, 5001, 999.99]) {
      const parts = previewSplit(amount, months);
      assert.equal(
        Math.round(parts.reduce((sum, part) => sum + part.amount, 0) * 100),
        Math.round(amount * 100),
        `${amount} over ${months.length} instalments does not add back up`,
      );
    }
  }
});

test("the register has an Instalments column - 1/3 Paid - and a column for every instalment month, the 9th too", async () => {
  const { instalmentProgress, instalmentMonthsOf } = await import("../src/components/hrm/referralPayouts.js");
  const three = { payouts: [{ monthOffset: 3, status: "Paid" }, { monthOffset: 6, status: "Pending" }, { monthOffset: 9, status: "Pending" }] };
  const two = { payouts: [{ monthOffset: 3, status: "Pending" }, { monthOffset: 6, status: "Stopped" }] };
  assert.equal(instalmentProgress(three), "1/3 Paid");
  assert.equal(instalmentProgress(two), "0/2 Paid");
  assert.equal(instalmentProgress({ payouts: [{ status: "Paid" }, { status: "Paid" }] }), "2/2 Paid");
  assert.deepEqual(instalmentMonthsOf([two, three]), [3, 6, 9]);
  assert.deepEqual(instalmentMonthsOf([two]), [3, 6]);
  assert.deepEqual(instalmentMonthsOf([]), [3, 6], "the studio's default before there is anything to read");

  const page = fs.readFileSync(new URL("../src/components/hrm/EmployeeReferralsPage.js", import.meta.url), "utf8");
  assert.match(page, /\{ id: "instalments", label: "Instalments" \},/);
  assert.match(page, /\.\.\.months\.map\(\(month\) => \(\{ id: `instalment\$\{month\}`, label: instalmentLabel\(month\)\.replace\("month", "Month"\), monthOffset: month \}\)\),/);
  assert.doesNotMatch(page, /id: "instalment3"|id: "instalment6"/, "no fixed 3rd and 6th that leave a 9th off");
});

test("a referral is deleted from its ⋮ or by ticking rows, for Read / Write, and never once something on it is paid", async () => {
  const { isDeletable } = await import("../src/components/hrm/referralPayouts.js");
  assert.equal(isDeletable({ payouts: [{ status: "Pending" }, { status: "Stopped" }] }), true);
  assert.equal(isDeletable({ payouts: [{ status: "Paid" }, { status: "Pending" }] }), false);
  const page = fs.readFileSync(new URL("../src/components/hrm/EmployeeReferralsPage.js", import.meta.url), "utf8");
  assert.match(page, /\.\.\.\(deletable \? \[\.\.\.\(settleable\.length \? \[\{ separator: true \}\] : \[\]\), \{ label: "Delete", tone: "danger", onSelect: \(\) => setDeleting\(referral\) \}\] : \[\]\),/);
  // A row with neither gets no ⋮ at all - an empty list, which draws none.
  assert.match(page, /return items\?\.length \? <OptionsMenu/);
  assert.match(page, /title="Delete this referral\?"/);
  assert.match(page, /await deleteReferral\(deleting\.id\);/);
  assert.match(page, /prefix: "\/api\/hrm\/referrals",\n\s+rows: visibleRows,\n\s+noun: "referral",\n\s+canDelete: canWrite,/);
  assert.match(fs.readFileSync(new URL("../src/services/hrm/referrals.service.js", import.meta.url), "utf8"), /apiRequest\(`\/api\/hrm\/referrals\/\$\{id\}`, \{ method: "DELETE" \}\)/);
});
