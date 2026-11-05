const express = require("express");
const { createRateLimiter, clientIp, networkOf } = require("../../../middleware/rateLimit");
const c = require("./controller");
const webhook = require("../payments/webhook");

/**
 * The guest store, mounted at /api/public/photo-selling. No staff JWT: the link's code names the
 * store; a store session, an order key or a download ticket does the rest (shared/security.js).
 * There is deliberately no route that lists a gallery's photos: a guest sees only what their selfie
 * matched (search/service.js). An original is reached only through a paid order's single-use
 * download ticket.
 *
 * Every route is rate limited per address (an IPv6 /64 counts as one address). The costly or sensitive ones - a PIN, a checkout, a
 * selfie - have tight buckets of their own; picture addresses have a wide one, because a gallery
 * page asks for a tile per photo.
 */
const router = express.Router();
const again = (minutes) => `Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
const limiter = (name, windowMinutes, max, message = "Too many requests.") => createRateLimiter({ windowMs: windowMinutes * 60 * 1000, max, keys: (req) => [`photo-sale-${name}:${networkOf(clientIp(req))}`], message: (minutes) => `${message} ${again(minutes)}` });

// Cashfree's notifications: signature-checked over the raw body (payments/webhook.js).
router.use("/webhooks/cashfree", limiter("webhook", 15, 3000), webhook);
router.get("/w/:photoId/:hash/:variant", limiter("picture", 15, 6000), c.watermarkedCopy);
router.get("/download/:itemId", limiter("download", 15, 600, "Too many downloads."), c.download);

router.use(limiter("store", 15, 900));
router.get("/:code", c.getMeta);
router.post("/:code/session", limiter("session", 15, 40, "Too many attempts."), c.openSession);
router.post("/:code/cart/quote", c.quote);
router.post("/:code/checkout", limiter("checkout", 60, 30, "Too many checkouts."), c.checkout);
router.get("/:code/orders", c.myOrders);
router.get("/:code/orders/:orderRef", c.getOrder);
router.post("/:code/orders/:orderRef/pay", limiter("pay", 60, 40, "Too many payment attempts."), c.payOrder);
router.post("/:code/orders/:orderRef/items/:itemId/download", limiter("ticket", 15, 600, "Too many downloads."), c.downloadTicket);
router.post("/:code/selfie-search", limiter("selfie", 60, 20, "Too many selfie searches."), c.selfieCreate);
router.get("/:code/selfie-search/latest", c.selfieLatest);
router.get("/:code/selfie-search/:searchId", c.selfieGet);
router.delete("/:code/selfie-search/:searchId", c.selfieDelete);
// The guest's name and WhatsApp number (no code is sent), their choice to be told, and their kept matches.
router.get("/:code/guest", c.guestGet);
router.put("/:code/guest", limiter("guest", 15, 40, "Too many attempts."), c.guestRegister);
router.delete("/:code/guest/whatsapp", c.guestStop);
router.get("/:code/guest/photos", c.guestPhotos);
// The guest's own selfies (up to ten): list, each one's private thumbnail, and remove.
router.get("/:code/guest/selfies", c.guestSelfies);
router.get("/:code/guest/selfies/:selfieId/thumbnail", c.guestSelfieThumbnail);
router.delete("/:code/guest/selfies/:selfieId", c.guestSelfieRemove);

module.exports = router;
