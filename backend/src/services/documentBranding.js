const { createSettingsService } = require("../modules/image-selection/settings/service");

/**
 * The brand a document was issued under, frozen at the moment it was issued.
 *
 * The application's live surfaces — the sign-in page, the app bar, a client's selection gallery —
 * follow Settings → Global Logo the moment it changes, and should. A document does not. A quotation
 * a client was sent last spring, a CRD document a couple filled in before the studio rebranded, is
 * a record of what was actually issued, and it keeps showing the mark it was issued with however
 * many times the logo in Settings changes afterwards. Only a document created *after* the change
 * carries the new mark.
 *
 * So there are two halves, and every document type uses both:
 *
 * - `snapshotDocumentBranding()` is called once, when a document row is *created*, and returns the
 *   columns to write onto it — the current Global Logo copied into the record.
 * - `brandingForDocument(row)` is what every reader of an existing document asks, and it answers
 *   from the row alone. It never reads Settings, so a stored document cannot drift.
 *
 * A row written before these columns existed has no snapshot. It answers `null`, and the page
 * showing it renders the bundled default mark — never the current Settings logo, which would be
 * whichever logo happens to be configured today rather than anything that document was sent with.
 */

const settings = createSettingsService();

/**
 * The branding columns to write onto a document being created right now.
 *
 * Reads Settings once. Not cached: a document raised a second after the logo is saved must carry
 * the new one, which is the whole rule.
 */
async function snapshotDocumentBranding(reader = settings) {
  const { galleryLogoUrl } = await reader.read();
  return { logoUrl: galleryLogoUrl || null };
}

/**
 * What a stored document should show. Answers only from the row, by design — see above.
 * `null` means the reader shows the bundled default mark.
 */
function brandingForDocument(row) {
  return { logoUrl: row?.logoUrl || null };
}

module.exports = { snapshotDocumentBranding, brandingForDocument };
