const { z } = require("zod");
const service = require("./service");
const { validate, route } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");

const personParams = eventParamsSchema.extend({ personId: z.string().trim().min(1).max(191) });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(200).optional().default(60), includeHidden: z.enum(["true", "false"]).optional() });
const renameBody = z.object({ label: z.string().trim().max(120).nullable() });
const hideBody = z.object({ hidden: z.boolean() });
const mergeBody = z.object({ sourceIds: z.array(z.string().trim().min(1).max(191)).min(1).max(100) });
const splitBody = z.object({ faceIds: z.array(z.string().trim().min(1).max(191)).min(1).max(500) });
const linkBody = z.object({ guestId: z.string().trim().min(1).max(191).nullable() });

const listPeople = route("load people", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const q = validate(pageQuery, req.query, res); if (!p || !q) return; res.json({ data: await service.list(p.eventId, { ...q, includeHidden: q.includeHidden === "true" }) }); });
const getPerson = route("load person", async (req, res) => { const p = validate(personParams, req.params, res); const q = validate(pageQuery, req.query, res); if (!p || !q) return; res.json({ data: await service.get(p.eventId, p.personId, q) }); });
const renamePerson = route("rename person", async (req, res) => { const p = validate(personParams, req.params, res); const b = validate(renameBody, req.body, res); if (!p || !b) return; res.json({ data: await service.rename(p.eventId, p.personId, b.label, req.user) }); });
const hidePerson = route("hide person", async (req, res) => { const p = validate(personParams, req.params, res); const b = validate(hideBody, req.body, res); if (!p || !b) return; res.json({ data: await service.hide(p.eventId, p.personId, b.hidden, req.user) }); });
const mergePeople = route("merge people", async (req, res) => { const p = validate(personParams, req.params, res); const b = validate(mergeBody, req.body, res); if (!p || !b) return; res.json({ data: await service.merge(p.eventId, p.personId, b.sourceIds, req.user) }); });
const splitPerson = route("split person", async (req, res) => { const p = validate(personParams, req.params, res); const b = validate(splitBody, req.body, res); if (!p || !b) return; res.json({ data: await service.split(p.eventId, p.personId, b.faceIds, req.user) }); });
const linkPerson = route("link person to guest", async (req, res) => { const p = validate(personParams, req.params, res); const b = validate(linkBody, req.body, res); if (!p || !b) return; res.json({ data: await service.linkGuest(p.eventId, p.personId, b.guestId, req.user) }); });

module.exports = { listPeople, getPerson, renamePerson, hidePerson, mergePeople, splitPerson, linkPerson };
