const service = require("./service");
const { projectParamsSchema } = require("../gallery/validation");

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function validateParams(req, res) { const parsed = projectParamsSchema.safeParse(req.params); if (parsed.success) return parsed.data; res.status(400).json({ message: "Invalid publication request.", errors: parsed.error.flatten() }); return null; }
function handleError(error, res) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("Unable to manage gallery publication:", error); return res.status(500).json({ message: "Unable to manage gallery publication." }); }

async function getStatus(req, res) { const params = validateParams(req, res); if (!params) return; try { return res.json({ data: await service.status(params.projectId) }); } catch (error) { return handleError(error, res); } }
async function publishGallery(req, res) { const params = validateParams(req, res); if (!params) return; try { return res.json({ data: await service.publish(params.projectId, req.user.id) }); } catch (error) { return handleError(error, res); } }
async function revokeGallery(req, res) { const params = validateParams(req, res); if (!params) return; try { return res.json({ data: await service.revoke(params.projectId) }); } catch (error) { return handleError(error, res); } }
async function regeneratePin(req, res) { const params = validateParams(req, res); if (!params) return; try { return res.json({ data: await service.regeneratePin(params.projectId) }); } catch (error) { return handleError(error, res); } }

module.exports = { getStatus, publishGallery, revokeGallery, regeneratePin };
