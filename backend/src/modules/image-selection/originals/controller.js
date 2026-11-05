const { createOriginalsService } = require("./service");
const queue = require("../processing/queue");
const { projectParamsSchema, browseQuerySchema, registerSchema, registerFilesSchema, registerBatchSchema, copySelectedSchema } = require("./validation");

const batches = require("../uploads/batchRepository");
const progress = require("../uploads/progress");

const service = createOriginalsService(undefined, { queue, batches, progress });

// Reading and copying originals is studio work on the studio's own storage, so it carries the same
// permission every other Image Selection management action does.
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message, details: error.details }); console.error(`Unable to ${action} Image Selection originals:`, error); return res.status(500).json({ message: `Unable to ${action} originals.` }); }

async function browseOriginals(req, res) {
  const query = parse(browseQuerySchema, req.query, res, "Invalid folder request.");
  if (!query) return;
  try { return res.json({ data: await service.browse(query.path) }); } catch (error) { return handleError(error, res, "browse"); }
}

async function registerOriginals(req, res) {
  const params = parse(projectParamsSchema, req.params, res, "Invalid project request.");
  const body = parse(registerSchema, req.body, res, "Invalid import request.");
  if (!params || !body) return;
  try {
    return res.status(201).json({ data: await service.register(params.projectId, { folderId: body.folderId || null, relativePath: body.path, recursive: body.recursive, userId: req.user.id }) });
  } catch (error) { return handleError(error, res, "register"); }
}

// What the ordinary upload control posts. A folder where some files registered and some did not is
// still a completed request, reported as 207 so the caller reads `skipped` rather than treating it
// as a clean success — the same contract the copy below uses.
async function registerOriginalFiles(req, res) {
  const params = parse(projectParamsSchema, req.params, res, "Invalid project request.");
  const body = parse(registerFilesSchema, req.body, res, "Invalid import request.");
  if (!params || !body) return;
  try {
    const result = await service.registerFiles(params.projectId, { folderId: body.folderId || null, batchId: body.batchId || null, files: body.files, userId: req.user.id });
    return res.status(result.skipped.length ? 207 : 201).json({ data: result });
  } catch (error) { return handleError(error, res, "register"); }
}

// What the desktop app posts after a scan: metadata only, no bytes and no server-side stat — the
// desktop is the machine that can see the files. Same 207 contract as the other registrations.
async function registerOriginalBatch(req, res) {
  const params = parse(projectParamsSchema, req.params, res, "Invalid project request.");
  const body = parse(registerBatchSchema, req.body, res, "Invalid registration request.");
  if (!params || !body) return;
  try {
    const result = await service.registerBatch(params.projectId, { folderId: body.folderId || null, storageRootId: body.storageRootId, files: body.files, userId: req.user.id });
    return res.status(result.skipped.length ? 207 : 201).json({ data: result });
  } catch (error) { return handleError(error, res, "register"); }
}

async function copySelectedOriginals(req, res) {
  const params = parse(projectParamsSchema, req.params, res, "Invalid project request.");
  const body = parse(copySelectedSchema, req.body || {}, res, "Invalid copy request.");
  if (!params || !body) return;
  try {
    const result = await service.copySelected(params.projectId, { deliverableConfigId: body.deliverableConfigId || null });
    // A copy that reached some files and not others is still a completed operation, reported as
    // 207 so the caller knows to read `failed` rather than treating it as a clean success.
    return res.status(result.failed.length ? 207 : 200).json({ data: result });
  } catch (error) { return handleError(error, res, "copy"); }
}

module.exports = { browseOriginals, registerOriginals, registerOriginalFiles, registerOriginalBatch, copySelectedOriginals };
