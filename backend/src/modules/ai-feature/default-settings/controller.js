const service = require("./service");
const { validate, route } = require("../shared/http");
const { defaultsBodySchema } = require("./validation");

const getDefaults = route("load event default settings", async (req, res) => res.json({ data: await service.read() }));

const saveDefaults = route("save event default settings", async (req, res) => {
  const body = validate(defaultsBodySchema, req.body, res, "Invalid settings.");
  if (!body) return;
  res.json({ data: await service.save(body, req.user.id) });
});

module.exports = { getDefaults, saveDefaults };
