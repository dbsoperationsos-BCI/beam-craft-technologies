const { createAlbumProofingProjectService } = require("./projects.service");
const { projectIdSchema, createProjectSchema, editProjectSchema, listProjectsSchema } = require("./projects.validation");

// Album Proofing's own project endpoints. Who may do what is decided by the route, which mounts
// this module's permission; nothing here looks at the caller's role.
const service = createAlbumProofingProjectService();

function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) }); console.error(`Unable to ${action} Album Proofing project:`, error); return res.status(500).json({ message: `Unable to ${action} Album Proofing project.` }); }

async function listProjects(req, res) { const query = parse(listProjectsSchema, req.query, res, "Invalid project list request."); if (!query) return; try { return res.json({ data: await service.list({ ...query, archived: query.archived === "true" }) }); } catch (error) { return handleError(error, res, "list"); } }
async function createProject(req, res) { const body = parse(createProjectSchema, req.body, res, "Enter a project name, and the client's name and WhatsApp number."); if (!body) return; try { return res.status(201).json({ data: await service.create(body, req.user.id) }); } catch (error) { return handleError(error, res, "create"); } }
async function editProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); const body = parse(editProjectSchema, req.body, res, "Enter a valid project name."); if (!params || !body) return; try { return res.json({ data: await service.edit(params.projectId, body) }); } catch (error) { return handleError(error, res, "edit"); } }
async function archiveProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await service.archive(params.projectId) }); } catch (error) { return handleError(error, res, "archive"); } }
async function restoreProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await service.restore(params.projectId) }); } catch (error) { return handleError(error, res, "restore"); } }
async function deleteProject(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { await service.remove(params.projectId); return res.status(204).end(); } catch (error) { return handleError(error, res, "delete"); } }

module.exports = { listProjects, createProject, editProject, archiveProject, restoreProject, deleteProject };
