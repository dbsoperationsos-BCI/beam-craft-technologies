
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

export function isLinkActive(version) {
  const expiry = version?.linkExpiresAt ? new Date(version.linkExpiresAt) : null;
  return Boolean(expiry) && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now();
}

/** "Live" or "Expired" — the one word the register's Link column shows. */
export function linkStatusLabel(version) {
  return isLinkActive(version) ? "Live" : "Expired";
}

/**
 * The whole sentence: "Live · expires 8 Sep 2026, 14:20 (4 days left)", or why it does not open.
 *
 * Days are counted by rounding up, so a link with anything left of its last day says "1 day left"
 * rather than "0 days left" on a link that still works.
 */
export function linkExpiryText(version) {
  const expiry = version?.linkExpiresAt ? new Date(version.linkExpiresAt) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) return "Expired — this version has no live link.";
  if (expiry.getTime() <= Date.now()) return `Expired on ${dateTime.format(expiry)}.`;
  const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return `Live · expires ${dateTime.format(expiry)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`;
}

/** "Version 03", from either a chain row or one of its versions. */
export function versionLabel(version) {
  return `Version ${String(version?.version ?? 1).padStart(2, "0")}`;
}
