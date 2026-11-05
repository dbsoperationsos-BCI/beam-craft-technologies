
/**
 * How a quotation link's five days read on screen.
 *
 * Every version carries its own clock, so the same three questions are asked in the register, in
 * the share dialog and in the version history: is it open, until when, and how long is left. They
 * are answered here once rather than three times over.
 */

/** How long a fresh or re-enabled link opens for. Matches the backend's own five days. */
export const QUOTATION_LINK_VALIDITY_DAYS = 5;

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * The only two states a version has (`finalization.state`, from the backend's
 * `QUOTATION_FINALIZATION`), each version on its own: FINALIZED - read-only, its link never
 * expiring, at most one per quotation - or UNFINALIZED, every other version, which can be edited.
 */
export const QUOTATION_FINALIZATION = Object.freeze({ FINALIZED: "FINALIZED", UNFINALIZED: "UNFINALIZED" });

export const isFinalizedQuotation = (version) => version?.finalization?.state === QUOTATION_FINALIZATION.FINALIZED;

export function isLinkActive(version) {
  // A finalized version's link has no clock to run out: the server says so, and sends no date.
  if (version?.linkNeverExpires) return true;
  const expiry = version?.linkExpiresAt ? new Date(version.linkExpiresAt) : null;
  return Boolean(expiry) && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now();
}

/**
 * The status a quotation saved with Save Draft carries until it is generated. A draft has no live
 * link - nothing has been sent - so it is never "Expired" either; the backend's `QUOTATION_STATUS`.
 */
export const QUOTATION_DRAFT_STATUS = "Draft";

export const isDraftQuotation = (quotation) => quotation?.status === QUOTATION_DRAFT_STATUS;

/** "Live", "Expired", or "Not sent" for a draft — the one word the register's Link column shows. */
export function linkStatusLabel(version) {
  if (isDraftQuotation(version)) return "Not sent";
  if (version?.linkNeverExpires) return "Live (finalized)";
  return isLinkActive(version) ? "Live" : "Expired";
}

/**
 * The whole sentence: "Live · expires 8 Sep 2026, 14:20 (4 days left)", or why it does not open.
 *
 * Days are counted by rounding up, so a link with anything left of its last day says "1 day left"
 * rather than "0 days left" on a link that still works.
 */
export function linkExpiryText(version) {
  if (version?.linkNeverExpires) return "Live · never expires — this version is finalized.";
  const expiry = version?.linkExpiresAt ? new Date(version.linkExpiresAt) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) return "Expired — this version has no live link.";
  if (expiry.getTime() <= Date.now()) return `Expired on ${dateTime.format(expiry)}.`;
  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return `Live · expires ${dateTime.format(expiry)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`;
}

/**
 * A version's status as a badge: Finalized green (the one state a project may be booked at, and
 * read-only), Unfinalized grey. One wording and one colour wherever a version's status is shown.
 */
export function quotationVersionStatus(version) {
  return isFinalizedQuotation(version) ? { label: "Finalized", tone: "success" } : { label: "Unfinalized", tone: "neutral" };
}

/** "Version 03", from either a chain row or one of its versions. */
export function versionLabel(version) {
  return `Version ${String(version?.version ?? 1).padStart(2, "0")}`;
}
