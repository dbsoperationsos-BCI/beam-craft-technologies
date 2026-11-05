const repository = require("./repository");

/**
 * The values every Image Selection project shares.
 *
 * These are exactly the numbers and strings that used to be hard-coded in `publication/`,
 * `deliverables/` and `publish-share/`, so a database with no settings row behaves precisely as the
 * module did before this table existed — nothing has to be seeded for the studio to keep working.
 */
const DEFAULTS = {
  galleryValidityMonths: 6,
  defaultSelectionLimit: 50,
  // Where the studio's masters live and where selected copies are written, both on the machine
  // running this backend. Null means the feature is not configured: originals cannot be registered
  // and selections cannot be copied out until a Super Admin sets them.
  originalStoragePath: null,
  selectedOutputPath: null,
  studioName: "Don't Blink Studios",
  loginCredentialName: null,
  galleryLogoUrl: null,
  faviconUrl: null,
  // The login page's pictures; none means the page shows its plain slides.
  loginSlides: [],
};

// The column is JSON, so whatever is stored is read back as-is; only a list of strings is a list
// of slides, and a null column is no slides at all.
const asSlides = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : []);

const MIN_VALIDITY_MONTHS = 1;
const MAX_VALIDITY_MONTHS = 60;
const MAX_ROOT_PATH_LENGTH = 500;

function createSettingsService(repo = repository) {
  /**
   * Reading never writes. Every published gallery, every deliverable list and every WhatsApp invite
   * goes through here, so creating the row on read would mean a write on paths that are otherwise
   * read-only — and the defaults are the same answer the row would have held anyway.
   */
  async function read() {
    const stored = await repo.find();
    const merged = { ...DEFAULTS, ...(stored || {}) };
    return { ...merged, loginSlides: asSlides(merged.loginSlides) };
  }

  // A field the request leaves out is left as it was: the Global Logo form does not carry the
  // login slides and the Login Slide form does not carry the paths, and neither may reset the other.
  async function save(input, userId) {
    const saved = await repo.upsert({ ...input, updatedByUserId: userId ?? null });
    const merged = { ...DEFAULTS, ...saved };
    return { ...merged, loginSlides: asSlides(merged.loginSlides) };
  }

  return { read, save };
}

module.exports = { createSettingsService, DEFAULTS, MIN_VALIDITY_MONTHS, MAX_VALIDITY_MONTHS, MAX_ROOT_PATH_LENGTH };
