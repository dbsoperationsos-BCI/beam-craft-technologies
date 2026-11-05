const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../src/modules/photo-selling/pricing/pricing");

// Photo Selling prices every cart on the server; these pin what a cart costs. One thing is sold - a
// photo's original - at the store's price unless the photo carries its own.
const store = { pricePaise: 10000, taxRateBps: 1800, pricesIncludeTax: true, currency: "INR" };
const line = (photoId, photo = {}) => ({ photoId, photo });

test("a photo costs the store's price unless it carries its own, and every line is an original", () => {
  const result = pricing.priceCart({ ...store, taxRateBps: 0 }, [line("a"), line("b", { pricePaise: 25000 })]);
  assert.deepEqual(result.lines.map((item) => item.unitPricePaise), [10000, 25000]);
  assert.deepEqual(result.lines.map((item) => item.kind), ["ORIGINAL", "ORIGINAL"]);
  assert.equal(result.subtotalPaise, 35000);
  assert.equal(result.totalPaise, 35000);
  assert.equal(result.discountPaise, 0);
  assert.equal(result.snapshot.pricePaise, 10000);
});

test("a store with no price sells nothing", () => {
  assert.throws(() => pricing.priceCart({ ...store, pricePaise: null }, [line("a")]), /not for sale/);
});

test("the same photo twice is refused", () => {
  assert.throws(() => pricing.priceCart(store, [line("a"), line("a")]), /twice/);
});

test("an empty cart, and one over the limit, are refused", () => {
  assert.throws(() => pricing.priceCart(store, []), /empty/);
  const many = Array.from({ length: pricing.MAX_ITEMS + 1 }, (_, i) => line(`m${i}`));
  assert.throws(() => pricing.priceCart(store, many), /at most/);
});

test("the cheapest package combination is applied, on the dearest photos, and the lines add up", () => {
  const packages = [{ id: "p3", name: "Any 3", photoCount: 3, pricePaise: 25000 }, { id: "p5", name: "Any 5", photoCount: 5, pricePaise: 35000 }];
  const lines = [line("a"), line("b"), line("c"), line("d"), line("e"), line("f", { pricePaise: 30000 })];
  const result = pricing.priceCart({ ...store, taxRateBps: 0 }, lines, packages);
  // 6 photos: 5-pack (35000) on the dearest five + 1 at 10000 = 45000, cheaper than 3+3 (50000).
  assert.equal(result.subtotalPaise, 80000);
  assert.equal(result.totalPaise, 45000);
  assert.equal(result.discountPaise, 35000);
  assert.equal(result.lines.reduce((sum, item) => sum + item.chargedPaise, 0), 45000);
  assert.equal(result.lines.find((item) => item.photoId === "f").packageId, "p5");
  assert.deepEqual(result.snapshot.packages.map((pack) => pack.packageId), ["p5"]);
});

test("a package that saves nothing is never applied, and inactive ones are ignored", () => {
  const result = pricing.priceCart({ ...store, taxRateBps: 0 }, [line("a"), line("b")], [{ id: "p", name: "Two", photoCount: 2, pricePaise: 30000 }, { id: "q", name: "Off", photoCount: 2, pricePaise: 100, isActive: false }]);
  assert.equal(result.totalPaise, 20000);
  assert.deepEqual(result.snapshot.packages, []);
});

test("allocation splits a package price in whole paise that sum exactly", () => {
  const parts = pricing.allocate(10000, [3, 3, 3]);
  assert.deepEqual(parts, [3334, 3333, 3333]);
  assert.equal(pricing.allocate(7, [0, 0, 0]).reduce((a, b) => a + b, 0), 7);
});

test("tax-inclusive prices report the tax inside the total; exclusive prices add it", () => {
  const inclusive = pricing.priceCart(store, [line("a")]);
  assert.equal(inclusive.totalPaise, 10000);
  assert.equal(inclusive.taxPaise, 1525); // 10000 × 18 / 118 = 1525.42…
  const exclusive = pricing.priceCart({ ...store, pricesIncludeTax: false }, [line("a")]);
  assert.equal(exclusive.taxPaise, 1800);
  assert.equal(exclusive.totalPaise, 11800);
});

test("an absurd price in the store's rows is a server error, not a charge", () => {
  assert.throws(() => pricing.priceCart({ ...store, pricePaise: 1.5 }, [line("a")]), /not valid/);
});

test("rupee conversion is exact both ways", () => {
  assert.equal(pricing.toRupees(12345), "123.45");
  assert.equal(pricing.fromRupees(123.45), 12345);
  assert.equal(pricing.fromRupees("170.00"), 17000);
  assert.equal(pricing.fromRupees(0.29), 29);
});

test("checkout and quote take photo ids only - a total or price sent by the browser is refused, never used", () => {
  const v = require("../src/modules/photo-selling/shared/validation");
  const buyer = { name: "Asha", phone: "9876543210" };
  const items = [{ photoId: "p1" }];
  assert.equal(v.checkout.safeParse({ buyer, items }).success, true);
  for (const tampered of [{ totalPaise: 100 }, { amount: 1 }, { currency: "USD" }]) {
    assert.equal(v.checkout.safeParse({ buyer, items, ...tampered }).success, false, JSON.stringify(tampered));
    assert.equal(v.quote.safeParse({ items, ...tampered }).success, false, JSON.stringify(tampered));
  }
  assert.equal(v.checkout.safeParse({ buyer, items: [{ photoId: "p1", pricePaise: 1 }] }).success, false, "no price on a line either");
});
