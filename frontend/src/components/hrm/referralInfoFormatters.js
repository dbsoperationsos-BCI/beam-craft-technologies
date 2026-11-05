import { instalmentLabel, isOverdue } from "./referralPayouts";

/**
 * A referral carries its instalments as a nested array, so the info panel summarises them rather
 * than printing the raw list. These live with the HRM module: the shared info panel formats what
 * every module has (dates, yes/no, images) and takes anything shaped like this as a formatter —
 * the same split the project module's shoot summaries use.
 */

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(value) {
  // `new Date(null)` is the epoch rather than an invalid date, so an instalment with no date would
  // otherwise read as 1 Jan 1970. Asked first, before anything tries to parse it.
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : day.format(date);
}

/** Every instalment, one per line: what it is worth, and where it has got to. */
function instalments(payouts) {
  if (!payouts.length) return "No instalments scheduled.";
  return payouts.map((payout) => {
    const state = payout.status === "Paid"
      ? `paid ${formatDate(payout.paidOn)}`
      : payout.status === "Cancelled"
        ? "cancelled"
        : `due ${formatDate(payout.dueOn)}${isOverdue(payout) ? " · overdue" : ""}`;
    return `${instalmentLabel(payout.monthOffset)} · ${rupees.format(Number(payout.amount) || 0)} · ${state}`;
  }).join("\n");
}

const referralInfoFormatters = {
  currency: (value) => rupees.format(Number(value) || 0),
  referralInstalments: (value) => instalments(Array.isArray(value) ? value : []),
};

export default referralInfoFormatters;
