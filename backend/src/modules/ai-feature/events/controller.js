const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema, createEventSchema, updateEventSchema, listEventsQuerySchema, duplicateEventSchema, eventSettingsBodySchema } = require("./validation");

const listEvents = route("load events", async (req, res) => {
  const query = validate(listEventsQuerySchema, req.query, res, "Invalid event list request.");
  if (!query) return;
  res.json({ data: await service.list(query, req.user.id) });
});

const getEvent = route("load event", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res);
  if (!params) return;
  res.json({ data: await service.get(params.eventId) });
});

const createEvent = route("create event", async (req, res) => {
  const body = validate(createEventSchema, req.body, res, "Invalid event.");
  if (!body) return;
  res.status(201).json({ data: await service.create(body, req.user) });
});

const updateEvent = route("update event", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res);
  const body = validate(updateEventSchema, req.body, res, "Invalid event.");
  if (!params || !body) return;
  res.json({ data: await service.update(params.eventId, body, req.user) });
});

const duplicateEvent = route("duplicate event", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res);
  const body = validate(duplicateEventSchema, req.body || {}, res);
  if (!params || !body) return;
  res.status(201).json({ data: await service.duplicate(params.eventId, body, req.user) });
});

const archiveEvent = route("archive event", async (req, res) => { const params = validate(eventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.archive(params.eventId, req.user) }); });
const restoreEvent = route("restore event", async (req, res) => { const params = validate(eventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.restore(params.eventId, req.user) }); });
const deleteEvent = route("delete event", async (req, res) => { const params = validate(eventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.remove(params.eventId, req.user) }); });

const getSettings = route("load event settings", async (req, res) => { const params = validate(eventParamsSchema, req.params, res); if (!params) return; res.json({ data: await service.readSettings(params.eventId) }); });
const saveSettings = route("save event settings", async (req, res) => {
  const params = validate(eventParamsSchema, req.params, res);
  const body = validate(eventSettingsBodySchema, req.body, res, "Invalid settings.");
  if (!params || !body) return;
  res.json({ data: await service.saveSettings(params.eventId, body, req.user) });
});

module.exports = { listEvents, getEvent, createEvent, updateEvent, duplicateEvent, archiveEvent, restoreEvent, deleteEvent, getSettings, saveSettings };
