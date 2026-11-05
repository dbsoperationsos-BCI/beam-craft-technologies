const { z } = require("zod");
const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");

const createBody = z.object({ requirePin: z.boolean().optional().default(false), expiresAt: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Not a date.").nullable().optional() });

const getShare = route("load share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.get(p.eventId) }); });
const createShare = route("create share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(createBody, req.body || {}, res); if (!p || !b) return; res.status(201).json({ data: await service.create(p.eventId, b, req.user) }); });
const revokeShare = route("revoke share link", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.revoke(p.eventId, req.user) }); });

module.exports = { getShare, createShare, revokeShare };
