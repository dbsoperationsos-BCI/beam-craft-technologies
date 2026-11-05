const { z } = require("zod");
const service = require("./service");
const poster = require("./poster");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");

const createBody = z.object({ requirePin: z.boolean().optional().default(false), expiresAt: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Not a date.").nullable().optional() });

// Editing a live link: PIN on or off, a new PIN, a new link code - each made on the server. A typed
// code or PIN is not accepted: anything else in the body is refused.
const updateBody = z.object({
  requirePin: z.boolean().optional(),
  newPin: z.boolean().optional(),
  newCode: z.boolean().optional(),
}).strict();
const getShare = route("load share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.get(p.eventId) }); });
const createShare = route("create share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(createBody, req.body || {}, res); if (!p || !b) return; res.status(201).json({ data: await service.create(p.eventId, b, req.user) }); });
// The QR Template's poster kit: the live link's QR grid and the studio logos (share/poster.js).
const getSharePoster = route("load share poster", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await poster.poster(p.eventId) }); });
const updateShare = route("update share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(updateBody, req.body || {}, res); if (!p || !b) return; res.json({ data: await service.update(p.eventId, b, req.user) }); });
const revokeShare = route("revoke share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.revoke(p.eventId, req.user) }); });

module.exports = { getShare, createShare, updateShare, revokeShare, getSharePoster };
