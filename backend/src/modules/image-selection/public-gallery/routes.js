const express = require("express");
const { getMeta, verifyPin, startPreview, listFolders, listFolderImages, listSelected, submitSelection, updateSelection, clearSelection, thumbnail, preview, listPeople, listScenes } = require("./controller");

const { createRateLimiter, clientIp, hashedKey } = require("../../../middleware/rateLimit");

const router = express.Router();
// The lookup that opens a link is limited per address: plenty for a client reloading their page,
// far too few to walk the short codes looking for live ones.
const lookupLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keys: (req) => [`gallery-lookup:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
/*
 * The PIN is four digits - nine thousand guesses - and a right one is a 30-day session that can
 * change the client's picks, so wrong PINs are counted the way wrong passwords are: ten per link
 * from one address, thirty per link from anywhere, and only failures (`forgiveOn`), so a client
 * who types it right spends nothing. The address bucket is the lookup's studio-sized budget.
 */
const pinLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keys: (req) => {
    const link = hashedKey(req.params.token);
    const ip = clientIp(req);
    return [
      { key: `gallery-pin:${link}@${ip}`, max: 10, forgiving: true },
      { key: `gallery-pin:${link}`, max: 30, forgiving: true },
      { key: `gallery-pin-ip:${ip}`, max: 300 },
    ];
  },
  forgiveOn: (res) => res.statusCode < 300,
  message: (minutes) => `Too many PIN attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
router.get("/:token", lookupLimiter, getMeta);
router.post("/:token/verify-pin", pinLimiter, verifyPin);
// Answers for a short code just as the lookup does (and names the project), so it shares its budget.
router.post("/:token/preview-session", lookupLimiter, startPreview);
router.get("/:token/folders", listFolders);
// The People filter: who has been found in the gallery (or one folder of it). Read-only, and empty when the filter is off.
router.get("/:token/people", listPeople);
/*
 * The Scene filter: which scenes the culling run read in the gallery (or one shoot of it), with
 * counts. Photos no run has read are handed to the scene engine in the background on the first
 * ask, and the gallery polls while that goes on, so this one is budgeted per address: plenty for
 * a poll every few seconds across a few galleries, not enough to keep the engine fed from here.
 */
const scenesLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keys: (req) => [`gallery-scenes:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
router.get("/:token/scenes", scenesLimiter, listScenes);
router.get("/:token/selected", listSelected);
router.post("/:token/submit-selection", submitSelection);
router.get("/:token/folders/:folderId/images", listFolderImages);
router.post("/:token/images/:imageId/selection", updateSelection);
router.post("/:token/selection/clear", clearSelection);
router.get("/:token/images/:imageId/thumbnail", thumbnail);
router.get("/:token/images/:imageId/preview", preview);

module.exports = router;