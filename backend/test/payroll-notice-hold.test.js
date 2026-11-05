const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const notice = require("../src/modules/hrm/payroll-register/noticeHold");

/*
 * Payroll rules → Hold salary during notice: a leaver's unpaid months from their resignation date are
 * held, and paid together as the full and final settlement in the month whose cycle holds their last
 * working day. Off unless switched on; worked out on read; a paid month is never touched.
 */

// The studio defaults: the cycle ends on the 24th, pay on the 10th.
const settingsOf = () => ({ cycleDay: 25, paybackDay: 10, lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" });
const hold = { from: "2026-08-20", lastDay: "2026-10-10" };
const row = (month, from, to, extra = {}) => ({ year: 2026, month, periodFrom: new Date(`${from}T00:00:00Z`), periodTo: new Date(`${to}T00:00:00Z`), paymentStatus: "Pending", settledInEntryId: null, ...extra });

test("the settlement month is the one whose pay cycle holds the last working day", () => {
  assert.deepEqual(notice.settlementMonth("2026-10-10", settingsOf), { year: 2026, month: 11, payableOn: "2026-11-10" });
  // The cycle's last day still belongs to it; the day after starts the next month's.
  assert.equal(notice.settlementMonth("2026-10-24", settingsOf).month, 11);
  assert.equal(notice.settlementMonth("2026-10-25", settingsOf).month, 12);
  // Over a year end: 30 Dec is in the 25 Dec - 24 Jan cycle, which is February's payroll.
  assert.deepEqual(notice.settlementMonth("2026-12-30", settingsOf), { year: 2027, month: 2, payableOn: "2027-02-10" });
});

test("a month is held only when unpaid, before the settlement, and payable on or after the resignation", () => {
  assert.equal(notice.holdState(row(8, "2026-06-25", "2026-07-24"), hold, settingsOf), null, "paid out on 10 Aug, before the resignation");
  assert.equal(notice.holdState(row(9, "2026-07-25", "2026-08-24"), hold, settingsOf), "held", "a month already worked, paid after the resignation");
  assert.equal(notice.holdState(row(10, "2026-08-25", "2026-09-24"), hold, settingsOf), "held");
  assert.equal(notice.holdState(row(11, "2026-09-25", "2026-10-24"), hold, settingsOf), "settlement");
  assert.equal(notice.holdState(row(12, "2026-10-25", "2026-11-24"), hold, settingsOf), null, "after the settlement");
  assert.equal(notice.holdState(row(10, "2026-08-25", "2026-09-24", { paymentStatus: "Paid" }), hold, settingsOf), null, "a paid month is never held");
  assert.equal(notice.holdState(row(10, "2026-08-25", "2026-09-24"), undefined, settingsOf), null, "nobody without a hold");
  assert.equal(notice.holdState(row(10, "2026-08-25", "2026-09-24"), { ...hold, settlementPaid: true }, settingsOf), null, "once the settlement is paid, a month found later is paid on its own");
  assert.equal(notice.holdState(row(10, "2026-08-25", "2026-09-24", { paymentStatus: "Paid", settledInEntryId: 7 }), undefined, settingsOf), "settled", "settled reads as settled even once the hold is gone");
});

test("a new separation is held only with the switch on, for a resignation served on notice", async () => {
  const client = (on) => ({ hrmSettings: { findUnique: async () => ({ holdSalaryDuringNotice: on }) } });
  const resignation = { separationType: "Resignation", servesNotice: true, resignationDate: new Date("2026-08-20T00:00:00Z"), today: "2026-08-21" };
  assert.deepEqual(await notice.holdForSeparation(resignation, client(false)), { salaryHeld: false, salaryHeldFrom: null }, "off by default");
  const held = await notice.holdForSeparation(resignation, client(true));
  assert.equal(held.salaryHeld, true);
  assert.equal(held.salaryHeldFrom.toISOString().slice(0, 10), "2026-08-20");
  assert.equal((await notice.holdForSeparation({ ...resignation, resignationDate: null }, client(true))).salaryHeldFrom.toISOString().slice(0, 10), "2026-08-21", "today where no date is given");
  assert.equal((await notice.holdForSeparation({ ...resignation, servesNotice: false }, client(true))).salaryHeld, false, "no notice to serve");
  assert.equal((await notice.holdForSeparation({ ...resignation, separationType: "Termination" }, client(true))).salaryHeld, false);
  assert.equal((await notice.holdForSeparation({ ...resignation, separationType: "Mutual Separation" }, client(true))).salaryHeld, true);
});

test("the register refuses a held month alone and pays held months with their settlement", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/payroll-register/service.js"), "utf8");
  assert.match(source, /paying && holdState === "held"[\s\S]{0,200}held during the notice period/);
  assert.match(source, /reopening && holdState === "settled"/);
  assert.match(source, /for \(const held of released\)[\s\S]{0,200}payHeldMonth\(tx/);
  assert.match(source, /reopenSettledMonths\(tx, id, userId\)/);
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261101100000_payroll_notice_hold/migration.sql"), "utf8");
  assert.match(migration, /hold_salary_during_notice` BOOLEAN NOT NULL DEFAULT false/, "the switch starts off");
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|DROP)\b|DROP COLUMN/im, "only adds");
});

test("a separation records the hold when it is created, never adds one on edit", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/separations/controller.js"), "utf8");
  assert.match(source, /noticeHold\.holdForSeparation\(/);
  assert.match(source, /\.\.\.salaryHold,\s*createdBy/);
  assert.match(source, /const salaryHold = existing\.salaryHeld/);
});
