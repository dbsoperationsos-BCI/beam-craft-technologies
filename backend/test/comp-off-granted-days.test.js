const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const credits = require("../src/modules/hrm/attendance/compOffCredits");

/*
 * **A comp-off is granted as an amount, not as a yes.**
 *
 * A day worked on a weekly off or holiday earned exactly one day off, and approving it was yes or no.
 * The studio wants half a day for a short day worked, and one answer for a run worked back to back:
 * Saturday, Sunday and a holiday together are one question - "how much was that worth" - not three.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("the choices run from nothing to the days actually worked, in halves", () => {
  assert.deepEqual(credits.grantChoices({ workedDate: day("2026-11-01"), workedToDate: day("2026-11-03") }), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  // A single day is still a choice of three, which is what "half a day for a short day" needs.
  assert.deepEqual(credits.grantChoices({ workedDate: day("2026-11-01") }), [0, 0.5, 1]);
  assert.deepEqual(credits.grantChoices({}), [0]);
});

test("a run is counted inclusively, both ends", () => {
  assert.equal(credits.workedDaysIn({ workedDate: day("2026-11-01"), workedToDate: day("2026-11-03") }), 3);
  assert.equal(credits.workedDaysIn({ workedDate: day("2026-11-01"), workedToDate: day("2026-11-01") }), 1);
  // No end date is a run of one - which is every credit raised before runs existed.
  assert.equal(credits.workedDaysIn({ workedDate: day("2026-11-01") }), 1);
});

test("the request takes the lowest amount any approver granted", () => {
  /*
   * All of them still have to approve - the unanimous decision a leave goes through. The amount is
   * the lowest so that an approver who thinks a run was worth less says so with a number, instead of
   * refusing the whole ask and leaving nobody able to tell a disagreement from a refusal.
   */
  const approved = (amount) => ({ decision: "APPROVED", grantedDays: amount });
  assert.equal(credits.grantedFrom([approved(3), approved(2), approved(2.5)], 3), 2);
  // Zero is a refusal with a number on it, and it wins like any other lowest.
  assert.equal(credits.grantedFrom([approved(0), approved(2)], 3), 0);
  // Nobody has answered yet: nothing is granted, which is not the same as granting zero.
  assert.equal(credits.grantedFrom([{ decision: "PENDING", grantedDays: 1 }], 2), null);
  assert.equal(credits.grantedFrom([], 2), null);
  // A rejection carries no amount into the sum.
  assert.equal(credits.grantedFrom([approved(2), { decision: "REJECTED", grantedDays: 3 }], 3), 2);
});

test("nobody can grant more than was worked, or a figure off the list", () => {
  // Whatever is typed or posted, the days worked are the ceiling.
  assert.equal(credits.grantedFrom([{ decision: "APPROVED", grantedDays: 9 }], 2), 2);
  /*
   * Rounded **down** to the half step. A grant is something somebody picked from a list, so a stray
   * 1.3 arriving from anywhere must not quietly become 1.5 in the employee's favour.
   */
  assert.equal(credits.grantedFrom([{ decision: "APPROVED", grantedDays: 1.3 }], 3), 1);
  assert.equal(credits.grantedFrom([{ decision: "APPROVED", grantedDays: 1.9 }], 3), 1.5);
  assert.equal(credits.grantedFrom([{ decision: "APPROVED", grantedDays: -4 }], 3), null, "a negative is not an amount at all");
});

test("a credit approved before amounts existed is read as the whole run", () => {
  // Raised under the old rule and answered after this shipped: approving it meant the whole thing,
  // which is what those days were earned under.
  assert.equal(credits.grantedFrom([{ decision: "APPROVED", grantedDays: null }], 2), 2);
  assert.equal(credits.grantedFrom([{ decision: "APPROVED" }], 1), 1);
});

test("the columns are nullable or defaulted, so nothing already written changes", () => {
  const migration = read("prisma/migrations/20261104140000_comp_off_granted_days/migration.sql");
  assert.match(migration, /ADD COLUMN `worked_to_date` DATE NULL/);
  assert.match(migration, /ADD COLUMN `granted_days` DECIMAL\(4, 1\) NULL/);
  // The ledger defaults to 1.0 - what every row in it earned under the old rule.
  assert.match(migration, /ADD COLUMN `earned_days` DECIMAL\(4, 1\) NOT NULL DEFAULT 1\.0/);
  // The second half day a claim spends, so two halves can buy one day off between them.
  assert.match(migration, /ADD COLUMN `worked_pair_date` DATE NULL/);
  assert.doesNotMatch(migration, /UPDATE `comp_off_ledger`|UPDATE `attendance_request`/);
});

/*
 * **A day off costs one whole day, so two halves buy one together.**
 *
 * There is no half day off to take. A worked day granted half a day is therefore not claimable on its
 * own, and the alternative - letting it be claimed anyway - is what shipped the bug this fixes: two
 * days granted half a day each were offered as two whole days off.
 */

