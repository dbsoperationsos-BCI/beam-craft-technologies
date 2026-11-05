const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { ACTIVE_STATUSES: CULLING_ACTIVE_STATUSES } = require("../ai-culling/constants");

/**
 * Which Visual Curation modules an Image Selection project belongs to - Photo Selection, AI Culling,
 * AI Editing, Signature Album. Which of them are linked to each other is `moduleLinks.js`'s.
 *
 * Every module works over the same project record (its folders and photos), and a module joins it
 * only explicitly - Create Project's or Edit Project's Linked Modules - never by a matching name or
 * client. Transfers between modules stay exactly what they were, inside the one project;
 * `assertModule` is what lets each of them refuse a module the project has no project in.
 *
 * A manual project records its modules on its own row (the four ticks); a project linked to Project
 * Management earns them from its Post Production Allocation, read with the workspace's own rule
 * (`frontend/src/lib/imageSelectionTabs.mjs`), and is never linked or unlinked here.
 */

const MODULES = Object.freeze({
  photos: { flag: "photoSelectionTab", label: "Photo Selection", feature: "Project Management" },
  culling: { flag: "photoCullingTab", label: "AI Culling", feature: "AI Culling" },
  editing: { flag: "aiEditingTab", label: "AI Editing", feature: "AI Editing" },
  album: { flag: "signatureAlbumTab", label: "Signature Album", feature: "Signature Album" },
});
const MODULE_KEYS = Object.keys(MODULES);
// The deliverable names a linked project's allocation earns a module by (contained, normalized).
const ALBUM_BASES = ["signaturealbum"];
const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

/** A manual project's modules, from its ticks: null is a project from before the form asked. */
function manualModules(project) {
  const on = new Set();
  if (project.photoSelectionTab !== false) on.add("photos");
  if (project.photoCullingTab !== false) on.add("culling");
  if (project.aiEditingTab !== false) on.add("editing");
  if (project.signatureAlbumTab === true) on.add("album");
  return on;
}

/** A linked project's modules, from its allocated services - the workspace's `linkedWorkspaceTabIds`. */
function linkedModules(services = []) {
  const on = new Set(["culling", "editing"]);
  if (services.some((service) => service.selectable === true)) on.add("photos");
  if (services.some((service) => service.imageSelectionEnabled === true && ALBUM_BASES.some((base) => normalized(service.key || service.name).includes(base)))) on.add("album");
  return on;
}

const projectSelect = { id: true, projectName: true, salesProjectId: true, archivedAt: true, deletedAt: true, albumProofing: true, photoSelectionTab: true, photoCullingTab: true, aiEditingTab: true, signatureAlbumTab: true };

function createProjectModules(client = prisma, dependencies = {}) {
  const allocatedServices = dependencies.allocatedServices
    || ((projectId) => require("../deliverables/service").createDeliverableService().listAllocatedServices(projectId));

  // Only the Projects page's own rows: Album Proofing files its projects in the same table.
  const findProject = (projectId) => client.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null, albumProofing: false }, select: projectSelect });

  async function modulesOf(projectOrId) {
    const project = typeof projectOrId === "string" ? await findProject(projectOrId) : projectOrId;
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project.salesProjectId ? linkedModules(await allocatedServices(project.id)) : manualModules(project);
  }

  /**
   * Refuses work for a module the project has no project in - every send between modules asks this
   * of its destination (`moduleLinks.assertLinked`), before asking whether the two are linked.
   */
  async function assertModule(projectId, module) {
    const modules = await modulesOf(projectId);
    if (!modules.has(module)) throw httpError(409, `This project has no ${MODULES[module].label} project, so nothing can be sent there. Tick ${MODULES[module].label} under Edit Project → Linked Modules to link one.`, "MODULE_NOT_LINKED");
  }

  /**
   * Why a module cannot be unlinked right now, or null: never the project's last module (deleting
   * the project is the way to remove that), and never mid-work or while it is live for a client -
   * the module's data is kept either way, and comes back if it is linked again.
   */
  async function unlinkBlocker(project, module, { allowLast = false } = {}) {
    const remaining = [...manualModules(project)].filter((key) => key !== module);
    if (!remaining.length && !allowLast) return `${MODULES[module].label} is this project's only module. Delete the project instead.`;
    if (module === "culling" && await client.imageSelectionCullingSession.count({ where: { projectId: project.id, status: { in: [...CULLING_ACTIVE_STATUSES] } } }))
      return "An AI Culling run is still in progress on this project. Let it finish or cancel it first.";
    if (module === "editing" && await client.imageSelectionEdit.count({ where: { projectId: project.id, status: { in: ["QUEUED", "RENDERING", "WAITING_FOR_DESKTOP"] } } }))
      return "AI Editing renders are still in progress on this project. Let them finish first.";
    if (module === "album") {
      const album = await client.signatureAlbum.findUnique({ where: { projectId: project.id }, select: { status: true, expiresAt: true } });
      if (album?.status === "PUBLISHED" && (!album.expiresAt || new Date(album.expiresAt) > new Date()))
        return "The Signature Album is published to the client. Unpublish it first.";
    }
    if (module === "photos") {
      const publication = await client.imageSelectionGalleryPublication.findUnique({ where: { projectId: project.id }, select: { status: true } });
      if (publication?.status === "PUBLISHED") return "The Photo Selection gallery is published to the client. Unpublish it first.";
    }
    return null;
  }

  return { modulesOf, assertModule, unlinkBlocker, findProject };
}

const projectModules = createProjectModules();

/**
 * Route guard for the photo workspace a module works in - its folders, photos and previews, uploads,
 * originals and allocated services - shared by Photo Selection, AI Culling, AI Editing and Signature
 * Album. Each module's own permission is enough for its own work, and none opens another's: the
 * request passes when the viewer holds (Read for a GET, Read / Write otherwise) the permission of a
 * module in `allowed` that this project is in. A path with no `:projectId` passes on any of them.
 * Photo Selection's own client-facing routes keep `Project Management` alone, where they mount it.
 */
function requireWorkspaceAccess(allowed = MODULE_KEYS) {
  return async (req, res, next) => {
    try {
      const level = req.method === "GET" || req.method === "HEAD" ? "READ" : "READ_WRITE";
      const holds = (module) => iamService.hasPermission(req.user.id, "IMAGE_SELECTION", MODULES[module].feature, level);
      const projectId = req.params.projectId;
      let candidates = allowed;
      if (projectId) {
        const project = await projectModules.findProject(String(projectId));
        // A project that does not exist is the route's own 404 to give.
        if (!project) return next();
        const modules = await projectModules.modulesOf(project);
        candidates = allowed.filter((module) => modules.has(module));
      }
      for (const module of candidates) if (await holds(module)) return next();
      return res.status(403).json({ message: "You don't have access to this project in any Visual Curation module you hold." });
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  };
}

module.exports = projectModules;
module.exports.requireWorkspaceAccess = requireWorkspaceAccess;
module.exports.createProjectModules = createProjectModules;
module.exports.MODULES = MODULES;
module.exports.MODULE_KEYS = MODULE_KEYS;
module.exports.manualModules = manualModules;
module.exports.linkedModules = linkedModules;
