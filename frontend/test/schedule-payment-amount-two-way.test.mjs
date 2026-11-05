import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { amountForPercentage, percentageForAmount } from "../src/lib/paymentSchedule.mjs";

/*
 * Schedule Payment, entered from whichever end the studio is thinking in.
 *
 * A schedule is a set of **shares** of the signed quotation - that is what is stored, and it is why the
 * amounts follow when the quotation is corrected. But a studio does not always think in shares: a client
 * agrees to pay ₹50,000 at slot booking, and working out what percentage of ₹4,20,000 that is, to three
 * decimal places, is arithmetic nobody should be doing to fill in a form. So both boxes are typed into and
 * each works out the other.
 *
 * The percentage stays the stored value either way. Deriving it from an amount is what makes the decimals
 * necessary: ₹50,000 of ₹4,20,000 is 11.904762%, and a whole number would be ₹210 out.
 */

const SECTION = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "SchedulePaymentSection.js"), "utf8");

test("an amount becomes the share of the quotation that it is", () => {
  assert.equal(percentageForAmount(50000, 420000), 11.904762);
  assert.equal(percentageForAmount(5000, 100000), 5);
  // The whole of it, and more than the whole of it - the box is not the place to argue about that, and
  // the schedule is read as a set of shares that may not add to a hundred while it is being filled in.
  assert.equal(percentageForAmount(100000, 100000), 100);
  assert.equal(percentageForAmount(150000, 100000), 150);
});

test("a quotation of nothing yields no share, rather than infinity or NaN", () => {
  /*
   * Every amount in this table is a share of the signed quotation, so until that is set there is no share
   * an amount could be expressed as. `50000 / 0` is Infinity and `0 / 0` is NaN, and either written into
   * the row would be saved and rendered.
   */
  for (const quotation of [0, "", null, undefined]) assert.equal(percentageForAmount(50000, quotation), "");
  assert.equal(percentageForAmount("", 100000), "");
});

test("the two directions agree: an amount typed in comes back out to the rupee", () => {
  /*
   * The round trip is the whole test of the precision. Six decimal places keeps it exact to the rupee on
   * quotations up to a crore, which is the range this studio's projects live in; beyond that the amount
   * can come back a rupee or two different, and being visibly a share rather than a figure typed twice is
   * the honest reading of what the row holds.
   */
  for (const [amount, quotation] of [[50000, 420000], [1, 999999], [33333, 100000], [7, 13]]) {
    assert.equal(amountForPercentage(percentageForAmount(amount, quotation), quotation), amount, `${amount} of ${quotation}`);
  }
});

test("a percentage yields its amount, rounded to the rupee", () => {
  assert.equal(amountForPercentage(5, 100000), 5000);
  assert.equal(amountForPercentage(11.904762, 420000), 50000);
  assert.equal(amountForPercentage("", 100000), 0);
  assert.equal(amountForPercentage(5, 0), 0);
});

test("the percentage box takes decimals", () => {
  /*
   * It was `type="number"` with no `step`, which means a step of one: a browser marks 11.9 invalid against
   * that and its arrows walk in whole numbers. Digits and a single dot, sanitised as typed - the same rule
   * the Signed Quotation box two rows above already used, so the two money boxes on this screen behave the
   * same way.
   */
  /*
   * Asserted against the **inputs** rather than as a bare substring: `type="number"` is named in the comment
   * that explains why it went, and a test that reads prose as markup is a test that fails on a comment.
   */
  const inputs = [...SECTION.matchAll(/<input\b[\s\S]*?\/>/g)].map((match) => match[0]);
  assert.ok(inputs.length >= 3, "the section draws the quotation, the percentage and the amount");
  for (const input of inputs) assert.equal(/type="number"/.test(input), false, "a stepped number box refuses the decimals this needs");
  // The percentage and the amount both sanitise to digits and a single dot, as the quotation above already did.
  const sanitising = inputs.filter((input) => input.includes('replace(/[^\\d.]/g, "")'));
  assert.ok(sanitising.length >= 2, "the percentage and the amount sanitise as they are typed");
});

test("the amount box is a box, and says so when there is nothing to take a share of", () => {
  // It was a computed cell, so the only way in was the percentage.
  assert.match(SECTION, /aria-label="Amount"/);
  // Disabled without a quotation: a share of nothing cannot be expressed, and the section already says
  // why in the line under the figure.
  assert.match(SECTION, /disabled=\{!Number\(signedQuotation\)\}/);
});

test("what is typed is left alone while it is being typed", () => {
  /*
   * The amount cell is drawn from the percentage, so re-deriving it on every keystroke would rewrite the
   * box under the cursor: "5" becomes 5% becomes "5", then "50" becomes 50% becomes "50" - until a
   * rounding disagreement turns "50000" into "49999" mid-word. While a row's amount is being edited the
   * box shows what was typed, and goes back to the derived figure when it is left.
   */
  assert.match(SECTION, /editingAmount/);
  assert.match(SECTION, /onBlur=\{\(\) => setEditingAmount\(null\)\}/);
});
