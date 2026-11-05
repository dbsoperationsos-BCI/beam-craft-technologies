/**
 * The quotation's main discount - the one calculation the Quotation Generator, the CRM Quotation
 * Calculator and the client's copy all take it from.
 *
 * The Quotation Summary shows the discount twice, as a percentage and as rupees, and either box can
 * be typed into. Whichever was typed last is the **source** (`PERCENTAGE` or `AMOUNT`) and holds
 * what the person meant; the other is worked out from it. So `discountAmount` is what comes off
 * the total, and `discountPercentage` the same discount said as a percentage. When what the
 * discount comes off changes, the source keeps its figure and the other follows: 20% stays 20%,
 * ₹4,000 stays ₹4,000.
 *
 * What the discount is taken off (`discountableSubtotal`) is the caller's to say and is not
 * decided here - on the generator it is the service cost with the Performance Cost added, on the
 * calculator the base package, extras and lines. Kept free of React so `node --test` can hold it.
 */

export const DISCOUNT_SOURCES = Object.freeze({ PERCENTAGE: "PERCENTAGE", AMOUNT: "AMOUNT" });

/**
 * The most the Discount may take off a quotation: 15% of what it comes off.
 *
 * The Discount box only, typed as a percentage or as rupees - the extra discounts (a Diwali offer,
 * a management concession) are not held to it, only to keeping the total above nothing. Enforced in the generator's
 * own totals (`quotationTotals` with `discountCapPercent`), refused on save by the form, and refused
 * again by the API (`MAX_DISCOUNT_PERCENT` in `backend/src/modules/sales/projects/controller.js`,
 * which must say the same number). A quotation raised under the old limit is never rewritten: it
 * reads as it was saved, and only an edit of it is held to this.
 */
export const MAX_DISCOUNT_PERCENT = 15;

/**
 * The most, in rupees, that may come off `discountableSubtotal`: `MAX_DISCOUNT_PERCENT` of it,
 * rounded to the whole rupee exactly as a percentage discount is (`calculateDiscount`), so a
 * discount of exactly 15% is always within it.
 */
export function maxDiscountAmount(discountableSubtotal) {
  const base = Math.max(0, finite(discountableSubtotal) ?? 0);
  return Math.round(base * (MAX_DISCOUNT_PERCENT / 100));
}

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** `AMOUNT` when it says so, and `PERCENTAGE` for everything else - including a quotation that predates the choice. */
export function discountSourceOf(value) {
  return value === DISCOUNT_SOURCES.AMOUNT ? DISCOUNT_SOURCES.AMOUNT : DISCOUNT_SOURCES.PERCENTAGE;
}

/**
 * `{ discountSource, discountAmount, discountPercentage }`, from the figure typed into the source box.
 *
 * A percentage is held to 0..100 and rupees to 0..the discountable subtotal, so the discount never
 * takes the total below nothing; blank, text and NaN read as 0, and nothing is divided by a
 * subtotal of nothing. A percentage's rupees are rounded to the whole rupee, as the generator has
 * always rounded them - `wholeRupees: false` leaves them exact, for the calculator, which rounds its
 * total to the paisa instead. Typed rupees are used as typed. The percentage worked out from rupees
 * is exact; only what is shown of it is rounded (`shownPercentage`).
 */
export function calculateDiscount({ discountSource, discountValue, discountableSubtotal, wholeRupees = true }) {
  const source = discountSourceOf(discountSource);
  const base = Math.max(0, finite(discountableSubtotal) ?? 0);
  const typed = Math.max(0, finite(discountValue) ?? 0);
  if (source === DISCOUNT_SOURCES.AMOUNT) {
    const discountAmount = Math.min(base, typed);
    return { discountSource: source, discountAmount, discountPercentage: base > 0 ? (discountAmount / base) * 100 : 0 };
  }
  const percent = Math.min(100, typed);
  const exact = base * (percent / 100);
  return { discountSource: source, discountAmount: wholeRupees ? Math.round(exact) : exact, discountPercentage: percent };
}

/** A percentage as the Summary and the saved column show it: two places at most, 13.33 not 13.3333. */
export function shownPercentage(value) {
  return Math.round((finite(value) ?? 0) * 100) / 100;
}

/**
 * The discount a saved quotation or a draft opens with, as `{ discountSource, discountValue }`.
 *
 * One saved from typed rupees (`discountInputSource: "AMOUNT"`) opens on the rupees it saved
 * (`discountAmount`), so the same discount comes back whatever the percentage rounds to. Every other
 * one - including every quotation saved before rupees could be typed - opens as the percentage
 * `fallbackPercent`, which the caller reads from where it always read it.
 */
export function savedDiscountOf(payload = {}, fallbackPercent = 0) {
  const amount = finite(payload?.discountAmount);
  if (payload?.discountInputSource === DISCOUNT_SOURCES.AMOUNT && amount !== null) return { discountSource: DISCOUNT_SOURCES.AMOUNT, discountValue: Math.max(0, amount) };
  return { discountSource: DISCOUNT_SOURCES.PERCENTAGE, discountValue: Math.min(100, Math.max(0, finite(fallbackPercent) ?? 0)) };
}
