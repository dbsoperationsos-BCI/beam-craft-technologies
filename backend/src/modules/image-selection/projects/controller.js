const { createImageSelectionProjectService } = require("./service");
const { projectIdSchema, createProjectSchema, editProjectSchema, settingsSchema, listProjectsSchema } = require("./validation");

const service = createImageSelectionProjectService();
// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) }); console.error(`Unable to ${action} Image Selection project:`, error); return res.status(500).json({ message: `Unable to ${action} Image Selection project.` }); }

async function listProjects(req, res) { const query = parse(listProjectsSchema, req.query, res, "Invalid project list request."); if (!query) return; try { return res.json({ data: await service.list({ ...query, archived: query.archived === "true" }) }); } catch (error) { return handleError(error, res, "load"); } }
async function createProject(req, res) { const body = parse(createProjectSchema, req.body, res, "Enter a project name, and the client's name and WhatsApp number."); if (!body) return; try { return res.status(201).json({ data: await service.create(body, req.user.id) }); } catch (error) { return handleError(error, res, "create"); } }
async function editProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); const body = parse(editProjectSchema, req.body, res, "Enter a valid display name."); if (!params || !body) return; try { return res.json({ data: await service.edit(params.projectId, body) }); } catch (error) { return handleError(error, res, "edit"); } }
async function saveSettings(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); const body = parse(settingsSchema, req.body, res, "Invalid settings request."); if (!params || !body) return; try { return res.json({ data: await service.saveSettings(params.projectId, body) }); } catch (error) { return handleError(error, res, "save"); } }
async function duplicateProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.status(201).json({ data: await service.duplicate(params.projectId, req.user.id) }); } catch (error) { return handleError(error, res, "duplicate"); } }
async function archiveProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await service.archive(params.projectId) }); } catch (error) { return handleError(error, res, "archive"); } }
async function restoreProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await service.restore(params.projectId) }); } catch (error) { return handleError(error, res, "restore"); } }
// `acknowledgeSubmitted=true` is the caller's answer to the 409 high-impact warning: the project
// holds client-submitted selections and the admin typed the confirmation to delete them anyway.
async function deleteProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { await service.remove(params.projectId, { acknowledgeSubmitted: req.query.acknowledgeSubmitted === "true" }); return res.status(204).send(); } catch (error) { return handleError(error, res, "delete"); } }

module.exports = { listProjects, createProject, editProject, saveSettings, duplicateProject, archiveProject, restoreProject, deleteProject };
