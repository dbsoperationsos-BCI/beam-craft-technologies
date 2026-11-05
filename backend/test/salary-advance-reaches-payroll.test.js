const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTROLLER = read("src/modules/hrm/payment-requests/controller.js");
const ADVANCE = read("src/modules/hrm/payroll-advance/service.js");

/*
 * A salary advance was two records that did not know about each other: the payment request that
 * asked for the money and was approved, and HRM → Payroll → Advance Salary, which is what deducts
 * it. Nothing joined them, so an approved advance reached payroll only if somebody retyped it - and
 * when nobody did, the studio paid it out and never took it back.
 */

test("paying a salary advance writes the payroll row that takes it back", () => {
  assert.match(CONTROLLER, /if \(request\.type === "SALARY_ADVANCE"\) \{/);
  assert.match(CONTROLLER, /await recordSalaryAdvance\(tx, request, actorId, parsed\.data\.entryDate \|\| new Date\(\)\);/);
  // The payroll screen's own path, not a second way of writing the same row.
  assert.match(CONTROLLER, /const \{ createAdvanceIn \} = require\("\.\.\/payroll-advance\/service"\);/);
  assert.match(CONTROLLER, /return createAdvanceIn\(tx, \{/);
});

test("it is written in the payment's own transaction, so neither half can happen alone", () => {
  // A request marked paid with no deduction behind it is the bug this closes.
  const payment = CONTROLLER.slice(CONTROLLER.indexOf("async function payRequest"));
  const transaction = payment.slice(payment.indexOf("$transaction"), payment.indexOf("return res.json"));
  assert.match(transaction, /recordSalaryAdvance\(tx,/, "inside the transaction, not after it");
  // Prisma's transaction client has no `$transaction`, so the service had to be split for this.
  assert.match(ADVANCE, /async function createAdvanceIn\(tx, input, userId/);
  assert.match(ADVANCE, /return client\.\$transaction\(\(tx\) => createAdvanceIn\(tx, input, userId, \{ reach, statuses \}\)\);/);
});

test("the amount reaches that month's payslip the same way the payroll form's does", () => {
  // `syncPayroll` is what puts it on the entry as its Salary Advance deduction.
  const body = ADVANCE.slice(ADVANCE.indexOf("async function createAdvanceIn"), ADVANCE.indexOf("async function createAdvance("));
  assert.match(body, /await syncPayroll\(tx, input\.employeeId, input\.deductYear, input\.deductMonth\);/);
});

test("it comes off the payroll month still being paid, never one already paid", () => {
  assert.match(CONTROLLER, /const \{ year, month \} = await openPayrollMonth\(tx\);/);
  assert.match(CONTROLLER, /const \{ openPayrollMonth \} = require\("\.\.\/payroll-register\/settingsVersions"\);/);
  // `checkNotPaid` is the service's own refusal, kept on this path by reusing it.
  const body = ADVANCE.slice(ADVANCE.indexOf("async function createAdvanceIn"), ADVANCE.indexOf("async function createAdvance("));
  assert.match(body, /await checkNotPaid\(tx, input\.employeeId, input\.deductYear, input\.deductMonth\);/);
});

test("an advance naming no employee is refused, not paid with nothing to recover it", () => {
  assert.match(CONTROLLER, /if \(!request\.requestedById\) \{\s*\n\s*throw badRequest\("This advance names no employee record/);
});

test("the row names the request it came from, and only one row per request", () => {
  assert.match(CONTROLLER, /paymentRequestId: request\.id,/);
  assert.match(ADVANCE, /\.\.\.\(input\.paymentRequestId \? \{ paymentRequestId: input\.paymentRequestId \} : \{\}\),/);
  // `@unique`, so approving the same request twice cannot leave two deductions behind it.
  assert.match(read("prisma/schema.prisma"), /paymentRequestId Int\? @unique @map\("payment_request_id"\)/);
  assert.match(read("prisma/schema.prisma"), /payrollAdvance PayrollAdvance\?/);
});

test("the payroll screen says where the advance came from", () => {
  // The request code and what was agreed about paying it back, on the row's Reason.
  assert.match(CONTROLLER, /reason: \[request\.requestCode, request\.repaymentPlan, request\.reason\]\.filter\(Boolean\)\.join\(" · "\),/);
});

test("the migration adds the link without failing on the advances already there", () => {
  const sql = read("prisma/migrations/20261102140000_payroll_advance_from_payment_request/migration.sql");
  assert.match(sql, /ADD COLUMN `payment_request_id` INTEGER NULL;/);
  assert.match(sql, /CREATE UNIQUE INDEX `payroll_advance_payment_request_id_key`/);
  assert.match(sql, /ON DELETE SET NULL ON UPDATE CASCADE;/);
});
