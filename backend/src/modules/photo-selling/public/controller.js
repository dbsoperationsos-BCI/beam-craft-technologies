const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const orders = require("../orders/service");
const watermarks = require("../watermarks/service");
const storage = require("../../ai-feature/shared/storage");
const security = require("../shared/security");
const v = require("../shared/validation");
const { clientIp, networkOf } = require("../../../middleware/rateLimit");
const { validate, route, handleError } = require("../../ai-feature/shared/http");

const CODE = /^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9]{4,8})$/;
const codeParams = z.object({ code: z.string().regex(CODE) });
const orderParams = codeParams.extend({ orderRef: v.publicOrderParams.shape.orderRef });
const itemParams = orderParams.extend({ itemId: z.string().trim().min(1).max(191) });
const searchParams = codeParams.extend({ searchId: z.string().trim().min(1).max(191) });
const selfieParams = codeParams.extend({ selfieId: z.string().trim().min(1).max(191) });
// The store's first screen, as the AI Feature's join card: name and WhatsApp number always, the PIN where set.
const sessionBody = z.object({
  pin: z.string().trim().regex(/^\d{4}$/, "Enter the 4-digit PIN.").optional(),
  name: z.string().trim().min(1, "Enter your name.").max(191),
  phone: z.string().trim().min(6, "Enter your WhatsApp number.").max(30),
  whatsappConsent: z.boolean().optional(),
}).strict();
// A guest's name and WhatsApp number, before the selfie; the number is checked by guests.register.
const guestBody = z.object({ name: z.string().trim().min(1, "Enter your name.").max(191), phone: z.string().trim().min(6, "Enter your WhatsApp number.").max(30), whatsappConsent: z.boolean() }).strict();
const consentField = z.object({ consent: z.literal("true", { errorMap: () => ({ message: "Please agree to the face search first." }) }) });

const selfieUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2 } }).single("selfie");
const notFound = (res) => res.status(404).json({ message: "Gallery not found." });
/** The order credentials a request carries: this device's session, or the order key in a header. */
const credentials = (req) => ({ authHeader: req.headers.authorization, orderKey: req.headers["x-order-key"] ? String(req.headers["x-order-key"]) : null });

const withCode = (schema, action, handler) => route(action, async (req, res) => {
  const p = schema.safeParse(req.params);
  if (!p.success) return notFound(res);
  return handler(p.data, req, res);
});

const getMeta = withCode(codeParams, "load gallery", async (p, _req, res) => { res.json({ data: await service.meta(p.code) }); });
const openSession = withCode(codeParams, "open gallery", async (p, req, res) => { const b = validate(sessionBody, req.body || {}, res, "Please check your details."); if (!b) return; res.json({ data: await service.openSession(p.code, b, networkOf(clientIp(req))) }); });
const quote = withCode(codeParams, "price your cart", async (p, req, res) => { const b = validate(v.quote, req.body || {}, res); if (!b) return; res.json({ data: await service.quote(p.code, req.headers.authorization, b) }); });
const checkout = withCode(codeParams, "start checkout", async (p, req, res) => { const b = validate(v.checkout, req.body || {}, res, "Please check your details."); if (!b) return; res.status(201).json({ data: await service.checkout(p.code, req.headers.authorization, b) }); });
const myOrders = withCode(codeParams, "load your orders", async (p, req, res) => { res.json({ data: await service.myOrders(p.code, req.headers.authorization) }); });
const getOrder = withCode(orderParams, "load order", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.order(p.code, p.orderRef, credentials(req)) }); });
const payOrder = withCode(orderParams, "start payment", async (p, req, res) => { res.json({ data: await service.pay(p.code, p.orderRef, credentials(req)) }); });
const downloadTicket = withCode(itemParams, "prepare download", async (p, req, res) => { res.json({ data: await service.downloadTicket(p.code, p.orderRef, p.itemId, credentials(req)) }); });
const selfieGet = withCode(searchParams, "load search", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.selfieGet(p.code, req.headers.authorization, p.searchId) }); });
const selfieLatest = withCode(codeParams, "load your search", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.selfieLatest(p.code, req.headers.authorization) }); });
const guestGet = withCode(codeParams, "load your details", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.guestGet(p.code, req.headers.authorization) }); });
const guestRegister = withCode(codeParams, "save your details", async (p, req, res) => { const b = validate(guestBody, req.body || {}, res, "Please check your details."); if (!b) return; res.json({ data: await service.guestRegister(p.code, req.headers.authorization, b) }); });
const guestStop = withCode(codeParams, "stop WhatsApp messages", async (p, req, res) => { res.json({ data: await service.guestStop(p.code, req.headers.authorization) }); });
const guestPhotos = withCode(codeParams, "load your photos", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.guestPhotos(p.code, req.headers.authorization) }); });
const guestSelfies = withCode(codeParams, "load your selfies", async (p, req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await service.guestSelfies(p.code, req.headers.authorization) }); });
const guestSelfieThumbnail = withCode(selfieParams, "load your selfie", async (p, req, res) => {
  const object = await service.guestSelfieThumbnail(p.code, req.headers.authorization, p.selfieId);
  res.set({ "Content-Type": object.contentType, "Cache-Control": "private, no-store" });
  if (object.contentLength != null) res.set("Content-Length", String(object.contentLength));
  object.body.pipe(res);
});
const guestSelfieRemove = withCode(selfieParams, "remove your selfie", async (p, req, res) => { res.json({ data: await service.guestSelfieRemove(p.code, req.headers.authorization, p.selfieId) }); });
const selfieDelete = withCode(searchParams, "delete search", async (p, req, res) => { res.json({ data: await service.selfieDelete(p.code, req.headers.authorization, p.searchId) }); });

