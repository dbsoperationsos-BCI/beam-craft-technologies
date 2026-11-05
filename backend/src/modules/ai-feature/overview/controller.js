const service = require("./service");
const { route, validate } = require("../shared/http");
const activity = require("../shared/activity");
const { serializeActivity } = require("../shared/serializers");
const { dashboardQuerySchema } = require("../../../services/dashboardRange");
const { eventParamsSchema } = require("../events/validation");

// Who may read this is the router's decision (AI Feature, READ); the only thing read from the
// caller is the range key, and a key the picker has no option for is refused rather than guessed.
const getOverview = route("load overview", async (req, res) => {
  const query = validate(dashboardQuerySchema, req.query, res, "Invalid dashboard request.");
  if (!query) return;
  res.json({ data: await service.dashboard(query) });
});
// One event's Detection & Storage, for its Project Dashboard. Same guard as the dashboard (the
// router's AI Feature READ); the event id is the only thing read, and the service 404s one that is gone.
const getEventDetection = route("load event detection", async (req, res) => {
  const p = validate(eventParamsSchema, req.params, res); if (!p) return;
  res.json({ data: await service.eventDetection(p.eventId) });
});
const getRecentActivity = route("load recent activity", async (req, res) => res.json({ data: (await activity.recent({ limit: 50 })).map(serializeActivity) }));

module.exports = { getOverview, getRecentActivity, getEventDetection };
