/**
 * What a quotation is called: `Quotation - Vertical - Branch - Client Name - Venue`.
 *
 *   Quotation - Dum Dum - Erode TN - Shanmugam & Parimala - Kongu Mahal
 *
 * The studio reads a quotation by its id when it needs to be exact and by this when it needs to
 * know which one it is looking at - the same job the generated WhatsApp group name does for a
 * booking, and built the same way: the facts in a fixed order, joined by one separator.
 *
 * ── Why it is stored rather than composed on every read ──
 *
 * A quotation is never rewritten - every edit raises the next version - so what a version was
 * called when it was sent is a fact about that version. Composing it on read would rename a
 * quotation already in a client's inbox the moment somebody corrected the branch on a later one,
 * or renamed a venue in the master data. The row keeps the name it was raised under.
 *
 * ── Missing parts ──
 *
 * Dropped, never left as an empty segment: a quotation raised before a venue was agreed reads
 * `Quotation - Dum Dum - Erode TN - Shanmugam & Parimala` rather than trailing a bare separator.
 * The word "Quotation" always leads, so a row is never nameless.
 */

const SEPARATOR = " - ";

/** One segment: trimmed, collapsed to single spaces, and empty where there is nothing to say. */
const part = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/*
 * ── Who the client is, which each vertical answers with a different field ─────────────────────
 *
 * The three verticals sell to different people and the quotation form asks accordingly: a wedding
 * has a groom and a bride, a Qua Qua shoot has a baby (or its mother), and a Corp job has a
 * company. Naming all three off the one shared **Enquire Name** box would put the enquirer on the
 * quotation where the studio reads the subject - "Quotation - Dum Dum - Erode TN - harish" for a
 * wedding everybody calls Shanmugam & Parimala.
 *
 * `name` stays the fallback, and it is what makes this safe: it is the one field every vertical
 * requires, so a quotation whose vertical fields were left empty still names its client.
 */
const CLIENT_BY_VERTICAL = {
  // Both, joined the way the WhatsApp group name joins them, so one couple reads the same in both
  // places. One without the other falls through - "Shanmugam &" is worse than the enquirer's name.
  "Dum Dum": (payload) => (part(payload.groomName) && part(payload.brideName) ? `${part(payload.groomName)} & ${part(payload.brideName)}` : ""),
  "Qua Qua": (payload) => part(payload.babyOrMotherName),
  Corp: (payload) => part(payload.companyName),
};

/** The client segment: the vertical's own answer, then the name every vertical asks for. */
function clientNameOf(payload, quotation) {
  const byVertical = CLIENT_BY_VERTICAL[part(payload.vertical || quotation.vertical)];
  return (byVertical ? byVertical(payload) : "") || part(payload.name) || part(quotation.clientName) || part(payload.clientName);
}

/**
 * The name for one quotation, from the columns it stores and the payload it was raised from.
 *
 * Both are read because they answer different halves. The vertical lives only in the payload - a
 * quotation's client fields differ per vertical, so it is the one thing every quotation carries
 * there - while the branch is a column the register filters on. The client's name is the vertical's
 * own answer - the couple, the baby, the company - falling back to the Enquire Name every vertical
 * asks for and then to `clientName`, which is what quotations raised before the vertical forms
 * existed stored. See `clientNameOf`.
 */
function buildQuotationName(quotation = {}) {
  const payload = quotation.payload || {};
  const segments = [
    part(payload.vertical || quotation.vertical),
    part(quotation.sourceBranch || payload.sourceBranch || payload.nearestBranch),
    clientNameOf(payload, quotation),
    part(quotation.eventVenue || payload.eventVenue),
  ].filter(Boolean);
  return ["Quotation", ...segments].join(SEPARATOR);
}

module.exports = { buildQuotationName, QUOTATION_NAME_SEPARATOR: SEPARATOR };
