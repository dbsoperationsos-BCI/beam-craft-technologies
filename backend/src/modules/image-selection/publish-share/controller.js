const { z } = require("zod"); const { createPublishShareService } = require("./service");
const service = createPublishShareService(); const schema = z.object({ projectId: z.string().trim().min(1).max(191) });
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
async function prepare(req, res) { const parsed = schema.safeParse(req.params); if (!parsed.success) return res.status(400).json({ message: "Invalid publish request.", errors: parsed.error.flatten() }); try { return res.json({ data: await service.prepare(parsed.data.projectId, req.user.id, req.body || {}) }); } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) }); console.error("Unable to prepare Image Selection publish:", error); return res.status(500).json({ message: "Unable to prepare Image Selection publish." }); } }
module.exports = { prepare };
