const service = require("./service");
const { route } = require("../shared/http");
const activity = require("../shared/activity");
const { serializeActivity } = require("../shared/serializers");

const getOverview = route("load overview", async (req, res) => res.json({ data: await service.dashboard() }));
const getRecentActivity = route("load recent activity", async (req, res) => res.json({ data: (await activity.recent({ limit: 50 })).map(serializeActivity) }));

module.exports = { getOverview, getRecentActivity };
