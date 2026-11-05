const { z } = require("zod");
const service = require("./service");
const ingest = require("./ingest");
const { imageSelectionIngestSchema } = require("../../desktop/descriptors");

const paramsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });

function handle(error, res) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error("Image Selection face processing request failed:", error);
  return res.status(500).json({ message: "Unable to complete the face processing request." });
}

/** GET /status - how far the project's photos have got, and whether the engine can run at all. */
async function getStatus(req, res) {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return res.status(404).json({ message: "Image Selection project not found." });
  try { return res.json({ data: await service.status(params.data.projectId) }); } catch (error) { return handle(error, res); }
}

/** POST /queue - hand the worker every photo it has not seen. Returns at once; the work is in the background. */
async function queueProject(req, res) {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return res.status(404).json({ message: "Image Selection project not found." });
  try { return res.status(202).json({ data: await service.queueProject(params.data.projectId) }); } catch (error) { return handle(error, res); }
}

/** POST /ingest - the desktop's faces for one photo, found with this server's own engine on the original file. Synchronous: the people are updated by the time it answers. */
async function ingestFaces(req, res) {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return res.status(404).json({ message: "Image Selection project not found." });
  const body = imageSelectionIngestSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ message: "Invalid face descriptors.", errors: body.error.flatten() });
  try { return res.json({ data: await ingest.ingest(params.data.projectId, body.data) }); } catch (error) { return handle(error, res); }
}

module.exports = { getStatus, queueProject, ingestFaces };
