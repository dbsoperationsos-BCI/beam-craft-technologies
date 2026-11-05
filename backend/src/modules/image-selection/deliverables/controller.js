const { createDeliverableService } = require("./service");
const { projectParamsSchema, saveOverridesSchema, manualItemSchema, configParamsSchema } = require("./validation");
const service = createDeliverableService();
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function parse(schema, value, res) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message: "Invalid deliverable request.", errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error(`Unable to ${action} Image Selection deliverables:`, error); return res.status(500).json({ message: `Unable to ${action} Image Selection deliverables.` }); }
async function listDeliverables(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.list(params.projectId) }); } catch (error) { return handleError(error, res, "load"); } }
async function listAllocatedServices(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.listAllocatedServices(params.projectId) }); } catch (error) { return handleError(error, res, "load"); } }
async function synchronizeDeliverables(req, res) { const params = parse(projectParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.synchronize(params.projectId) }); } catch (error) { return handleError(error, res, "synchronize"); } }
async function saveDeliverableOverrides(req, res) { const params = parse(projectParamsSchema, req.params, res); const body = parse(saveOverridesSchema, req.body, res); if (!params || !body) return; try { return res.json({ data: await service.saveOverrides(params.projectId, body.items) }); } catch (error) { return handleError(error, res, "save"); } }
async function addManualDeliverable(req, res) { const params = parse(projectParamsSchema, req.params, res); const body = parse(manualItemSchema, req.body, res); if (!params || !body) return; try { return res.status(201).json({ data: await service.addManualItem(params.projectId, body) }); } catch (error) { return handleError(error, res, "add"); } }
async function removeManualDeliverable(req, res) { const params = parse(configParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.removeManualItem(params.projectId, params.configId) }); } catch (error) { return handleError(error, res, "remove"); } }
module.exports = { listDeliverables, listAllocatedServices, synchronizeDeliverables, saveDeliverableOverrides, addManualDeliverable, removeManualDeliverable };
