const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema, subEventSchema, subEventParamsSchema, reorderSchema } = require("../events/validation");

const listSubEvents = route("load sub-events", async (req, res) => { const params = validate(eventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.list(params.eventId) }); });
const createSubEvent = route("create sub-event", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res); const body = validate(subEventSchema, req.body, res, "Invalid sub-event.");
  if (!params || !body) return;
  res.status(201).json({ data: await service.create(params.eventId, body, req.user) });
});
const updateSubEvent = route("update sub-event", async (req, res) => {
  const params = validate(subEventParamsSchema, req.params, res); const body = validate(subEventSchema.partial(), req.body, res, "Invalid sub-event.");
  if (!params || !body) return;
  res.json({ data: await service.update(params.eventId, params.subEventId, body, req.user) });
});
const deleteSubEvent = route("delete sub-event", async (req, res) => { const params = validate(subEventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.remove(params.eventId, params.subEventId, req.user) }); });
const reorderSubEvents = route("reorder sub-events", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res); const body = validate(reorderSchema, req.body, res);
  if (!params || !body) return;
  res.json({ data: await service.reorder(params.eventId, body.order, req.user) });
});

module.exports = { listSubEvents, createSubEvent, updateSubEvent, deleteSubEvent, reorderSubEvents };
