const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { everyChunk } = require("../../../services/wordChunks");
const { MODULES, MODULE_KEYS, manualModules } = require("./modules");

/**
 * The AI Culling, AI Editing and Signature Album projects (`visual_curation_module_project`), and
 * the one Create Project every Visual Curation module shares.
 *
 * Creating: the form names its own module (`sourceModule`) and the modules ticked under Linked
 * Modules; one transaction (`projects/service.create`) makes the photo workspace - Photo Selection's
 * project when Photo Selection is among them - and a record of its own for each of AI Culling, AI
 * Editing and Signature Album, all linked by that and nothing else. Every module named needs the
 * creator's Read / Write on it, checked here on the server: a module the form did not offer is
 * refused just the same.
 *
 * Each record is then its module's alone: listed only in its module, edited there (its name and
 * client, never another module's), and deleted there - which takes that module off the workspace and
 * keeps its photos and results for the others, deleting the workspace outright only when it was the
 * last module on it. The photos, runs, edits and album stay on the workspace, so every send between
 * modules works as it did, into the linked sibling's module and nowhere else.
 */

const RECORD_MODULES = ["culling", "editing", "album"];
const IS = "IMAGE_SELECTION";

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

/**
 * The modules a create request would make projects in: the current module and its Linked Modules,
 * or - from an older form - its ticks, read as `projects/service.create` reads them.
 */
function modulesOfCreate(body = {}) {
  if (body.salesProjectId) return [];
  if (body.sourceModule) return [...new Set([body.sourceModule, ...(Array.isArray(body.linkedModules) ? body.linkedModules : [])])];
  const tabs = body.workspaceTabs;
  return [
    (tabs?.photoSelection ?? true) && "photos",
    (tabs?.photoCulling ?? false) && "culling",
    (tabs?.aiEditing ?? true) !== false && "editing",
    (tabs?.signatureAlbum ?? false) && "album",
  ].filter(Boolean);
}

/**
 * Route guard for creating a project: Read / Write on every module it would be created in. A module
 * the form never offered - or one whose permission was taken away after the form opened - is
 * refused here, whatever the request says.
 */
