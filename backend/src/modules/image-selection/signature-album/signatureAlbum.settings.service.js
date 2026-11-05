const { repository } = require("./signatureAlbum.repository");
const { DEFAULT_ENDING_MESSAGE, DEFAULT_FOOTER_TEXT } = require("./signatureAlbum.constants");

/*
 * The studio-wide Signature Album defaults: Settings → Image Selection → Signature Album.
 *
 * Read when an album is *created*, and by the client page for the values that are the same for
 * every album (batch sizes, branding switches, the ending's links). Never pushed onto an album
 * already made: an album that was started Editorial stays Editorial when the default becomes
 * Minimal, because the album row holds its own copy of everything a project may override.
 *
 * Reading never writes - the defaults are the same answer the row would hold - and a field the
 * request leaves out is left as it was, so the panel can save one section at a time.
 */
const DEFAULTS = {
  defaultTheme: "EDITORIAL",
  defaultLayoutStyle: "CURATED",
  defaultCoverStyle: "FULL_SCREEN",
  defaultExpiryMonths: 6,
  useGlobalLogo: true,
  showStudioName: true,
  showStudioLogo: true,
  showBrandingFooter: true,
  footerText: null,
  allowDownloadDefault: true,
  allowShareDefault: true,
  showImageNumbers: false,
  requirePin: true,
  pinLength: 4,
  autoUnpublishAfterExpiry: true,
  defaultBackground: "WHITE",
  imageSpacing: "STANDARD",
  initialPhotosLoaded: 30,
  lazyLoadBatch: 30,
  preloadNextImages: true,
  defaultEndingMessage: null,
  endingShowLogo: true,
  endingShowWebsite: true,
  endingShowInstagram: true,
  websiteUrl: null,
  instagramUrl: null,
};

function createSignatureAlbumSettingsService(repo = repository) {
  function withShippedText(row) {
    return { ...row, effectiveFooterText: row.footerText || DEFAULT_FOOTER_TEXT, effectiveEndingMessage: row.defaultEndingMessage || DEFAULT_ENDING_MESSAGE };
  }
  async function read() {
    const stored = await repo.findSettings();
    const { id, createdAt, updatedAt, updatedByUserId, ...rest } = stored || {};
    return withShippedText({ ...DEFAULTS, ...rest, updatedAt: updatedAt || null });
  }
  async function save(input, userId) {
    const saved = await repo.upsertSettings({ ...input, updatedByUserId: userId ?? null });
    const { id, createdAt, updatedAt, updatedByUserId, ...rest } = saved;
    return withShippedText({ ...DEFAULTS, ...rest, updatedAt });
  }
  return { read, save };
}

module.exports = { createSignatureAlbumSettingsService, DEFAULTS };
