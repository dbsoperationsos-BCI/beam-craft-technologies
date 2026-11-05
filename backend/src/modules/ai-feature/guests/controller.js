const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");
const { createGuestSchema, updateGuestSchema, importGuestsSchema, guestParamsSchema, listGuestsQuerySchema, groupFields, updateGroupSchema, groupParamsSchema } = require("./validation");

const listGuests = route("load guests", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const q = validate(listGuestsQuerySchema, req.query, res); if (!p || !q) return; res.json({ data: await service.list(p.eventId, q) }); });
const createGuest = route("add guest", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(createGuestSchema, req.body, res, "Invalid guest."); if (!p || !b) return; res.status(201).json({ data: await service.create(p.eventId, b, req.user) }); });
const importGuests = route("import guests", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(importGuestsSchema, req.body, res, "Invalid guest list."); if (!p || !b) return; res.json({ data: await service.importMany(p.eventId, b, req.user) }); });
const updateGuest = route("update guest", async (req, res) => { const p = validate(guestParamsSchema, req.params, res); const b = validate(updateGuestSchema, req.body, res, "Invalid guest."); if (!p || !b) return; res.json({ data: await service.update(p.eventId, p.guestId, b, req.user) }); });
const deleteGuest = route("remove guest", async (req, res) => { const p = validate(guestParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.remove(p.eventId, p.guestId, req.user) }); });

const listGroups = route("load guest groups", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.listGroups(p.eventId) }); });
const createGroup = route("add guest group", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(groupFields, req.body, res, "Invalid group."); if (!p || !b) return; res.status(201).json({ data: await service.createGroup(p.eventId, b, req.user) }); });
const updateGroup = route("update guest group", async (req, res) => { const p = validate(groupParamsSchema, req.params, res); const b = validate(updateGroupSchema, req.body, res, "Invalid group."); if (!p || !b) return; res.json({ data: await service.updateGroup(p.eventId, p.groupId, b, req.user) }); });
const deleteGroup = route("remove guest group", async (req, res) => { const p = validate(groupParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.removeGroup(p.eventId, p.groupId, req.user) }); });

module.exports = { listGuests, createGuest, importGuests, updateGuest, deleteGuest, listGroups, createGroup, updateGroup, deleteGroup };