async function requireCreatePermissions(req, res, next) {
  try {
    const modules = modulesOfCreate(req.body || {});
    const unknown = modules.filter((module) => !MODULES[module]);
    if (unknown.length) return res.status(400).json({ message: "Choose modules from AI Culling, AI Editing, Photo Selection and Signature Album." });
    for (const module of modules) {
      if (!(await iamService.hasPermission(req.user.id, IS, MODULES[module].feature, "READ_WRITE")))
        return res.status(403).json({ message: `You can't create projects in ${MODULES[module].label}.`, code: "MODULE_CREATE_FORBIDDEN", module });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const workspaceSelect = {
  id: true, projectCode: true, projectName: true, salesProjectId: true, disabledAt: true, archivedAt: true, deletedAt: true, albumProofing: true,
  createdAt: true, updatedAt: true, photoSelectionTab: true, photoCullingTab: true, aiEditingTab: true, signatureAlbumTab: true,
};
const recordSelect = { id: true, module: true, projectCode: true, projectName: true, clientName: true, clientMainNumber: true, createdAt: true, updatedAt: true, imageSelectionProjectId: true };

function createModuleProjects(client = prisma, dependencies = {}) {
  const hasPermission = dependencies.hasPermission || ((userId, module, level) => iamService.hasPermission(userId, IS, MODULES[module].feature, level));
  // Required lazily: the project service requires this file's neighbour, and the list reads it.
  const projectService = () => dependencies.projectService || require("./service");
  const projectModules = () => dependencies.projectModules || require("./modules");
  // Linked Modules, over the same client and permission check as this file.
  let linksService = null;
  const moduleLinks = () => dependencies.moduleLinks || (linksService ||= require("./moduleLinks").createModuleLinks(client, { hasPermission }));

  /** The modules the viewer may open, so a linked project in one they cannot is never named. */
  async function readableModules(userId) {
    const entries = await Promise.all(MODULE_KEYS.map(async (module) => [module, await hasPermission(userId, module, "READ")]));
    return new Set(entries.filter(([, can]) => can).map(([module]) => module));
  }

  /**
   * One module's projects, as its Projects page lists them: its own records - each with its own ID,
   * name and client, and the projects in the other modules it was created with, named only where
   * the viewer may open that module - and the projects from Project Management that module is on.
   * The row's `id` is the photo workspace, which every screen inside a project works over.
   */
  async function list(module, { search = "" } = {}, userId) {
    if (!RECORD_MODULES.includes(module)) throw httpError(400, "Unknown module.");
    const readable = await readableModules(userId);
    const records = await client.visualCurationModuleProject.findMany({
      where: {
        module,
        imageSelectionProject: { deletedAt: null, albumProofing: false, archivedAt: null },
        ...(search.trim() ? { AND: everyChunk(search, (chunk) => ({ OR: [{ projectName: { contains: chunk } }, { projectCode: { contains: chunk } }, { clientName: { contains: chunk } }] })) } : {}),
      },
      select: { ...recordSelect, imageSelectionProject: { select: workspaceSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    // Each project's Linked Modules as this module's project sees them: only the modules the viewer
    // may open, and `linkedModules` - the read-only list - only the ones still linked.
    const links = await moduleLinks().listContext(records.map((record) => record.imageSelectionProjectId), userId);
    const own = records.map(({ imageSelectionProject: workspace, ...record }) => {
      const { moduleLinks: state, unlinkedPairs } = links.describe(workspace, module);
      const linked = state.filter((entry) => entry.linked).map(({ module: other, projectCode, projectName }) => ({ module: other, projectCode, projectName }));
      return {
        id: workspace.id, moduleProjectId: record.id, module,
        projectCode: record.projectCode, projectName: record.projectName, clientName: record.clientName, clientMainNumber: record.clientMainNumber,
        salesProjectId: null, disabledAt: workspace.disabledAt, createdAt: record.createdAt, updatedAt: workspace.updatedAt,
        photoSelectionTab: workspace.photoSelectionTab, photoCullingTab: workspace.photoCullingTab, aiEditingTab: workspace.aiEditingTab, signatureAlbumTab: workspace.signatureAlbumTab,
        linkedModules: linked, moduleLinks: state, unlinkedPairs,
      };
    });
    // Projects from Project Management carry no records: the module is on them by their allocation,
    // read by the workspace when one is opened, as it always has been. Listed the way Photo
    // Selection lists them (live, from their first shoot's day), only for a viewer who may open them.
    const fromProduction = readable.has(module) ? (await projectService().list({ search, archived: false, sort: "dateAdded", order: "desc" })).filter((row) => row.salesProjectId) : [];
    return [...own, ...fromProduction.map((row) => ({ ...row, moduleProjectId: null, module, linkedModules: [] }))];
  }

  async function findRecord(recordId) {
    const record = await client.visualCurationModuleProject.findUnique({ where: { id: recordId }, select: { ...recordSelect, imageSelectionProject: { select: workspaceSelect } } });
    if (!record || record.imageSelectionProject.deletedAt || record.imageSelectionProject.albumProofing) throw httpError(404, "Project not found.");
    return record;
  }

  /**
   * This module's project's name and client - never Photo Selection's or another module's - and,
   * with `links`, its Linked Modules (`moduleLinks.apply`), in one transaction with the name.
   */
  async function edit(recordId, input, userId) {
    const record = await findRecord(recordId);
    const data = { projectName: input.projectName };
    if (input.clientName !== undefined) data.clientName = input.clientName;
    if (input.clientMainNumber !== undefined) data.clientMainNumber = input.clientMainNumber;
    if (!input.links) return client.visualCurationModuleProject.update({ where: { id: record.id }, data, select: recordSelect });
    let updated = null;
    const changed = await moduleLinks().apply(record.imageSelectionProjectId, record.module, input.links, userId, {
      alsoWrite: async (tx) => { updated = await tx.visualCurationModuleProject.update({ where: { id: record.id }, data, select: recordSelect }); },
      copyFrom: { projectName: data.projectName, clientName: data.clientName ?? record.clientName, clientMainNumber: data.clientMainNumber ?? record.clientMainNumber },
    });
    return { ...updated, links: changed };
  }

  /**
   * Deletes this module's project. With other modules still on the workspace, only this module
   * leaves it: the record goes and the module's tick is cleared, in one transaction, and every photo,
   * run, edit or album it made stays for the projects it was created with. Refused mid-run and while
   * the album is published to the client. As the workspace's last module, the workspace goes too,
   * by Photo Selection's own delete and its safeguards.
   */
  async function remove(recordId, options = {}) {
    const record = await findRecord(recordId);
    const workspace = record.imageSelectionProject;
    const blocker = await projectModules().unlinkBlocker(workspace, record.module, { allowLast: true });
    if (blocker) throw httpError(409, blocker);
    const others = [...manualModules(workspace)].filter((module) => module !== record.module);
    if (others.length) {
      await client.$transaction([
        client.visualCurationModuleProject.delete({ where: { id: record.id } }),
        client.imageSelectionProject.update({ where: { id: workspace.id }, data: { [MODULES[record.module].flag]: false } }),
      ]);
      return { id: record.id, deleted: "module", remainingModules: others };
    }
    await projectService().remove(workspace.id, { ...options, asLastModule: true });
    await client.visualCurationModuleProject.deleteMany({ where: { imageSelectionProjectId: workspace.id } });
    return { id: record.id, deleted: "project", remainingModules: [] };
  }

  return { list, edit, remove, findRecord };
}

const moduleProjects = createModuleProjects();

/**
 * Route guard for one module project: the viewer's permission on the record's own module - Read to
 * look, Read / Write to edit or delete - so an id from another module is answered by that module's
 * permission, never this route's.
 */
function requireRecordPermission(req, res, next) {
  const level = req.method === "GET" || req.method === "HEAD" ? "READ" : "READ_WRITE";
  moduleProjects.findRecord(String(req.params.recordId))
    .then(async (record) => {
      if (!(await iamService.hasPermission(req.user.id, IS, MODULES[record.module].feature, level)))
        return res.status(403).json({ message: `You don't have ${level} permission for ${MODULES[record.module].label}.` });
      req.moduleProject = record;
      return next();
    })
    .catch((error) => (error.status ? res.status(error.status).json({ message: error.message }) : next(error)));
}

/** Route guard for a module's list: Read on the module named in the query. */
function requireListPermission(req, res, next) {
  const module = String(req.query.module || "");
  if (!RECORD_MODULES.includes(module)) return res.status(400).json({ message: "Unknown module." });
  return iamService.hasPermission(req.user.id, IS, MODULES[module].feature, "READ")
    .then((can) => (can ? next() : res.status(403).json({ message: `You don't have READ permission for ${MODULES[module].label}.` })))
    .catch(next);
}

module.exports = moduleProjects;
module.exports.createModuleProjects = createModuleProjects;
module.exports.requireCreatePermissions = requireCreatePermissions;
module.exports.requireRecordPermission = requireRecordPermission;
module.exports.requireListPermission = requireListPermission;
module.exports.modulesOfCreate = modulesOfCreate;
module.exports.RECORD_MODULES = RECORD_MODULES;
