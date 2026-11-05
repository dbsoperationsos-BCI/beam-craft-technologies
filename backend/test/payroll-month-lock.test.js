const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Payroll → Main Page: a month locks once its payable date has passed. Until then everybody holding
 * the register's Read / Write may change it; after, only somebody holding HRM / Payroll After Payday -
 * the Super Admin. Reading it is never locked.
 */

const versions = require("../src/modules/hrm/payroll-register/settingsVersions");
const monthLock = require("../src/modules/hrm/payroll-register/monthLock");

// Payable on the 10th of the payroll month, whatever month is asked.
const client = { payrollEntry: { findUnique: async ({ where }) => ({ 7: { year: 2026, month: 10 }, 8: { year: 2026, month: 11 } }[where.id] || null) } };

test("October 2026, payable 10 Oct, is open on the 10th and locked from the 11th (India time)", async (t) => {
  t.mock.method(versions, "settingsBook", async () => () => ({ paybackDay: 10 }));
  // 10 Oct 23:00 in India is 17:30 UTC; 11 Oct 00:30 in India is 10 Oct 19:00 UTC.
  assert.deepEqual(await monthLock.monthLock(2026, 10, { client, now: new Date("2026-10-10T17:30:00Z") }), { locked: false, payableOn: "2026-10-10" });
  assert.deepEqual(await monthLock.monthLock(2026, 10, { client, now: new Date("2026-10-10T19:00:00Z") }), { locked: true, payableOn: "2026-10-10" });
});

test("a change to a locked month is refused, naming it - unless the caller may change locked months", async (t) => {
  t.mock.method(versions, "settingsBook", async () => () => ({ paybackDay: 10 }));
  const now = new Date("2026-10-15T06:00:00Z");
  await assert.rejects(monthLock.assertRowOpen(7, false, { client, now }), { status: 403, message: "The October 2026 payroll was payable on 10 Oct 2026 and is locked. Only a Super Admin can change it now." });
  await monthLock.assertRowOpen(7, true, { client, now });
  // November is not yet payable, and a row that is not there is left to the write itself.
  await monthLock.assertRowOpen(8, false, { client, now });
  await monthLock.assertRowOpen(99, false, { client, now });
});

test("every write on the register asks first; the list says whether the month is locked for this reader", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "controller.js"), "utf8");
  for (const call of ["skips.skipDeduction(", "skips.undoSkip(", "service.updateEntry(", "service.restoreEntry("]) {
    const at = controller.indexOf(call);
    assert.ok(at > 0 && controller.lastIndexOf("await rowOpen(req, id);", at) > controller.lastIndexOf("async function", at), `${call} is not asked first`);
  }
  assert.match(controller, /await rowOpen\(req, id\);\s*await service\.removeEntry\(/);
  assert.match(controller, /await rowOpen\(req, rowId\);\s*await service\.removeEntry\(/);
  assert.match(controller, /await monthLock\.assertRowOpen\(id, editLocked\)/);
  assert.match(controller, /if \(locked && !\(await canEditLocked\(req\)\)\) return res\.json/);
  assert.match(controller, /lock: \{ locked: lock\.locked, payableOn: lock\.payableOn, canEdit: !lock\.locked \|\| canEdit \}/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261015120000_payroll_after_payday", "migration.sql"), "utf8");
  assert.match(migration, /'HRM', 'Payroll After Payday', 'PAYROLL_AFTER_PAYDAY'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
});

test("an advance, recovery or skip that would change a locked month's figure is refused; one leaving it alone is not", async (t) => {
  t.mock.method(versions, "settingsBook", async () => () => ({ paybackDay: 10 }));
  const now = new Date("2026-10-15T06:00:00Z");
  await assert.rejects(monthLock.assertFigureOpen(2026, 10, 0, 5000, { client, now }), { status: 409, message: /October 2026 payroll was payable on 10 Oct 2026 and is locked\. This would change what it took/ });
  await monthLock.assertFigureOpen(2026, 10, 5000, 5000, { client, now });
  await monthLock.assertFigureOpen(2026, 11, 0, 5000, { client, now });
  // Asked by every place that re-totals a month's row from elsewhere.
  for (const file of [["payroll-advance", "service.js"], ["payroll-recovery", "service.js"], ["payroll-register", "skips.js"]]) {
    assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", ...file), "utf8"), /monthLock"\)\.assertFigureOpen\(year, month,/, file.join("/"));
  }
});
