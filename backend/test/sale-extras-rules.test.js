const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/modules/sales/sale-extras/rules");

/*
 * The arithmetic and the comparisons Sale Extras stands on: which fields are a line's scope, when two
 * scopes are the same, the sign a kind of change gives a typed amount, and a revision's totals.
 */

test("a row's scope is only its scope fields, nulls kept, and compared as values", () => {
  const service = { quantity: 2, durationHours: 4, remarks: "ignored", serviceName: "Candid", sessionOptionId: null };
  assert.deepEqual(rules.scopeOf("SERVICE", service), {
    quantity: 2, quantitySessionTiming: null, sessionOptionId: null, durationHours: 4, durationMinutes: null, workDays: null, timingMinutes: null, sizeOptionValueId: null,
  });
  assert.deepEqual(rules.scopeOf("SHOOT", { shoot: "Wedding", dateCreated: new Date() }), {});
  assert.equal(rules.sameScope("SERVICE", { quantity: 1 }, { quantity: 1, remarks: "x" }), true);
  assert.equal(rules.sameScope("SERVICE", { quantity: 1 }, { quantity: 2 }), false);
  assert.equal(rules.sameScope("DELIVERABLE", { size: "12x36", quantity: 1 }, { size: "12x36", quantity: "1" }), true, "a number and its string are the same value");
  assert.equal(rules.sameScope("DELIVERABLE", { brandName: "Canvera" }, { brandName: null }), false);
});

test("the kind decides the sign of a typed amount, and refuses one that contradicts it", () => {
  assert.equal(rules.signedAmount("ADDED", 15000), 15000);
  assert.equal(rules.signedAmount("ADDED", -5), 5);
  assert.equal(rules.signedAmount("REMOVED", 10000), -10000);
  assert.equal(rules.signedAmount("MODIFIED", -2500), -2500);
  assert.equal(rules.signedAmount("MODIFIED", 2500.555), 2500.56);
  assert.equal(rules.amountProblem(10), "");
  assert.notEqual(rules.amountProblem(Number.NaN), "");
  assert.notEqual(rules.amountProblem(1_000_000_000), "");
});

test("a revision's totals are the original plus every priced line, never floored", () => {
  const lines = [{ amount: 15000 }, { amount: 8000 }, { amount: -10000 }, { amount: null, included: true }];
  assert.deepEqual(rules.revisionTotals(235000, lines), { originalAmount: 235000, netAdjustment: 13000, updatedTotal: 248000 });
  assert.equal(rules.revisionTotals(1000, [{ amount: -2500 }]).updatedTotal, -1500);
});

test("a snapshot nests included lines under the line they are priced with", () => {
  const rows = [
    { id: "s", code: "SXT-1", kind: "ADDED", category: "SHOOT", itemName: "Reception", shootName: "Reception", amount: "15000.00", parentExtraId: null, publishedIn: 1 },
    { id: "c", code: "SXT-2", kind: "ADDED", category: "SERVICE", itemName: "Candid Photo", shootName: "Reception", amount: null, parentExtraId: "s", publishedIn: 1 },
    { id: "r", code: "SXT-3", kind: "REMOVED", category: "SHOOT", itemName: "Pre-wedding", shootName: "Pre-wedding", amount: "-10000.00", parentExtraId: null, publishedIn: 2 },
  ];
  assert.deepEqual(rules.snapshotLines(rows), [
    { extraId: "s", code: "SXT-1", kind: "ADDED", category: "SHOOT", itemName: "Reception", shootName: "Reception", amount: 15000, publishedIn: 1, included: [{ extraId: "c", code: "SXT-2", kind: "ADDED", category: "SERVICE", itemName: "Candid Photo", shootName: "Reception", publishedIn: 1 }] },
    { extraId: "r", code: "SXT-3", kind: "REMOVED", category: "SHOOT", itemName: "Pre-wedding", shootName: "Pre-wedding", amount: -10000, publishedIn: 2, included: [] },
  ]);
});
