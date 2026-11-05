const { createRedisConnection } = require("../config/redis");
const service = require("./service");
const { channel } = require("./progress");
const { projectParamsSchema, sessionParamsSchema, resultParamsSchema, groupParamsSchema, startSchema, overviewQuerySchema, resultsQuerySchema, groupsQuerySchema, decisionSchema, viewsSchema, bulkDecisionSchema, groupBestSchema, acknowledgeSchema, signalsSchema, pendingQuerySchema, personParamsSchema, personRoleSchema, preferenceToggleSchema, updateSessionSchema, runSchema, sendToPhotosSchema } = require("./validation");

// Who may do what here is decided by the route, which mounts this module's permission.
function parse(schema, value, res) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message: "Invalid culling request.", errors: result.error.flatten() }); return null; }
function handleError(error, res) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) }); console.error("Unable to manage AI culling:", error); return res.status(500).json({ message: "Unable to manage AI culling." }); }

async function getOverview(req, res) { const params = parse(projectParamsSchema, req.params, res); const query = parse(overviewQuerySchema, req.query, res); if (!params || !query) return; try { return res.json({ data: await service.overview(params.projectId, query.folderId) }); } catch (error) { return handleError(error, res); } }
async function startSession(req, res) { const params = parse(projectParamsSchema, req.params, res); const body = parse(startSchema, req.body || {}, res); if (!params || !body) return; try { return res.status(201).json({ data: await service.start(params.projectId, body, req.user.id) }); } catch (error) { return handleError(error, res); } }
async function getSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.get(params.projectId, params.sessionId) }); } catch (error) { return handleError(error, res); } }
async function cancelSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.cancel(params.projectId, params.sessionId) }); } catch (error) { return handleError(error, res); } }
async function listResults(req, res) { const params = parse(sessionParamsSchema, req.params, res); const query = parse(resultsQuerySchema, req.query, res); if (!params || !query) return; try { return res.json({ data: await service.results(params.projectId, params.sessionId, query) }); } catch (error) { return handleError(error, res); } }
async function listGroups(req, res) { const params = parse(sessionParamsSchema, req.params, res); const query = parse(groupsQuerySchema, req.query, res); if (!params || !query) return; try { return res.json({ data: await service.groups(params.projectId, params.sessionId, query) }); } catch (error) { return handleError(error, res); } }
async function getGroup(req, res) { const params = parse(groupParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.getGroup(params.projectId, params.sessionId, params.groupId) }); } catch (error) { return handleError(error, res); } }
async function setDecision(req, res) { const params = parse(resultParamsSchema, req.params, res); const body = parse(decisionSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.setDecision(params.projectId, params.sessionId, params.resultId, body.decision, req.user.id, { source: body.source, platform: body.platform }) }); } catch (error) { return handleError(error, res); } }
async function bulkDecision(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(bulkDecisionSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.bulkDecision(params.projectId, params.sessionId, body.resultIds, body.decision, req.user.id, { source: body.source, platform: body.platform }) }); } catch (error) { return handleError(error, res); } }
// Photos seen or opened during review (training-label quality). The user comes from the token.
async function recordViews(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(viewsSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.recordViews(params.projectId, params.sessionId, body.resultIds, req.user.id, body.source, body.platform) }); } catch (error) { return handleError(error, res); } }
async function setGroupBest(req, res) { const params = parse(groupParamsSchema, req.params, res); const body = parse(groupBestSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.setGroupBest(params.projectId, params.sessionId, params.groupId, body.resultId, req.user.id, body.platform) }); } catch (error) { return handleError(error, res); } }
async function finalizeSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(acknowledgeSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.finalize(params.projectId, params.sessionId, body) }); } catch (error) { return handleError(error, res); } }
async function listPeople(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.people(params.projectId) }); } catch (error) { return handleError(error, res); } }
async function setPersonRole(req, res) { const params = parse(personParamsSchema, req.params, res); const body = parse(personRoleSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.setPersonRole(params.projectId, params.personId, body.role) }); } catch (error) { return handleError(error, res); } }
// Phase 8: the signed-in photographer's own learned preferences — the user comes from the token.
async function getPreferences(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.preferences(params.projectId, req.user.id) }); } catch (error) { return handleError(error, res); } }
async function setPreferences(req, res) { const params = parse(projectParamsSchema, req.params, res); const body = parse(preferenceToggleSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.setPreferencesEnabled(params.projectId, req.user.id, body.enabled) }); } catch (error) { return handleError(error, res); } }
async function resetPreferences(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.resetPreferences(params.projectId, req.user.id) }); } catch (error) { return handleError(error, res); } }
async function listPending(req, res) { const params = parse(sessionParamsSchema, req.params, res); const query = parse(pendingQuerySchema, req.query, res); if (!params || !query) return; try { return res.json({ data: await service.pending(params.projectId, params.sessionId, query) }); } catch (error) { return handleError(error, res); } }
async function ingestSignals(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(signalsSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.ingestSignals(params.projectId, params.sessionId, body) }); } catch (error) { return handleError(error, res); } }
async function runSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(runSchema, req.body || {}, res); if (!params || !body) return; try { return res.status(202).json({ data: await service.run(params.projectId, params.sessionId, body) }); } catch (error) { return handleError(error, res); } }
// A finalized run's Keeps straight to Photo Selection. The user comes from the token.
async function sendKeepsToPhotoSelection(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(sendToPhotosSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.sendKeepsToPhotoSelection(params.projectId, params.sessionId, body, req.user.id) }); } catch (error) { return handleError(error, res); } }
// The mode of a run still waiting for its photos or its workstation.
async function updateSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(updateSessionSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.update(params.projectId, params.sessionId, body) }); } catch (error) { return handleError(error, res); } }
async function reopenSession(req, res) { const params = parse(sessionParamsSchema, req.params, res); const body = parse(acknowledgeSchema, req.body || {}, res); if (!params || !body) return; try { return res.json({ data: await service.reopen(params.projectId, params.sessionId, body) }); } catch (error) { return handleError(error, res); } }

// Same SSE contract as upload batches: an immediate snapshot, then Redis pub/sub frames, a 15s
// heartbeat comment, and a dedicated subscriber connection closed with the request.
async function streamSession(req, res) {
  const params = parse(sessionParamsSchema, req.params, res); if (!params) return;
  try {
    const initial = await service.get(params.projectId, params.sessionId);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "progress", session: initial })}\n\n`);
    const subscriber = createRedisConnection();
    await subscriber.subscribe(channel(params.sessionId));
    subscriber.on("message", (_channel, message) => res.write(`data: ${message}\n\n`));
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => { clearInterval(heartbeat); subscriber.quit().catch(() => {}); });
  } catch (error) { return handleError(error, res); }
}

module.exports = { recordViews, getOverview, startSession, getSession, cancelSession, listResults, listGroups, getGroup, setDecision, bulkDecision, setGroupBest, finalizeSession, reopenSession, streamSession, listPending, ingestSignals, runSession, listPeople, setPersonRole, getPreferences, setPreferences, resetPreferences, updateSession, sendKeepsToPhotoSelection };
