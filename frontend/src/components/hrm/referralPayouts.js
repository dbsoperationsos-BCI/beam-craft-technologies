/**
 * The arithmetic and the wording behind the referral register, kept out of the component so it can
 * be tested without rendering one — the same split `quotationProjectPlan.js` uses beside its panel.
 *
 * All of it is about money the studio owes, which is the reason none of it is inlined: an
 * instalment counted into the wrong total, or shown as due when it has been paid, is a figure
 * somebody acts on.
 */

/** What a referral instalment can be. Mirrors `PAYOUT_STATUSES` in the backend service. */
export const PAYOUT_STATUSES = ["Pending", "Paid", "Cancelled"];

/**
 * The ordinal the studio reads an instalment by: 3 is "3rd month", 6 is "6th month".
 *
 * Written out properly rather than as "3rd or else th". The studio pays at the third month and the
 * sixth today, but the schedule is a list in the backend service and adding a first or a
 * twenty-first month to it should not produce "1th" and "21th" on screen.
 */
export function instalmentLabel(monthOffset) {
  // Checked before the coercion, because `Number(null)` is 0 and would have read as "0th month" —
  // a confident-looking answer for an instalment whose month nobody actually knows.
  if (monthOffset === null || monthOffset === undefined || monthOffset === "") return "—";
  const n = Number(monthOffset);
  if (!Number.isFinite(n)) return "—";
  // 11th, 12th and 13th are the exceptions the last-digit rule gets wrong.
  const teens = Math.abs(n) % 100;
  const last = Math.abs(n) % 10;
  const suffix = teens >= 11 && teens <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${n}${suffix} month`;
}

/**
 * Whether an instalment is past its date and still owed.
 *
 * Only a Pending one can be: a paid instalment has left already, and a cancelled one is never going
 * to, so neither is late however long ago its date was. `now` is a parameter so the boundary can be
 * tested rather than depending on the clock.
 */
export function isOverdue(payout, now = new Date()) {
  if (!payout || payout.status !== "Pending" || !payout.dueOn) return false;
  const due = new Date(payout.dueOn);
  return !Number.isNaN(due.getTime()) && due < now;
}

/**
 * What the studio still owes across the referrals on screen.
 *
 * Pending only. A paid instalment is money already gone and a cancelled one is money that never
 * will be, so counting either would overstate what is outstanding — which is the one number on this
 * panel somebody might budget against.
 */
export function outstandingTotal(referrals) {
  return (referrals || []).reduce(
    (sum, referral) => sum + (referral?.payouts || [])
      .filter((payout) => payout?.status === "Pending")
      .reduce((part, payout) => part + (Number(payout?.amount) || 0), 0),
    0,
  );
}

/** Whether this instalment still has something a person can do to it. */
export const isSettleable = (payout) => payout?.status === "Pending";

/**
 * Where a whole referral has got to, read off its instalments.
 *
 * The register is one row per referral, so the row needs one word for two instalments. In order of
 * what a reader needs to act on: anything late is **Overdue**, anything still owed is
 * **Outstanding**, and a referral with nothing left to hand over is **Paid** - or **Cancelled**,
 * when it was called off rather than paid. A referral with no instalments at all reads as
 * Outstanding rather than as settled: nothing has been handed over, and calling that "Paid" would
 * quietly drop a promise off the register.
 */
export function referralStatus(referral, now = new Date()) {
  const payouts = referral?.payouts || [];
  if (payouts.some((payout) => isOverdue(payout, now))) return "Overdue";
  if (payouts.some((payout) => payout?.status === "Pending")) return "Outstanding";
  if (payouts.length === 0) return "Outstanding";
  return payouts.some((payout) => payout?.status === "Paid") ? "Paid" : "Cancelled";
}

/* ----------------------------------------------------- the schedule the studio sets */

/**
 * How far apart the instalments are, and the most a referral may be split into.
 *
 * Three months is the studio's own spacing - the register was built paying at the third month and
 * the sixth - so it is the interval a count is turned into rather than a second thing to ask for.
 * `MAX_INSTALMENTS` keeps the furthest instalment inside the ten years the backend allows.
 */
export const INSTALMENT_INTERVAL_MONTHS = 3;
export const MAX_INSTALMENTS = 24;

/**
 * The studio's total, split the way the server splits it.
 *
 * A second copy of `splitReferralAmount`, deliberately: this is the preview, and a preview that
 * asked the server what it would do would need a round-trip per keystroke. Worked in paise for the
 * same reason the server does - so the parts add back up to the total instead of drifting a rupee -
 * with the remainder on the last instalment.
 */
export function previewSplit(amount, months) {
  if (!months?.length) return [];
  const total = Math.round((Number(amount) || 0) * 100);
  const each = Math.floor(total / months.length);
  return months.map((monthOffset, index) => ({
    monthOffset,
    amount: (index === months.length - 1 ? total - each * (months.length - 1) : each) / 100,
  }));
}

/**
 * The months a given number of instalments falls due on.
 *
 * One every three months, starting at the third: two instalments are the studio's own third and
 * sixth month, three are 3-6-9, and so on. The interval is why this is a count on screen rather than
 * a list of months - "how many" is the question a studio actually has, and the spacing has never
 * varied.
 *
 * Offsets rather than the count are what get stored and what a payout row carries, because
 * `monthOffset` is what an instalment *is*: the register reads "3rd month" off it, and the amount is
 * due on a date counted from it. This is the one place that turns the question into those.
 */
export function monthsForCount(count) {
  const total = Number(count);
  if (!Number.isInteger(total) || total <= 0) return [];
  return Array.from({ length: total }, (_, index) => (index + 1) * INSTALMENT_INTERVAL_MONTHS);
}

/**
 * What the typed count means, and what is wrong with it.
 *
 * Mirrors `readInstalmentCount` in the referrals service, which is the copy that decides. This one
 * exists so the form can say so while somebody is still typing rather than on Save.
 */
export function readInstalmentCount(text) {
  const entry = String(text ?? "").trim();
  if (!entry) return { count: 0, months: [], error: "Say how many instalments a referral is paid in." };
  const count = Number(entry);
  if (!Number.isInteger(count) || count <= 0) return { count: 0, months: [], error: "Use a whole number of instalments, such as 2." };
  if (count > MAX_INSTALMENTS) return { count: 0, months: [], error: `A referral can be paid in at most ${MAX_INSTALMENTS} instalments.` };
  return { count, months: monthsForCount(count), error: null };
}
