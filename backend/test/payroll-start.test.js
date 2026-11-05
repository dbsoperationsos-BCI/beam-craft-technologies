const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Settings → Payroll rules → Payroll starts from: the first payroll month the Main Page keeps - a
 * month before it is never made, never shown and never a payslip.
 */

const start = require("../src/modules/hrm/payroll-register/payrollStart");
const { payrollStartSchema } = require("../src/modules/hrm/payroll-register/controller");
const day = (iso) => new Date(`${iso}T00:00:00Z`);

function client({ chosen = null, attendanceStart = null } = {}) {
  const writes = [];
  return {
    writes,
    hrmSettings: {
      findUnique: async () => ({ payrollStartsFrom: chosen ? day(chosen) : null, payCycleDay: 25, paybackDay: 10 }),
      upsert: async (query) => { writes.push(query.update); },
    },
    attendanceSettings: { findUnique: async () => ({ attendanceStartDate: attendanceStart ? day(attendanceStart) : null }) },
    payrollRuleVersion: { findMany: async () => [] },
  };
}

test("unchosen, payroll starts with the first month whose pay cycle starts once attendance went live", async () => {
  // Cycles turn over on the 25th: October's runs 25 Aug - 24 Sep, so attendance from 25 Aug starts October.
  assert.deepEqual((await start.payrollStart({ client: client({ attendanceStart: "2026-08-25" }) })).startsFrom, { year: 2026, month: 10 });
  // A day later misses October's cycle - November is the first whole one.
  assert.deepEqual((await start.payrollStart({ client: client({ attendanceStart: "2026-08-26" }) })).startsFrom, { year: 2026, month: 11 });
  // Neither chosen nor attendance started: no limit, as before.
  assert.equal((await start.payrollStart({ client: client() })).startsFrom, null);
});

test("a chosen month wins over attendance's, and the default is still said beside it", async () => {
  const read = await start.payrollStart({ client: client({ chosen: "2026-12-01", attendanceStart: "2026-08-25" }) });
  assert.deepEqual([read.startsFrom, read.chosen, read.defaultFrom], [{ year: 2026, month: 12 }, { year: 2026, month: 12 }, { year: 2026, month: 10 }]);
});

test("a month before the start is before it; the start and after are not; no start limits nothing", () => {
  const from = { startsFrom: { year: 2026, month: 10 } };
  assert.equal(start.beforeStart(2026, 9, from), true);
  assert.equal(start.beforeStart(2025, 12, from), true);
  assert.equal(start.beforeStart(2026, 10, from), false);
  assert.equal(start.beforeStart(2027, 1, from), false);
  assert.equal(start.beforeStart(2020, 1, { startsFrom: null }), false);
});

test("saved as the 1st of the month, or cleared; only by somebody who reaches every branch; a real month alone", async () => {
  const db = client({ attendanceStart: "2026-08-25" });
  await start.savePayrollStart("2026-11", 7, null, db);
  assert.deepEqual(db.writes[0], { payrollStartsFrom: day("2026-11-01"), updatedByUserId: 7 });
  await start.savePayrollStart(null, 7, null, db);
  assert.equal(db.writes[1].payrollStartsFrom, null);
  await assert.rejects(start.savePayrollStart("2026-11", 7, [1], db), (error) => error.status === 403);
  assert.equal(db.writes.length, 2);
  for (const body of [{ startsFrom: "2026-13" }, { startsFrom: "2026-1" }, { startsFrom: "Oct" }, {}, { startsFrom: "2026-10", other: 1 }]) {
    assert.equal(payrollStartSchema.safeParse(body).success, false, JSON.stringify(body));
  }
  assert.equal(payrollStartSchema.safeParse({ startsFrom: null }).success, true);
});

test("opening, listing and payslips all keep to it; the endpoints sit under the register's own guard", () => {
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "service.js"), "utf8");
  assert.match(SERVICE, /if \(require\("\.\/payrollStart"\)\.beforeStart\(year, month, start\)\) return \{ beforeStart: true, startsFrom: start\.startsFrom,/);
  assert.match(SERVICE, /if \(require\("\.\/payrollStart"\)\.beforeStart\(year, month, start\)\) \{[\s\S]{0,400}beforeStart: true,\s+startsFrom: start\.startsFrom,\s+components: \[\],\s+rows: \[\],/);
  const PAYSLIPS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "my-payslips", "service.js"), "utf8");
  assert.match(PAYSLIPS, /\.filter\(\(row\) => !beforeStart\(row\.year, row\.month, start\)\)/);
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  const guard = ROUTES.indexOf('router.use(requireModule("HRM", "Payroll Register"));');
  assert.ok(guard > 0 && ROUTES.indexOf('router.put("/payroll-start", controller.savePayrollStart);') > guard);
  assert.ok(ROUTES.indexOf('router.put("/payroll-start"') < ROUTES.indexOf('router.put("/:id"'));
});
