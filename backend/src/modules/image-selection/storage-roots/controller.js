const service = require("./service");
const { createStorageRootSchema, updateStorageRootSchema, storageRootIdSchema } = require("./validation");

function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error(`Unable to ${action} storage root:`, error); return res.status(500).json({ message: `Unable to ${action} the storage root.` }); }

async function listStorageRoots(req, res) { try { return res.json({ data: await service.list() }); } catch (error) { return handleError(error, res, "list"); } }
async function createStorageRoot(req, res) { const body = parse(createStorageRootSchema, req.body, res, "Enter a storage root name."); if (!body) return; try { return res.status(201).json({ data: await service.create(body) }); } catch (error) { return handleError(error, res, "create"); } }
async function updateStorageRoot(req, res) { const params = parse(storageRootIdSchema, req.params, res, "Invalid storage root request."); const body = parse(updateStorageRootSchema, req.body, res, "Invalid storage root details."); if (!params || !body) return; try { return res.json({ data: await service.update(params.storageRootId, body) }); } catch (error) { return handleError(error, res, "update"); } }
async function deleteStorageRoot(req, res) { const params = parse(storageRootIdSchema, req.params, res, "Invalid storage root request."); if (!params) return; try { await service.remove(params.storageRootId); return res.status(204).send(); } catch (error) { return handleError(error, res, "delete"); } }

module.exports = { listStorageRoots, createStorageRoot, updateStorageRoot, deleteStorageRoot };
