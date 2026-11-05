const { z } = require("zod");
const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");

const matchParams = eventParamsSchema.extend({ matchId: z.string().trim().min(1).max(191) });
const listQuery = z.object({ status: z.enum(["all", "MATCHED", "CONFIRMED", "REJECTED", "REVIEW_REQUIRED"]).optional().default("REVIEW_REQUIRED"), guestId: z.string().trim().min(1).max(191).optional(), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(200).optional().default(60) });
const decideBody = z.object({ status: z.enum(["CONFIRMED", "REJECTED"]) });

const listMatches = route("load matches", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const q = validate(listQuery, req.query, res); if (!p || !q) return; res.json({ data: await service.list(p.eventId, q) }); });
const decideMatch = route("update match", async (req, res) => { const p = validate(matchParams, req.params, res); const b = validate(decideBody, req.body, res); if (!p || !b) return; res.json({ data: await service.decide(p.eventId, p.matchId, b.status, req.user) }); });

module.exports = { listMatches, decideMatch };
