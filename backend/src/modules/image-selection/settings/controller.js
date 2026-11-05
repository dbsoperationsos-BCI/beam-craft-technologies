const { createSettingsService } = require("./service");
const { settingsSchema } = require("./validation");
const { storeImage, storeFavicon, storeImages, discardUploads } = require("../../../services/imageStorage");

const service = createSettingsService();

// Branding and the studio-wide numbers apply to every project at once, so changing them is a Super
// Admin action. Reading is not: the gallery, the deliverable list and the invite all need these
// values, and any signed-in user working on a project has to be able to see what they are.
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.

function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Unable to ${action} Image Selection settings:`, error);
  return res.status(500).json({ message: `Unable to ${action} Image Selection settings.` });
}

async function getSettings(req, res) {
  try {
    return res.json({ data: await service.read() });
  } catch (error) {
    return handleError(error, res, "load");
  }
}

// The logo and studio name are intentionally public: client galleries, quotations and CRD forms
// are opened through a link rather than a login. Do not expose the rest of this settings record;
// it includes studio operational choices such as storage paths.
async function publicStudioBranding(req, res) {
  try {
    // The login slides are public by nature - the sign-in page shows them before anyone signs in.
    /*
     * `loginCredentialName` is here because it is the domain every login address is issued under,
     * and the credentials page has to propose one. It is the same class of value as the studio's
     * name - something the studio publishes rather than keeps - and a mail domain is public by
     * construction: it is the half of every address after the @. The full settings record stays
     * behind ADMIN / System Settings, which is a permission whoever onboards an employee need not
     * have; reading it there would have made the proposal unavailable to exactly the people who
     * make accounts.
     */
    const { studioName, loginCredentialName, galleryLogoUrl, loginSlides, faviconUrl } = await service.read();
    return res.json({ data: { studioName, loginCredentialName, galleryLogoUrl, loginSlides, faviconUrl } });
  } catch (error) {
    return handleError(error, res, "load public Studio Branding");
  }
}

async function saveSettings(req, res) {
  const result = settingsSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: "Invalid Image Selection settings.", errors: result.error.flatten() });

  // Every field the schema answers, kept only where the request itself named the key. A
  // nullish().transform() field (studioName, galleryLogoUrl, the two paths) answers every key
  // regardless of whether the caller supplied it, so the schema alone cannot tell "left out" from
  // "explicitly cleared" -- that distinction is read from the raw body instead. This is what lets
  // Login Slide save its pictures without restating the numbers, the paths, the name or the logo,
  // and what stops it from wiping any of them.
  const providedKeys = new Set(Object.keys(req.body || {}));
  const data = Object.fromEntries(Object.entries(result.data).filter(([key]) => providedKeys.has(key)));

  // The logo arrives from the browser as a compressed data URI and is uploaded here, exactly as an
  // asset photo is. `storeImage` returns an existing https link untouched, so re-saving the form
  // without picking a new logo does not re-upload the one already stored.
  const uploads = [];
  try {
    if ("galleryLogoUrl" in data) {
      const stored = await storeImage(data.galleryLogoUrl, { folder: "image-selection/branding" });
      if (stored?.key) uploads.push(stored);
      data.galleryLogoUrl = stored ? stored.url : null;
    }
    // The tab mark is stored as it was uploaded rather than compressed: see `storeFavicon`.
    // Cleared, it falls back to the bundled pair.
    if ("faviconUrl" in data) {
      const stored = await storeFavicon(data.faviconUrl, { folder: "image-selection/branding/favicons" });
      if (stored?.key) uploads.push(stored);
      data.faviconUrl = stored ? stored.url : null;
    }
    // The login slides travel the same way, each one: an existing link comes back untouched, a
    // new picture is compressed and uploaded, and the order sent is the order shown.
    if (Array.isArray(data.loginSlides)) {
      const stored = await storeImages(data.loginSlides, { folder: "image-selection/login-slides" });
      uploads.push(...stored.filter((item) => item?.key));
      data.loginSlides = stored.map((item) => item?.url).filter(Boolean);
    }
    return res.json({ data: await service.save(data, req.user.id) });
  } catch (error) {
    // A save that fails after the logo is in the bucket would otherwise leave an orphan behind.
    await discardUploads(uploads);
    return handleError(error, res, "save");
  }
}

module.exports = { getSettings, saveSettings, publicStudioBranding };
