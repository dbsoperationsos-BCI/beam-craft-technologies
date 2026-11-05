const { createSettingsService } = require("./service");
const { appIcon, cachedAppIcon, isVariant: isAppIconVariant } = require("./appIcon");
const { settingsSchema, clientPageImagesSchema } = require("./validation");
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
    // The dark-theme pair travels with the light one: the top bar and the tab are public surfaces
    // too, and they are the ones that choose between the two.
    // The client sign-in's pictures are public for the same reason the login slides are.
    const { studioName, loginCredentialName, galleryLogoUrl, galleryLogoDarkUrl, loginSlides, clientLoginSlides, faviconUrl, faviconDarkUrl } = await service.read();
    return res.json({ data: { studioName, loginCredentialName, galleryLogoUrl, galleryLogoDarkUrl, loginSlides, clientLoginSlides, faviconUrl, faviconDarkUrl } });
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
    // Each mark travels on its own key, so the two Global Logo fields and the two tab marks are
    // stored, replaced or cleared independently: a dark mark picked alone touches nothing else.
    for (const key of ["galleryLogoUrl", "galleryLogoDarkUrl"]) {
      if (!(key in data)) continue;
      const stored = await storeImage(data[key], { folder: "image-selection/branding" });
      if (stored?.key) uploads.push(stored);
      data[key] = stored ? stored.url : null;
    }
    // The tab marks are stored as they were uploaded rather than compressed: see `storeFavicon`.
    // Cleared, a tab falls back to the other strip's mark, and then to the bundled one.
    for (const key of ["faviconUrl", "faviconDarkUrl"]) {
      if (!(key in data)) continue;
      const stored = await storeFavicon(data[key], { folder: "image-selection/branding/favicons" });
      if (stored?.key) uploads.push(stored);
      data[key] = stored ? stored.url : null;
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

/*
 * Settings → Project Management → Client page images, behind `SETTINGS / Client Page Images`
 * (`client-page-images.routes.js`). Only the list itself goes either way: the rest of the settings
 * record is the Organization permission's, which whoever keeps these pictures need not hold.
 */
async function getClientPageImages(req, res) {
  try {
    const { clientLoginSlides } = await service.read();
    return res.json({ data: { clientLoginSlides } });
  } catch (error) {
    return handleError(error, res, "load Client page images from");
  }
}

// Stored the way the login slides are: an existing link comes back untouched, a new picture is
// compressed and uploaded, and the order sent is the order shown.
async function saveClientPageImages(req, res) {
  const result = clientPageImagesSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: "Invalid Client page images.", errors: result.error.flatten() });
  let uploads = [];
  try {
    /*
     * A picture is either freshly picked (a `data:image/` URI, uploaded below) or one already saved
     * here, echoed back untouched. Nothing else: the list is published on the public branding and
     * shown to every client signing in, so a link to another site would let that site watch them
     * arrive, or swap the picture after it was approved.
     */
    const { clientLoginSlides: current } = await service.read();
    if (result.data.clientLoginSlides.some((slide) => !slide.startsWith("data:image/") && !current.includes(slide))) {
      return res.status(400).json({ message: "Pick each picture from your device - a link to another site cannot be used." });
    }
    const stored = await storeImages(result.data.clientLoginSlides, { folder: "image-selection/client-login-slides" });
    uploads = stored.filter((item) => item?.key);
    const { clientLoginSlides } = await service.save({ clientLoginSlides: stored.map((item) => item?.url).filter(Boolean) }, req.user.id);
    return res.json({ data: { clientLoginSlides } });
  } catch (error) {
    await discardUploads(uploads);
    return handleError(error, res, "save Client page images to");
  }
}

/*
 * The installed app's icon at one size, drawn from the favicon in Settings → Branding (see
 * `appIcon.js`). Public for the same reason as the branding above: a browser fetches it while
 * installing, before anybody has signed in. With no favicon set - or one this server cannot read or
 * draw - the bundled icon of the same name is sent instead, so an install always gets an icon.
 */
const BUNDLED_ICON_BASE = () => `${String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "")}/icons`;

const appIconVariant = (req) => String(req.params.variant || "").replace(/\.png$/i, "");

function sendAppIcon(res, variant, png) {
  if (png) {
    res.set("Content-Type", "image/png");
    // An hour is enough: the manifest names the favicon's version in the address, so a new upload
    // is a new address rather than a wait for this to expire.
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(png);
  }
  return res.redirect(302, `${BUNDLED_ICON_BASE()}/${variant}.png`);
}

/*
 * Ahead of the rate limit: an icon already drawn - or a favicon already known not to draw - costs
 * nothing to answer, so it is answered without being counted. Only a request that has to draw
 * reaches the limiter, which keeps a real install's icons from ever meeting it.
 */
function publicAppIconFromCache(req, res, next) {
  const variant = appIconVariant(req);
  if (!isAppIconVariant(variant)) return res.status(404).json({ message: "No such icon." });
  const known = cachedAppIcon(variant);
  return known ? sendAppIcon(res, variant, known.png) : next();
}

async function publicAppIcon(req, res) {
  const variant = appIconVariant(req);
  if (!isAppIconVariant(variant)) return res.status(404).json({ message: "No such icon." });
  try {
    return sendAppIcon(res, variant, await appIcon(variant));
  } catch (error) {
    console.error("Unable to draw the app icon from the favicon:", error.message);
    return sendAppIcon(res, variant, null);
  }
}

module.exports = { getSettings, saveSettings, publicStudioBranding, publicAppIcon, publicAppIconFromCache, getClientPageImages, saveClientPageImages };
