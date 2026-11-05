const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const c = require("./signatureAlbum.public.controller");

/*
 * /api/public/signature-albums - the client's album. No login: the short code names the album,
 * the PIN (rate limited, bcrypt) opens a scoped session of the album's own, and every route
 * re-resolves the album so a link taken down or expired stops answering at once. Kept apart from
 * the studio router above and from the selection gallery's public API: nothing here shares a
 * session, a scope or a handler with either.
 */
const router = express.Router();

// Printing the album's PDF is the one expensive thing the album does, so an address gets a handful
// of starts and fetches per album per quarter hour - enough to retry a download, not enough to keep
// the server printing for a stranger. Counted per album so one household's two albums do not share
// a budget. The status is asked every few seconds while a PDF is prepared, so it has a wider one.
const downloadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keys: (req) => [`signature-album-download:${clientIp(req)}:${String(req.params.token || "").toUpperCase()}`],
  message: (minutes) => `Too many download requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

const statusLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keys: (req) => [`signature-album-download-status:${clientIp(req)}:${String(req.params.token || "").toUpperCase()}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * The lookup that opens a link, and the PIN check, share one budget per address - plenty for a
 * client reloading the page, far too few to walk the short codes. Studio-sized, because behind one
 * office's router a whole household or studio is one address. Wrong PINs have their own tighter
 * count in the share service on top of this.
 */
const lookupLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keys: (req) => [`signature-album-lookup:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
// Reading the album pages a chapter in batches of as few as ten as the reader scrolls, so a large
// album asks hundreds of times in one sitting: a wider budget of its own.
const readLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  keys: (req) => [`signature-album-read:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

router.get("/:token", lookupLimiter, c.meta);
router.post("/:token/verify", lookupLimiter, c.verify);
router.get("/:token/content", readLimiter, c.content);
router.get("/:token/chapters/:chapterId/items", readLimiter, c.chapterItems);
// Download Album: the session starts the PDF (POST), asks until it is ready (GET status - answered
// with a ticket once it is), then the ticket fetches the one PDF file (GET).
router.post("/:token/download", downloadLimiter, c.startDownload);
router.get("/:token/download/status", statusLimiter, c.downloadStatus);
router.get("/:token/download", downloadLimiter, c.downloadAlbum);
// No limiter on the photos, as with the selection gallery's: every thumbnail and preview is a request,
// and one reader scrolling a several-thousand-photo album would run through any budget sized for
// a page. They answer only behind the album session (the cover alone without one).
router.get("/:token/images/:imageId/thumbnail", c.thumbnail);
router.get("/:token/images/:imageId/preview", c.preview);

module.exports = router;
