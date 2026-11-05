const express = require("express");
const { z } = require("zod");
const { protect } = require("../../../middleware/authMiddleware");
const { createImageSelectionProjectService } = require("./service");
const moduleProjects = require("./moduleProjects");
const { requireCreatePermissions, requireRecordPermission, requireListPermission } = moduleProjects;
const { editProjectSchema, normalizeClientMainNumber } = require("./validation");

/**
 * `/api/image-selection/module-projects` - every Visual Curation module's Create Project, and the
 * AI Culling, AI Editing and Signature Album projects' list, edit and delete (moduleProjects.js).
 * Not under the projects router's Project Management guard: each module's own permission decides
 * its own projects - Read / Write on every module a create names, Read on the module a list names,
 * and the record's own module for an edit or a delete.
 */
const router = express.Router();
router.use(protect);

const moduleKey = z.enum(["photos", "culling", "editing", "album"]);
const createSchema = z.object({
  projectName: z.string().trim().min(1).max(500),
  clientName: z.string().trim().min(1).max(191),
  clientMainNumber: z.string().trim().min(1).max(30).transform((value) => normalizeClientMainNumber(value)),
  sourceModule: moduleKey,
  linkedModules: z.array(moduleKey).max(3).optional().default([]),
}).superRefine((value, ctx) => {
  if (!value.clientMainNumber) ctx.addIssue({ code: "custom", path: ["clientMainNumber"], message: "Enter a country code and exactly 10 digits." });
  if (value.linkedModules.includes(value.sourceModule)) ctx.addIssue({ code: "custom", path: ["linkedModules"], message: "The current module is always included; it is not a linked module." });
});
const listSchema = z.object({ module: z.enum(["culling", "editing", "album"]), search: z.string().trim().max(200).optional().default("") });

const projectService = createImageSelectionProjectService();
function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
  console.error(`Unable to ${action} the project:`, error);
  return res.status(500).json({ message: `Unable to ${action} the project.` });
}

// One submission, every module ticked: all of them or none (projects/service.create's transaction).
router.post("/", requireCreatePermissions, async (req, res) => {
  const body = parse(createSchema, req.body, res, "Enter a project name, and the client's name and WhatsApp number.");
  if (!body) return;
  try {
    const created = await projectService.create({ projectName: body.projectName, clientName: body.clientName, clientMainNumber: body.clientMainNumber, salesProjectId: null, modules: [body.sourceModule, ...body.linkedModules] }, req.user.id);
    const projects = [
      ...(created.photoSelectionTab ? [{ module: "photos", id: created.id, projectCode: created.projectCode, projectName: created.projectName }] : []),
      ...(created.moduleProjects || []).map((record) => ({ module: record.module, id: record.id, projectCode: record.projectCode, projectName: record.projectName })),
    ];
    return res.status(201).json({ data: { workspaceId: created.id, sourceModule: body.sourceModule, projects } });
  } catch (error) { return handleError(error, res, "create"); }
});

router.get("/", requireListPermission, async (req, res) => {
  const query = parse(listSchema, req.query, res, "Invalid project list request.");
  if (!query) return;
  try { return res.json({ data: await moduleProjects.list(query.module, { search: query.search }, req.user.id) }); } catch (error) { return handleError(error, res, "load"); }
});

router.patch("/:recordId", requireRecordPermission, async (req, res) => {
  const body = parse(editProjectSchema, req.body, res, "Enter a valid project name, and the client's name and WhatsApp number.");
  if (!body) return;
  try { return res.json({ data: await moduleProjects.edit(req.params.recordId, body, req.user.id) }); } catch (error) { return handleError(error, res, "edit"); }
});

router.delete("/:recordId", requireRecordPermission, async (req, res) => {
  try { return res.json({ data: await moduleProjects.remove(req.params.recordId, { acknowledgeSubmitted: req.query.acknowledgeSubmitted === "true" }) }); } catch (error) { return handleError(error, res, "delete"); }
});

module.exports = router;
