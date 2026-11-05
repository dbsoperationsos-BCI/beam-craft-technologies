const { createAiEditingService } = require("./service");
const { createEditDownloads } = require("./download");
const v = require("./validation");

const service = createAiEditingService();
const downloads = createEditDownloads();

function parse(schema, value, res, message = "Invalid request.") {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({ message, errors: result.error.flatten() });
  return null;
}
function fail(res, error, fallback) {
  // `details` is what a 409 says beyond its sentence (requiresSourceChoice): the shape the culling
  // and deletion escalations use, so the web asks the user instead of guessing.
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}
const handle = (fallback, run) => async (req, res) => { try { return await run(req, res); } catch (error) { return fail(res, error, fallback); } };

const capabilities = handle("Unable to read the editing engine's status.", async (req, res) => res.json({ data: await service.capabilities() }));

const list = handle("Unable to load the AI Editing photos.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const query = parse(v.listQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.list(params.projectId, query) });
});
const getPhoto = handle("Unable to load the photo.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.get(params.projectId, params.uploadId) });
});
// AI Culling → AI Editing.
const addPhotos = handle("Unable to add the photos to AI Editing.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.addPhotosSchema, req.body || {}, res, "Choose at least one photo, or a culling run."); if (!params || !body) return;
  return res.status(201).json({ data: await service.addPhotos(params.projectId, body, req.user.id) });
});
const saveRecipe = handle("Unable to save the edit.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); const body = parse(v.recipeSchema, req.body || {}, res, "Send the edit as an object."); if (!params || !body) return;
  return res.json({ data: await service.saveRecipe(params.projectId, params.uploadId, body.recipe, req.user.id) });
});
// The desktop rendered the edit from the original on its own disk and hands over the master
// (multipart: `output` + a JSON `payload`). Stored as a server render is; see the service.
const storeOutput = handle("Unable to store the edited photo.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  let raw;
  try { raw = JSON.parse(req.body?.payload || "{}"); } catch { return res.status(400).json({ message: "Send the edit's details as JSON." }); }
  const body = parse(v.outputPayloadSchema, raw, res, "Send the edit's recipe and the engine's version."); if (!body) return;
  return res.status(201).json({ data: await service.storeRenderedOutput(params.projectId, params.uploadId, req.file, body, req.user.id) });
});
// 202 whether the render was queued here or handed to the desktop app (`waitingForDesktop` says
// which); 409 with `details.requiresSourceChoice` when neither is possible without the caller's say-so.
const render = handle("Unable to start the render.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); const body = parse(v.renderSchema, req.body || {}, res, "Send the edit as an object."); if (!params || !body) return;
  return res.status(202).json({ data: await service.requestRender(params.projectId, params.uploadId, body.recipe, req.user.id, { source: body.source }) });
});
// The desktop's drain: the edits of this project waiting for the workstation that holds their originals.
const pending = handle("Unable to load the edits waiting for the desktop app.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const query = parse(v.pendingQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.pending(params.projectId, query) });
});
// The desktop could not render this edit from the original; the edit fails with the named state.
const reportLocalSource = handle("Unable to record the original's state.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); const body = parse(v.localSourceSchema, req.body || {}, res, "Send the original's state."); if (!params || !body) return;
  return res.json({ data: await service.reportLocalSource(params.projectId, params.uploadId, body, req.user.id) });
});
const reset = handle("Unable to reset the edit.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.reset(params.projectId, params.uploadId) });
});
const storeReference = handle("Unable to store the reference photo.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.status(201).json({ data: await service.storeReference(params.projectId, params.uploadId, req.file, req.user.id) });
});
const removeReference = handle("Unable to remove the reference photo.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.removeReference(params.projectId, params.uploadId) });
});
const suggest = handle("Unable to suggest what to remove.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.suggestMarks(params.projectId, params.uploadId) });
});
const batchApply = handle("Unable to apply the edit to the photos.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.batchApplySchema, req.body || {}, res, "Choose photos, or apply to all."); if (!params || !body) return;
  return res.status(202).json({ data: await service.batchApply(params.projectId, body, req.user.id) });
});
// AI Editing → Signature Album, the tab's one destination. The route also carries the album's guard.
const sendToSignatureAlbum = handle("Unable to send the photos to the Signature Album.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.sendSchema, req.body || {}, res, "Choose at least one photo."); if (!params || !body) return;
  return res.json({ data: await service.sendToSignatureAlbum(params.projectId, body.uploadIds, { force: body.force }, req.user.id) });
});

// Download Edited, step one: what of the asked photos has a saved edit, and the ticket for it.
const downloadPlan = handle("Unable to prepare the download.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.downloadPlanSchema, req.body || {}, res, "Choose at least one photo."); if (!params || !body) return;
  return res.json({ data: await downloads.plan(params.projectId, body.uploadIds, req.user.id) });
});
// Step two: the file itself, streamed. The ticket is the credential (a download cannot carry the
// session header) and must name this project. An error before the first byte is JSON for the
// desktop and a short page for a browser form; once streaming has begun the connection is closed.
const downloadArchive = async (req, res) => {
  const params = v.projectParamsSchema.safeParse(req.params); const body = v.downloadArchiveSchema.safeParse(req.body || {});
  const refuse = (status, message) => (req.is("application/json") ? res.status(status).json({ message }) : res.status(status).type("text/plain").send(message));
  if (!params.success || !body.success) return refuse(400, "Invalid download.");
  try {
    const ticket = downloads.verify(body.data.ticket);
    if (ticket.projectId !== params.data.projectId) return refuse(401, "Invalid download.");
    await downloads.streamArchive(body.data.ticket, res);
  } catch (error) {
    if (res.headersSent) { console.error("[ai-editing] download interrupted:", error?.message || error); res.destroy(); return; }
    if (error?.status) return refuse(error.status, error.message);
    console.error("Unable to download the edited photos.", error);
    return refuse(500, "Unable to download the edited photos.");
  }
};

const retryAlbumSync = handle("Unable to retry the album sync.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.albumSyncRetrySchema, req.body || {}, res); if (!params || !body) return;
  return res.json({ data: await service.retryAlbumSync(params.projectId, body.uploadIds || null) });
});

module.exports = { retryAlbumSync, downloadPlan, downloadArchive, capabilities, list, getPhoto, addPhotos, saveRecipe, render, pending, reportLocalSource, storeOutput, reset, storeReference, removeReference, suggest, batchApply, sendToSignatureAlbum, service };
