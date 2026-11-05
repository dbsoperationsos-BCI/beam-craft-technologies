import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { amountToPay, heldForNotice, noticeHoldOf, shownEmployeeName, shownPaymentStatus } from "../src/lib/payrollRegister.mjs";

// Payroll rules → Hold salary during notice, as the Main Page reads a row's `noticeHold`.
const money = (value) => `Rs ${value}`;

test("a held month says which final settlement pays it, and is never ticked to pay alone", () => {
  const row = { roundedSalary: 30000, noticeHold: { state: "held", settlesIn: { label: "November 2026" }, released: [] } };
  assert.deepEqual(noticeHoldOf(row, money), { status: "Held for notice", detail: "Paid with the November 2026 final settlement" });
  assert.equal(heldForNotice(row), true);
  assert.equal(amountToPay(row), 30000);
});

test("the final settlement pays its own month and every held one", () => {
  const row = { roundedSalary: 30000, noticeHold: { state: "settlement", finalSettlement: 90000, released: [{ label: "September 2026", amount: 30000 }, { label: "October 2026", amount: 30000 }] } };
  assert.equal(noticeHoldOf(row, money).status, "Final settlement");
  assert.equal(noticeHoldOf(row, money).detail, "Rs 90000: this month and 2 held months (September 2026, October 2026)");
  assert.equal(amountToPay(row), 90000);
});

test("nobody else is touched", () => {
  assert.equal(noticeHoldOf({ roundedSalary: 1, noticeHold: null }), null);
  assert.equal(amountToPay({ roundedSalary: 25000 }), 25000);
  assert.equal(heldForNotice({}), false);
});

test("Settings and the Main Page show it", () => {
  const panel = fs.readFileSync(new URL("../src/components/settings/PayrollRulesPanel.js", import.meta.url), "utf8");
  assert.match(panel, /<NoticeHoldPanel canWrite=\{canWrite\}/);
  const main = fs.readFileSync(new URL("../src/components/hrm/PayrollMainSection.js", import.meta.url), "utf8");
  assert.match(main, /id: "noticeHold", label: "Final Settlement"/);
  assert.match(main, /const unpaidRow = \(row\) => row\.paymentStatus !== "Paid" && !heldForNotice\(row\)/);
  assert.match(main, /rupees\(payingMany\.rows\.reduce\(\(sum, row\) => sum \+ amountToPay\(row\), 0\)\)/);
});

test("a month held for the notice is shown, counted and boarded as On Hold, and its note is red", () => {
  assert.equal(shownPaymentStatus({ paymentStatus: "Pending", noticeHold: { state: "held" } }), "On Hold");
  assert.equal(shownPaymentStatus({ paymentStatus: "Paid", noticeHold: { state: "held" } }), "Paid");
  assert.equal(shownPaymentStatus({ paymentStatus: "Pending", noticeHold: { state: "settlement" } }), "Pending");
  assert.equal(shownPaymentStatus({ paymentStatus: "Pending", noticeHold: null }), "Pending");
  const section = fs.readFileSync(new URL("../src/components/hrm/PayrollMainSection.js", import.meta.url), "utf8");
  assert.match(section, /const boardStatusOf = shownPaymentStatus;/);
  assert.match(section, /rows\.filter\(\(row\) => shownPaymentStatus\(row\) === tab\)/);
  assert.match(section, /rows\.filter\(\(row\) => shownPaymentStatus\(row\) === activeTab\)/);
  assert.match(section, /heldForNotice\(editing\.row\) \? "border-red-200 bg-red-50 text-red-700"/);
});

test("a month held for the notice names its employee with (Serving Notice), in the table and on the Board", () => {
  assert.equal(shownEmployeeName({ employeeName: "bc dc", paymentStatus: "Pending", noticeHold: { state: "held" } }), "bc dc (Serving Notice)");
  assert.equal(shownEmployeeName({ employeeName: "bc dc", paymentStatus: "Pending", noticeHold: null }), "bc dc");
  assert.equal(shownEmployeeName({ employeeName: "", noticeHold: { state: "held" } }), "-");
  const section = fs.readFileSync(new URL("../src/components/hrm/PayrollMainSection.js", import.meta.url), "utf8");
  assert.match(section, /\{ id: "employeeName", label: "Name", value: shownEmployeeName \}/);
  assert.match(section, /card=\{\{ title: shownEmployeeName,/);
});