/**
 * The selfie is read into memory by multer, described, and dropped - see search/service.js. The
 * session and the store's selfie switch are checked first, so a request that may not search never
 * gets as far as uploading.
 */
const selfieCreate = async (req, res) => {
  const p = codeParams.safeParse(req.params);
  if (!p.success) return notFound(res);
  try { await service.selfiePreflight(p.data.code, req.headers.authorization); } catch (error) { return handleError(error, res, "search by selfie"); }
  return selfieUploadThen(req, res);
};
const selfieUploadThen = (req, res) => selfieUpload(req, res, (error) => {
  if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "That photo is too large. Please use one under 8 MB." : "Upload rejected." });
  return withCode(codeParams, "search by selfie", async (p, request, response) => {
    const consent = consentField.safeParse(request.body || {});
    if (!consent.success) return response.status(400).json({ message: "Please agree to the face search before uploading a selfie." });
    response.status(201).json({ data: await service.selfieCreate(p.code, request.headers.authorization, request.file, true) });
  })(req, res);
});

/** A watermarked copy by signed address: a redirect to the stored copy, drawn first if need be. */
async function watermarkedCopy(req, res) {
  try {
    const { photoId, hash, variant } = req.params;
    if (!/^[a-f0-9]{64}$/.test(String(hash)) || !watermarks.VARIANTS.has(variant) || !watermarks.verify(photoId, hash, req.query.s, req.query.e)) return res.status(404).end();
    const copy = await watermarks.copyFor(photoId, hash);
    const key = copy ? (variant === "thumbnail" ? copy.thumbnailKey || copy.previewKey : copy.previewKey) : null;
    if (!key) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=3600");
    return res.redirect(302, storage.publicUrl(key));
  } catch (error) {
    return handleError(error, res, "load photo");
  }
}

/**
 * A purchased original, streamed from the originals store through this server - its storage key and
 * the bucket are never revealed. The ticket names one item, expires in minutes and is used up here.
 */
async function download(req, res) {
  let file;
  try {
    const itemId = String(req.params.itemId || "").slice(0, 191);
    file = await orders.openDownload(itemId, req.query.t, security.hash(clientIp(req)));
  } catch (error) {
    return handleError(error, res, "download photo");
  }
  res.set({ "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (file.contentLength != null) res.set("Content-Length", String(file.contentLength));
  const done = (ok, error) => file.finish(ok, error).catch((failure) => console.error("[photo-selling] download record failed:", failure.message));
  file.body.on("error", (error) => { done(false, error.message); res.destroy(error); });
  res.on("close", () => {
    if (!res.writableFinished) file.body.destroy();
    done(res.writableFinished, res.writableFinished ? null : "Connection closed before the photo was sent");
  });
  return file.body.pipe(res);
}

module.exports = { getMeta, openSession, quote, checkout, myOrders, getOrder, payOrder, downloadTicket, selfieCreate, selfieGet, selfieLatest, selfieDelete, guestGet, guestRegister, guestStop, guestPhotos, guestSelfies, guestSelfieThumbnail, guestSelfieRemove, watermarkedCopy, download };
