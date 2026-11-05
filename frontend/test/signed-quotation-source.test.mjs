import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { amountForPercentage, percentageForAmount } from "../src/lib/paymentSchedule.mjs";

/*
 * Signed Quotation is what was quoted or signed - never what the client hoped to spend.
 *
 * It is the project's `initialConvertedValue`, filled from the quotation version picked (its saved
 * `amount`), from what the Quotation Calculator applied to the lead, or typed. A converted lead used
 * to fall back to the lead's Expected / Preferred Budget, which put the client's opening figure in
 * the box every schedule row is a share of.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", ...parts), "utf8");
const MANAGER = read("SalesManagerPage.js");
const SALE = read("SaleDetailsSection.js");
const BOOKING = read("projectBooking.js");

test("a converted lead's Signed Quotation is the figure applied to it, never its budget", () => {
  const prefill = MANAGER.slice(MANAGER.indexOf("function leadToProjectPrefill("), MANAGER.indexOf("\n  }\n", MANAGER.indexOf("function leadToProjectPrefill(")));
  assert.match(prefill, /initialConvertedValue: String\(lead\.quotedAmount \?\? ""\)\.replace\(\/\[\^\\d\.\]\/g, ""\),/);
  assert.doesNotMatch(prefill, /initialConvertedValue:[^\n]*(expectedBudget|preferredBudget)/);
});

test("a picked quotation version, or a booking raised from one, takes that version's saved amount", () => {
  assert.match(SALE, /initialConvertedValue: quotation && quotation\.amount !== null && quotation\.amount !== undefined\n\s*\? String\(quotation\.amount\)/);
  assert.match(BOOKING, /initialConvertedValue: quotation\?\.amount === null \|\| quotation\?\.amount === undefined \? "" : String\(quotation\.amount\),/);
});

test("a schedule row is a share of Signed Quotation, and an amount typed comes back to the rupee", () => {
  assert.equal(amountForPercentage(5, 420000), 21000);
  assert.equal(amountForPercentage(percentageForAmount(50000, 420000), 420000), 50000);
  // A schedule of nothing has no shares.
  assert.equal(percentageForAmount(50000, 0), "");
  assert.equal(amountForPercentage(10, ""), 0);
});
