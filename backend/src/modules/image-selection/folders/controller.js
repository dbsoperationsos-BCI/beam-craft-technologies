const service = require("./service");
const { projectParamsSchema, folderParamsSchema, createFolderSchema, renameFolderSchema } = require("./validation");

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.

function validate(schema, value, res) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({ message: "Invalid folder request.", errors: parsed.error.flatten() });
  return null;
}

function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
  // A unique violation only means a sibling-name clash on the requests that name a folder. On a
  // listing or a delete it is something else entirely, and telling the studio a folder "already
  // exists" for a request that created none would send them looking for the wrong problem.
  if (error.code === "P2002" && (action === "create" || action === "rename")) return res.status(409).json({ message: "A folder with this name already exists here." });
  console.error(`Unable to ${action} Image Selection folder:`, error);
  return res.status(500).json({ message: `Unable to ${action} folder.` });
}

async function listFolders(req, res) {
  const params = validate(projectParamsSchema, req.params, res);
  if (!params) return;
  try { return res.json({ data: await service.list(params.projectId) }); } catch (error) { return handleError(error, res, "load"); }
}

async function createFolder(req, res) {
  const params = validate(projectParamsSchema, req.params, res);
  const body = validate(createFolderSchema, req.body, res);
  if (!params || !body) return;
  try { return res.status(201).json({ data: await service.create(params.projectId, body, req.user.id) }); } catch (error) { return handleError(error, res, "create"); }
}

async function renameFolder(req, res) {
  const params = validate(folderParamsSchema, req.params, res);
  const body = validate(renameFolderSchema, req.body, res);
  if (!params || !body) return;
  try { return res.json({ data: await service.rename(params.projectId, params.folderId, body) }); } catch (error) { return handleError(error, res, "rename"); }
}

async function deleteFolder(req, res) {
  const params = validate(folderParamsSchema, req.params, res);
  if (!params) return;
  // `acknowledgeSubmitted=true` is the caller's answer to the 409 high-impact warning: the scope
  // holds client-submitted selections and the admin typed the confirmation to delete them anyway.
  try { return res.json({ data: await service.remove(params.projectId, params.folderId, { acknowledgeSubmitted: req.query.acknowledgeSubmitted === "true" }) }); } catch (error) { return handleError(error, res, "delete"); }
}

module.exports = { listFolders, createFolder, renameFolder, deleteFolder };
