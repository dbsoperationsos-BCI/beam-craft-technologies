const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const watermarks = require("../watermarks/service");
const storage = require("../shared/storage");
const { clientIp } = require("../../../middleware/rateLimit");
const { validate, route } = require("../shared/http");
const { uploadFieldsSchema, sourceOf } = require("../media/uploadIntake");
const { CLIENT_THUMBNAIL_MAX_BYTES } = require("../media/derivatives");

const codeParams = z.object({ code: z.string().regex(/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9]{4,8})$/) });
const matchParams = codeParams.extend({ matchId: z.string().trim().min(1).max(191) });
const selfieParams = codeParams.extend({ selfieId: z.string().trim().min(1).max(191) });
const joinBody = z.object({ name: z.string().trim().max(191).optional(), phone: z.string().trim().max(30).optional(), pin: z.string().regex(/^\d{4}$/).optional(), rsvp: z.enum(["ACCEPTED", "DECLINED"]).optional() });
const rsvpBody = z.object({ rsvp: z.enum(["ACCEPTED", "DECLINED", "PENDING"]) });
const verifyBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });
// The join code step: the challenge `join` handed back names the guest; nothing here names a phone.
const challengeBody = z.object({ challenge: z.string().trim().min(20).max(2000) });
const joinVerifyBody = challengeBody.extend({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."), rsvp: z.enum(["ACCEPTED", "DECLINED"]).optional() });
const pageQuery = z.object({ folderId: z.string().trim().min(1).max(191).optional(), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(60) });

const selfieUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single("selfie");
// A guest's photo, plus the optional thumbnail the event page cut beside it when it optimized the
// photo on the phone, and the same source fields a staff client sends (media/uploadIntake.js).
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 2, fields: 8 } }).fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]);
const notFound = (res) => res.status(404).json({ message: "Event link not found." });

const getMeta = route("load event", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.meta(p.data.code) }); });
const join = route("join event", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(joinBody, req.body || {}, res, "Please check the details you entered."); if (!b) return; const data = await service.join(p.data.code, b, clientIp(req), req.headers.authorization); res.locals.codeSent = Boolean(data?.verificationRequired && !data.notice); res.json({ data }); });
const joinVerify = route("verify join", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(joinVerifyBody, req.body || {}, res, "Enter the 6-digit code."); if (!b) return; res.json({ data: await service.joinVerify(p.data.code, b) }); });
const joinResend = route("resend join code", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(challengeBody, req.body || {}, res, "That code has expired. Please join again."); if (!b) return; const data = await service.joinResend(p.data.code, b); res.locals.codeSent = true; res.json({ data }); });
const me = route("load guest", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.me(p.data.code, req.headers.authorization) }); });
const rsvp = route("update rsvp", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(rsvpBody, req.body, res); if (!b) return; res.json({ data: await service.rsvp(p.data.code, req.headers.authorization, b.rsvp) }); });
const folders = route("load gallery folders", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.folders(p.data.code, req.headers.authorization) }); });
const gallery = route("load gallery", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const q = validate(pageQuery, req.query, res); if (!q) return; res.json({ data: await service.gallery(p.data.code, req.headers.authorization, q) }); });
const myPhotos = route("load my photos", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const q = validate(pageQuery, req.query, res); if (!q) return; res.json({ data: await service.myPhotos(p.data.code, req.headers.authorization, q) }); });
const whatsappCode = route("send verification code", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const data = await service.whatsappCode(p.data.code, req.headers.authorization); res.locals.codeSent = true; res.json({ data }); });
const whatsappVerify = route("verify phone", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(verifyBody, req.body || {}, res, "Enter the 6-digit code."); if (!b) return; res.json({ data: await service.whatsappVerify(p.data.code, req.headers.authorization, b.code) }); });
const whatsappConsent = route("turn on whatsapp summary", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.whatsappConsent(p.data.code, req.headers.authorization) }); });
const whatsappStop = route("stop whatsapp summary", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.whatsappStop(p.data.code, req.headers.authorization) }); });
const listSelfies = route("load your selfies", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.set("Cache-Control", "no-store"); res.json({ data: await service.selfies(p.data.code, req.headers.authorization) }); });
const selfieThumbnail = route("load your selfie", async (req, res) => {
  const p = selfieParams.safeParse(req.params);
  if (!p.success) return notFound(res);
  const object = await service.selfieThumbnail(p.data.code, req.headers.authorization, p.data.selfieId);
  res.set({ "Content-Type": object.contentType, "Cache-Control": "private, no-store" });
  if (object.contentLength != null) res.set("Content-Length", String(object.contentLength));
  object.body.pipe(res);
});
const removeSelfie = route("remove your selfie", async (req, res) => { const p = selfieParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.removeSelfie(p.data.code, req.headers.authorization, p.data.selfieId) }); });
const rejectMatch = route("reject match", async (req, res) => { const p = matchParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.rejectMatch(p.data.code, req.headers.authorization, p.data.matchId) }); });

const withUpload = (upload, action, handler) => (req, res) => upload(req, res, (error) => {
  if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "That file is too large." : "Upload rejected." });
  return route(action, async () => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await handler(p.data.code, req) }); })(req, res);
});
const selfie = withUpload(selfieUpload, "find my photos", (code, req) => service.selfie(code, req.headers.authorization, req.file, req.body?.source));
const guestUpload = withUpload(photoUpload, "upload photo", (code, req) => {
  // Only what describes the source is read off a guest's form: a guest never names a folder and
  // never defers the face pass, whatever the form says; the service then keeps only the name, the
  // capture time and the optimized claim of it (public/service.guestUpload). A thumbnail past the
  // size the passthrough would take is dropped here rather than carried into the service.
  const parsed = uploadFieldsSchema.safeParse(req.body || {});
  const source = parsed.success ? sourceOf(parsed.data) : null;
  const thumbnail = req.files?.thumbnail?.[0];
  return service.guestUpload(code, req.headers.authorization, req.files?.file?.[0], { source, thumbnail: thumbnail && thumbnail.size <= CLIENT_THUMBNAIL_MAX_BYTES ? thumbnail : null });
});

/**
 * A watermarked copy by its signed address (`watermarks.copyPath`): drawn now if the worker has not
 * got to it, then a redirect to the stored copy. Anything wrong - a bad signature, a photo gone, a
 * look no longer in use, a drawing that failed - is a 404, so the tile stays empty.
 */
const copyParams = z.object({ mediaId: z.string().trim().min(1).max(191), hash: z.string().regex(/^[0-9a-f]{64}$/), variant: z.enum(["preview", "thumbnail"]) });
const watermarkedCopy = route("load watermarked photo", async (req, res) => {
  const p = copyParams.safeParse(req.params);
  if (!p.success || !watermarks.verifyCopy(p.data.mediaId, p.data.hash, req.query.s)) return res.status(404).json({ message: "Not found." });
  const copy = await watermarks.drawOnDemand(p.data.mediaId, p.data.hash);
  if (!copy) return res.status(404).json({ message: "Not found." });
  const key = p.data.variant === "thumbnail" ? (copy.thumbnailKey || copy.previewKey) : copy.previewKey;
  res.set("Cache-Control", "private, max-age=3600").redirect(302, storage.publicUrl(key));
});

module.exports = { listSelfies, selfieThumbnail, removeSelfie, watermarkedCopy, getMeta, join, joinVerify, joinResend, me, rsvp, whatsappCode, whatsappVerify, whatsappConsent, whatsappStop, folders, gallery, myPhotos, rejectMatch, selfie, guestUpload };
