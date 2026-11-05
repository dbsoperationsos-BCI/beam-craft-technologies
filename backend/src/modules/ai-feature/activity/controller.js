const { z } = require("zod");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");
const { serializeActivity } = require("../shared/serializers");

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional().default(50), before: z.string().trim().optional() });

const listActivity = route("load activity", async (req, res) => {
  const p = validate(eventParamsSchema, req.params, res); const q = validate(listQuery, req.query, res);
  if (!p || !q) return;
  await loadEvent(p.eventId);
  res.json({ data: (await activity.list(p.eventId, q)).map(serializeActivity) });
});

module.exports = { listActivity };
