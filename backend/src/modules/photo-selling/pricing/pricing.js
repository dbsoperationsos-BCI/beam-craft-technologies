/**
 * Photo Selling's prices, worked out on the server and nowhere else.
 *
 * Every amount is a whole number of minor units (paise), so no total is ever a float. The buyer's
 * browser sends only which photos it wants; what each costs, which package applies and what tax is
 * due are decided here from the store's own rows, and frozen on the order.
 *
 * One thing is sold: a photo's untouched original. Packages ("any 10 photos for ₹999") apply to
 * any photos in the cart. The cheapest combination is found exactly, by a small dynamic programme
 * over the photos sorted dearest first: a package always covers the dearest photos it can, which is
 * what saves the buyer the most.
 */
// DIGITAL (a web-size copy) is only on orders made before originals were sold; it is never priced.
const KINDS = Object.freeze({ ORIGINAL: "ORIGINAL", DIGITAL: "DIGITAL" });
const MAX_ITEMS = 200;
const MAX_PRICE_PAISE = 10_000_000; // ₹1,00,000 for one photo or one package - a typo guard, not a business rule.
const MAX_TAX_BPS = 5000;

const isMoney = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_PRICE_PAISE;

/** The price of one photo: its own, else the gallery's; null when neither is set. */
const unitPrice = (store, photo) => photo.pricePaise ?? store.pricePaise ?? null;

/**
 * Splits `total` across `weights` in proportion, in whole paise, so the parts add up to `total`
 * exactly: largest remainder, ties to the earlier line.
 */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum === 0) {
    const base = Math.floor(total / weights.length);
    return weights.map((_, index) => base + (index < total - base * weights.length ? 1 : 0));
  }
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0; i += 1, left -= 1) parts[order[i % order.length].index] += 1;
  return parts;
}

/**
 * The cheapest way to buy `prices` (sorted dearest first) with the packages offered.
 * Answers `{ cost, groups }`, each group `{ packageId, from, count, pricePaise }` naming a run of
 * the sorted list; copies outside every group are bought at their own price.
 */
function bestCombination(prices, packages) {
  const n = prices.length;
  const best = new Array(n + 1).fill(Infinity);
  const choice = new Array(n + 1).fill(null);
  best[0] = 0;
  for (let i = 1; i <= n; i += 1) {
    best[i] = best[i - 1] + prices[i - 1];
    choice[i] = null;
    for (const pack of packages) {
      if (pack.photoCount > i) continue;
      const cost = best[i - pack.photoCount] + pack.pricePaise;
      if (cost < best[i]) { best[i] = cost; choice[i] = pack; }
    }
  }
  const groups = [];
  for (let i = n; i > 0;) {
    const pack = choice[i];
    if (pack) { groups.push({ packageId: pack.id, name: pack.name, from: i - pack.photoCount, count: pack.photoCount, pricePaise: pack.pricePaise }); i -= pack.photoCount; } else i -= 1;
  }
  return { cost: best[n], groups: groups.reverse() };
}

/**
 * Prices a cart.
 *
 * `store`    `{ pricePaise, taxRateBps, pricesIncludeTax, currency }`
 * `lines`    `[{ photoId, photo }]` - already checked to be this store's photos, on sale, with an original
 * `packages` the store's active packages
 *
 * Answers the lines with `unitPricePaise` and `chargedPaise`, and the order's
 * `{ subtotalPaise, discountPaise, taxPaise, totalPaise }`, where subtotal is the lines at their own
 * prices, discount what the packages took off, and total what the buyer pays. With tax-inclusive
 * prices the tax is the part of the total that is tax; otherwise it is added on top.
 */
function priceCart(store, lines, packages = []) {
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error("Your cart is empty."), { status: 400 });
  if (lines.length > MAX_ITEMS) throw Object.assign(new Error(`An order can hold at most ${MAX_ITEMS} photos.`), { status: 400 });
  const seen = new Set();
  const priced = lines.map((line) => {
    if (seen.has(line.photoId)) throw Object.assign(new Error("A photo is in your cart twice."), { status: 400 });
    seen.add(line.photoId);
    const price = unitPrice(store, line.photo || {});
    if (price == null) throw Object.assign(new Error("That photo is not for sale."), { status: 400 });
    if (!isMoney(price)) throw Object.assign(new Error("A price in this gallery is not valid."), { status: 500 });
    return { ...line, kind: KINDS.ORIGINAL, unitPricePaise: price, chargedPaise: price };
  });

  const usable = (packages || []).filter((pack) => pack && pack.isActive !== false && Number.isInteger(pack.photoCount) && pack.photoCount >= 2 && isMoney(pack.pricePaise));
  const dearestFirst = priced.map((line, index) => ({ line, index })).sort((a, b) => b.line.unitPricePaise - a.line.unitPricePaise || a.index - b.index);
  const applied = [];
  if (usable.length && dearestFirst.length >= 2) {
    const { groups } = bestCombination(dearestFirst.map(({ line }) => line.unitPricePaise), usable);
    for (const group of groups) {
      const members = dearestFirst.slice(group.from, group.from + group.count);
      const parts = allocate(group.pricePaise, members.map(({ line }) => line.unitPricePaise));
      members.forEach(({ line }, i) => { line.chargedPaise = parts[i]; line.packageId = group.packageId; });
      applied.push({ packageId: group.packageId, name: group.name, photoCount: group.count, pricePaise: group.pricePaise });
    }
  }

  const subtotalPaise = priced.reduce((sum, line) => sum + line.unitPricePaise, 0);
  const netPaise = priced.reduce((sum, line) => sum + line.chargedPaise, 0);
  const discountPaise = subtotalPaise - netPaise;
  const bps = Math.min(Math.max(Number.isInteger(store.taxRateBps) ? store.taxRateBps : 0, 0), MAX_TAX_BPS);
  const inclusive = store.pricesIncludeTax !== false;
  const taxPaise = bps === 0 ? 0 : inclusive ? Math.round((netPaise * bps) / (10000 + bps)) : Math.round((netPaise * bps) / 10000);
  const totalPaise = inclusive ? netPaise : netPaise + taxPaise;
  return {
    lines: priced,
    subtotalPaise, discountPaise, taxPaise, totalPaise,
    currency: store.currency || "INR",
    snapshot: { taxRateBps: bps, pricesIncludeTax: inclusive, pricePaise: store.pricePaise ?? null, packages: applied },
  };
}

/** Paise as the decimal string Cashfree takes: 12345 → "123.45". */
const toRupees = (paise) => (paise / 100).toFixed(2);
/** Cashfree's decimal amount back to paise, rounding away float noise: 123.45 → 12345. */
const fromRupees = (amount) => Math.round(Number(amount) * 100);

module.exports = { KINDS, MAX_ITEMS, MAX_PRICE_PAISE, MAX_TAX_BPS, isMoney, unitPrice, allocate, bestCombination, priceCart, toRupees, fromRupees };
