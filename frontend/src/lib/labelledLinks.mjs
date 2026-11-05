/*
 * A list of links the studio adds under a label - a branch's External URLs (from a fixed set of
 * labels) and its Social Media Links (named freely) - as data: the shape a link is held to, what the
 * add dialog checks, what the form checks on save and what it sends. `LabelledLinksField` draws it;
 * the server holds the same rules (`modules/admin/branches/validation.js`).
 */

/**
 * The shape every link on the branch form is held to, as the server holds it: anything after an
 * optional http(s) scheme, so long as no other scheme (`javascript:`) comes before the address. A
 * link typed without `https://` is given it by the server when it is saved.
 */
export const LINK_PATTERN = /^(https?:\/\/)?[^\s/?#:]+\.[^\s]*$/i;
export const LINK_MESSAGE = "Enter a valid link, starting with https://.";

/** How many links a list may hold - the server's `MAX_CUSTOM_SOCIAL_LINKS`. */
export const MAX_LABELLED_LINKS = 10;

/**
 * What is wrong with a link about to be added, by field. A label must be given and must not be one
 * already used - by another added link or a fixed field in the same section (`reservedLabels`) - or
 * two rows could not be told apart. The link must be given and be a web address.
 */
export function newLinkProblems({ label, url }, { links = [], reservedLabels = [] } = {}) {
  const name = String(label || "").trim();
  const address = String(url || "").trim();
  const problems = {};
  const taken = [...reservedLabels, ...links.map((link) => link.label)].map((existing) => String(existing || "").trim().toLowerCase());
  if (!name) problems.label = "Name the link.";
  else if (taken.includes(name.toLowerCase())) problems.label = "There is already a link with this label.";
  if (!address) problems.url = "Enter the link.";
  else if (!LINK_PATTERN.test(address)) problems.url = LINK_MESSAGE;
  return problems;
}

/** One message per row on save, "" for a row that is fine - a row emptied since it was added is said. */
export function linkListErrors(links) {
  return (links || []).map((link) => {
    const url = String(link?.url || "").trim();
    if (!url) return "Enter the link, or remove this field.";
    return LINK_PATTERN.test(url) ? "" : LINK_MESSAGE;
  });
}

/** The list as the server takes it: `{ label, url }`, trimmed. */
export function linkListPayload(links) {
  return (links || []).map((link) => ({ label: String(link?.label || "").trim(), url: String(link?.url || "").trim() }));
}

/** A copy of a stored list for the form to edit, so typing never writes into the list the page holds. */
export function linkListOf(links) {
  return Array.isArray(links) ? links.map((link) => ({ label: link?.label || "", url: link?.url || "" })) : [];
}
