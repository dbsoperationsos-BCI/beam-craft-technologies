const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAmount, formatAmount, leadValue, daysBetween } = require("../src/services/ai/money");

/*
 * The arithmetic the model is not allowed to do.
 *
 * "1.5 lakhs" is the shape a budget actually arrives in on these calls, and a language model will
 * turn it into 15,000 as confidently as 150,000. Every figure the CRM shows is computed here.
 */

test("Indian amounts parse the way they are spoken", () => {
  assert.equal(parseAmount("1.5 lakhs"), 150_000);
  assert.equal(parseAmount("2 lakh"), 200_000);
  assert.equal(parseAmount("₹1,50,000"), 150_000);
  assert.equal(parseAmount("Rs. 75000"), 75_000);
  assert.equal(parseAmount("50k"), 50_000);
  assert.equal(parseAmount("1 crore"), 10_000_000);
  assert.equal(parseAmount(250_000), 250_000);
});

test("an unstated budget stays unstated", () => {
  // Zero would read as "they have no money" rather than "nobody asked".
  for (const value of ["", null, undefined, "not discussed", "TBD", "abc"]) {
    assert.equal(parseAmount(value), null, `${value} should be null`);
  }
  assert.equal(parseAmount(0), null);
  assert.equal(parseAmount(-5), null);
});

test("amounts are formatted the way the CRM writes them", () => {
  assert.equal(formatAmount(150_000), "₹1,50,000");
  assert.equal(formatAmount(0), "");
  assert.equal(formatAmount(null), "");
});

test("lead value is summed in code, never by the model", () => {
  const out = leadValue({
    preferredBudget: "1.5 lakhs",
    expectedBudget: "₹2,00,000",
    projects: [{ initialConvertedValue: "80000" }, { initialConvertedValue: "1.2 lakhs" }],
  });
  assert.equal(out.preferredBudget, 150_000);
  assert.equal(out.expectedBudget, 200_000);
  assert.equal(out.convertedTotal, 200_000);
  assert.equal(out.convertedAverage, 100_000);
  assert.equal(out.formatted.convertedTotal, "₹2,00,000");
});

test("a lead with no figures reports nothing rather than zero", () => {
  const out = leadValue({});
  assert.equal(out.preferredBudget, null);
  assert.equal(out.convertedTotal, null);
  assert.equal(out.convertedAverage, null);
  assert.equal(out.formatted.preferredBudget, "");
});

test("unparseable project values are skipped, not counted as zero", () => {
  // One bad row must not drag the average down to something that looks like a real number.
  const out = leadValue({ projects: [{ initialConvertedValue: "1 lakh" }, { initialConvertedValue: "TBD" }] });
  assert.equal(out.convertedCount, 1);
  assert.equal(out.convertedAverage, 100_000);
});

test("days between dates are counted", () => {
  const from = new Date("2026-08-01T00:00:00Z");
  assert.equal(daysBetween(from, new Date("2026-08-13T00:00:00Z")), 12);
  assert.equal(daysBetween("2026-08-01", "2026-08-02"), 1);
  assert.equal(daysBetween("not a date"), null);
});