test("a run's grant is shared out in half days from the earliest day, never in quarters", async () => {
  // 1.5 over three days is a day, a half and nothing - not 0.75 three times, which no pair could
  // ever spend. The earliest day carries it, because that is the day whose credit lapses first.
  const earned = await credits.earnedDaysByDate(7, { attendanceRequest: { findMany: async () => [
    { workedDate: day("2026-11-07"), workedToDate: day("2026-11-09"), grantedDays: 1.5 },
  ] } });
  assert.deepEqual([...earned], [["2026-11-07", 1], ["2026-11-08", 0.5], ["2026-11-09", 0]]);
  // Every amount is a multiple of a half, whatever the run and whatever was granted.
  for (const granted of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
    const spread = await credits.earnedDaysByDate(7, { attendanceRequest: { findMany: async () => [
      { workedDate: day("2026-11-07"), workedToDate: day("2026-11-09"), grantedDays: granted },
    ] } });
    for (const share of spread.values()) assert.equal(share % 0.5, 0, `${granted} over three days left ${share}`);
    assert.equal([...spread.values()].reduce((sum, share) => sum + share, 0), granted, "and the run still adds up to what was granted");
  }
});

test("a whole day is claimable on its own; two halves are claimable together", () => {
  const settings = { compOffExpiryDays: 30 };
  const row = (date, earnedDays, status = "AVAILABLE") => ({ workedDate: date, earnedDays, status });
  const { units, pendingHalf } = credits.claimableUnits([
    row("2026-11-01", 0.5),
    row("2026-11-02", 0.5),
    row("2026-11-08", 1),
  ], settings);
  assert.deepEqual(units.map((unit) => unit.dates), [["2026-11-01", "2026-11-02"], ["2026-11-08"]]);
  // Every unit is one day off, however many days worked paid for it.
  for (const unit of units) assert.equal(unit.earnedDays, 1);
  // The pair expires on the **earlier** half's clock: it cannot outlive the credit that runs out first.
  assert.equal(units[0].expiresOn, "2026-12-01");
  assert.equal(pendingHalf, null);
});

test("the odd half is not claimable, and is not silently dropped either", () => {
  const settings = { compOffExpiryDays: 30 };
  const { units, pendingHalf } = credits.claimableUnits([
    { workedDate: "2026-11-01", earnedDays: 0.5, status: "AVAILABLE" },
  ], settings);
  // Half a day buys nothing on its own - which is the bug this fixes, where it bought a whole day.
  assert.deepEqual(units, []);
  // But it is reported, so half a day granted never reads to the employee as nothing granted.
  assert.deepEqual(pendingHalf, { date: "2026-11-01", earnedDays: 0.5, expiresOn: "2026-12-01" });
});

test("halves are paired oldest first, so the one closest to expiring is spent next", () => {
  const settings = { compOffExpiryDays: 30 };
  const rows = [
    { workedDate: "2026-11-15", earnedDays: 0.5, status: "AVAILABLE" },
    { workedDate: "2026-11-01", earnedDays: 0.5, status: "AVAILABLE" },
    { workedDate: "2026-11-08", earnedDays: 0.5, status: "AVAILABLE" },
  ];
  const { units, pendingHalf } = credits.claimableUnits(rows, settings);
  // Whatever order they arrive in: the two oldest pair, and the newest waits.
  assert.deepEqual(units.map((unit) => unit.dates), [["2026-11-01", "2026-11-08"]]);
  assert.equal(pendingHalf.date, "2026-11-15");
});

test("a day granted nothing, and a day already spent, are not on offer", () => {
  const settings = {};
  const { units, pendingHalf } = credits.claimableUnits([
    // Approved but granted 0: looked at and worth nothing, so there is nothing to claim and nothing
    // waiting for a partner either.
    { workedDate: "2026-11-01", earnedDays: 0, status: "AVAILABLE" },
    // Already claimed, taken or lapsed: spent, whatever it earned.
    { workedDate: "2026-11-02", earnedDays: 1, status: "CLAIMED" },
    { workedDate: "2026-11-03", earnedDays: 1, status: "USED" },
    { workedDate: "2026-11-04", earnedDays: 0.5, status: "EXPIRED" },
  ], settings);
  assert.deepEqual(units, []);
  assert.equal(pendingHalf, null);
});

test("only the days that make a unit between them may be claimed", () => {
  const settings = {};
  const { units } = credits.claimableUnits([
    { workedDate: "2026-11-01", earnedDays: 0.5, status: "AVAILABLE" },
    { workedDate: "2026-11-02", earnedDays: 0.5, status: "AVAILABLE" },
  ], settings);
  // The pair, in either order the browser sends it.
  assert.ok(credits.unitFor(["2026-11-01", "2026-11-02"], units));
  assert.ok(credits.unitFor(["2026-11-02", "2026-11-01"], units));
  // Half of it is not a day off, and nor is the same half twice.
  assert.equal(credits.unitFor(["2026-11-01"], units), null);
  assert.equal(credits.unitFor(["2026-11-01", "2026-11-01"], units), null);
  assert.equal(credits.unitFor([], units), null);
  assert.equal(credits.unitFor(["2026-11-01", "2026-11-09"], units), null, "a day that earned nothing cannot top it up");
});
