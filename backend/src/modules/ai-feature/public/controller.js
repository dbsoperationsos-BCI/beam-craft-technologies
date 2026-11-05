const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const { clientIp } = require("../../../middleware/rateLimit");
const { validate, route } = require("../shared/http");

const codeParams = z.object({ code: z.string().regex(/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9]{4,8})$/) });
const matchParams = codeParams.extend({ matchId: z.string().trim().min(1).max(191) });
const joinBody = z.object({ name: z.string().trim().max(191).optional(), phone: z.string().trim().max(30).optional(), pin: z.string().regex(/^\d{4}$/).optional(), rsvp: z.enum(["ACCEPTED", "DECLINED"]).optional() });
const rsvpBody = z.object({ rsvp: z.enum(["ACCEPTED", "DECLINED", "PENDING"]) });
const pageQuery = z.object({ folderId: z.string().trim().min(1).max(191).optional(), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(60) });

const selfieUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single("selfie");
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 1 } }).single("file");
const notFound = (res) => res.status(404).json({ message: "Event link not found." });

const getMeta = route("load event", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.meta(p.data.code) }); });
const join = route("join event", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(joinBody, req.body || {}, res, "Please check the details you entered."); if (!b) return; res.json({ data: await service.join(p.data.code, b, clientIp(req)) }); });
const me = route("load guest", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.me(p.data.code, req.headers.authorization) }); });
const rsvp = route("update rsvp", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const b = validate(rsvpBody, req.body, res); if (!b) return; res.json({ data: await service.rsvp(p.data.code, req.headers.authorization, b.rsvp) }); });
const folders = route("load gallery folders", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.folders(p.data.code, req.headers.authorization) }); });
const gallery = route("load gallery", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const q = validate(pageQuery, req.query, res); if (!q) return; res.json({ data: await service.gallery(p.data.code, req.headers.authorization, q) }); });
const myPhotos = route("load my photos", async (req, res) => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); const q = validate(pageQuery, req.query, res); if (!q) return; res.json({ data: await service.myPhotos(p.data.code, req.headers.authorization, q) }); });
const rejectMatch = route("reject match", async (req, res) => { const p = matchParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await service.rejectMatch(p.data.code, req.headers.authorization, p.data.matchId) }); });

const withUpload = (upload, action, handler) => (req, res) => upload(req, res, (error) => {
  if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "That file is too large." : "Upload rejected." });
  return route(action, async () => { const p = codeParams.safeParse(req.params); if (!p.success) return notFound(res); res.json({ data: await handler(p.data.code, req) }); })(req, res);
});
const selfie = withUpload(selfieUpload, "find my photos", (code, req) => service.selfie(code, req.headers.authorization, req.file));
const guestUpload = withUpload(photoUpload, "upload photo", (code, req) => service.guestUpload(code, req.headers.authorization, req.file));

module.exports = { getMeta, join, me, rsvp, folders, gallery, myPhotos, rejectMatch, selfie, guestUpload };
