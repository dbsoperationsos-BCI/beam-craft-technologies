const { z } = require("zod");
const { createRedisConnection } = require("../config/redis");
const { channel } = require("./progress");
const service = require("./batchService");

const createSchema = z.object({ totalFiles: z.coerce.number().int().min(1).max(50000), folderId: z.string().trim().min(1).max(191).nullable().optional() });
const paramsSchema = z.object({ projectId: z.string().trim().min(1).max(191), batchId: z.string().trim().min(1).max(191).optional() });
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function parse(schema, value, res) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message: "Invalid upload batch request.", errors: result.error.flatten() }); return null; }
function handle(error, res) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("Upload batch error:", error); return res.status(500).json({ message: "Unable to manage upload batch." }); }

async function createBatch(req, res) { const params = parse(paramsSchema, req.params, res); const body = parse(createSchema, req.body, res); if (!params || !body) return; try { return res.status(201).json({ data: await service.create(params.projectId, body, req.user.id) }); } catch (error) { return handle(error, res); } }
async function getBatch(req, res) { const params = parse(paramsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.get(params.projectId, params.batchId) }); } catch (error) { return handle(error, res); } }
async function retryFailed(req, res) { const params = parse(paramsSchema, req.params, res); if (!params?.batchId) return; try { return res.json({ data: await service.retryFailed(params.projectId, params.batchId) }); } catch (error) { return handle(error, res); } }

async function streamBatch(req, res) {
  const params = parse(paramsSchema, req.params, res); if (!params) return;
  try { const initial = await service.get(params.projectId, params.batchId); res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders(); res.write(`data: ${JSON.stringify({ type: "progress", batch: initial, image: null })}\n\n`); const subscriber = createRedisConnection(); await subscriber.subscribe(channel(params.batchId)); subscriber.on("message", (_channel, message) => res.write(`data: ${message}\n\n`)); const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000); req.on("close", () => { clearInterval(heartbeat); subscriber.quit().catch(() => {}); }); } catch (error) { return handle(error, res); }
}

module.exports = { createBatch, getBatch, retryFailed, streamBatch };
