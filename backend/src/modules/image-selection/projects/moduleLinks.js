const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { nextIdentifier } = require("../../../services/identifiers");
const { MODULES, MODULE_KEYS, manualModules, createProjectModules } = require("./modules");

/**
 * Edit Project's Linked Modules: which of a project's sibling modules it is linked to, and changing
 * that - one pair at a time (`visual_curation_module_link`).
 *
 * The four modules' projects on one photo workspace share its folders and photos. Two of them are
 * **linked** when both are on the workspace and their pair has not been unticked; projects made
 * together are linked without a row. Unticking writes the pair's row (`unlinkedAt`), ticking clears
 * it again - so a relink reconnects the very project that was unlinked, under its own ID, and never
 * makes a second one. Unlinking stops sends between those two modules (`requireProjectLink`, and the
 * automatic album sync) and nothing else: no project, photo, run, edit or album is touched, and each
 * project stays in its own module.
 *
 * Ticking a module that has no project on the workspace makes one - its own ID, the name and client
 * copied from the project being edited - linked to that project and to any other module ticked in
 * the same save (as Create Project links what it makes together), and to nothing else.
 *
 * A project from Project Management takes its modules from its allocation and is always linked.
 */

const IS = "IMAGE_SELECTION";
const RECORD_SCHEMES = { culling: "VC_AI_CULLING", editing: "VC_AI_EDITING", album: "VC_SIGNATURE_ALBUM" };
const pairOf = (first, second) => [first, second].sort();
const pairKey = (first, second) => pairOf(first, second).join(":");

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

/**
 * Each module other than `source`, as `source`'s project sees it: whether it has a project on the
 * workspace (`member`, with that project's ID and name) and whether it is linked to this one.
 * `records` are the workspace's AI Culling / AI Editing / Signature Album projects, `unlinked` its
 * unticked pairs; Photo Selection's project is the workspace itself.
 */
function stateFrom(workspace, source, records, unlinked) {
  const members = manualModules(workspace);
  const recordOf = new Map(records.map((record) => [record.module, record]));
  return MODULE_KEYS.filter((module) => module !== source).map((module) => {
    const member = members.has(module);
    const named = module === "photos" ? workspace : recordOf.get(module);
    return {
      module, member,
      linked: member && members.has(source) && !unlinked.has(pairKey(source, module)),
      projectCode: member ? named?.projectCode || null : null,
      projectName: member ? named?.projectName || null : null,
    };
  });
}

function createModuleLinks(client = prisma, dependencies = {}) {
  const hasPermission = dependencies.hasPermission || ((userId, module, level) => iamService.hasPermission(userId, IS, MODULES[module].feature, level));
  const projectModules = dependencies.projectModules || createProjectModules(client);
  const now = dependencies.now || (() => new Date());
  const nextCode = dependencies.nextIdentifier || nextIdentifier;

  /** The pairs unlinked on each workspace named: workspace id → Set of `pairKey`s. */
  async function unlinkedPairs(workspaceIds) {
    const ids = [...new Set(workspaceIds.filter(Boolean))];
    const byWorkspace = new Map(ids.map((id) => [id, new Set()]));
    if (!ids.length) return byWorkspace;
    const rows = await client.visualCurationModuleLink.findMany({ where: { imageSelectionProjectId: { in: ids }, unlinkedAt: { not: null } }, select: { imageSelectionProjectId: true, moduleA: true, moduleB: true } });
    for (const row of rows) byWorkspace.get(row.imageSelectionProjectId)?.add(pairKey(row.moduleA, row.moduleB));
    return byWorkspace;
  }

  /** Whether two modules of a project are linked: both on it, and their pair not unticked. */
  async function areLinked(projectId, first, second) {
    const project = await projectModules.findProject(projectId);
    if (!project) return false;
    const modules = await projectModules.modulesOf(project);
    if (!modules.has(first) || !modules.has(second)) return false;
    if (project.salesProjectId) return true;
    return !(await unlinkedPairs([project.id])).get(project.id).has(pairKey(first, second));
  }

  /**
   * Refuses a send from one module into another unless their projects are linked - asked of every
   * send, so a request naming an unlinked destination fails however it was made.
   */
  async function assertLinked(projectId, source, destination) {
    await projectModules.assertModule(projectId, destination);
    if (!(await areLinked(projectId, source, destination)))
      throw httpError(409, `This ${MODULES[source].label} project is not linked to the ${MODULES[destination].label} project, so nothing can be sent there. Link them under Edit Project → Linked Modules.`, { code: "MODULE_NOT_LINKED" });
  }

  /**
   * Why a destination cannot be unlinked yet, or null. A client still holding the destination's link
   * - the published Photo Selection gallery, the published Signature Album - is unpublished first,
   * in that module, by its own workflow: unlinking never takes a client's link away by itself.
   */
  async function unlinkBlocker(workspace, destination) {
    if (destination === "photos") {
      const publication = await client.imageSelectionGalleryPublication.findUnique({ where: { projectId: workspace.id }, select: { status: true } });
      if (publication?.status === "PUBLISHED") return "The Photo Selection gallery is published to the client. Unpublish it in Photo Selection first, then unlink it.";
    }
    if (destination === "album") {
      const album = await client.signatureAlbum.findUnique({ where: { projectId: workspace.id }, select: { status: true, expiresAt: true } });
      if (album?.status === "PUBLISHED" && (!album.expiresAt || new Date(album.expiresAt) > now()))
        return "The Signature Album is published to the client. Unpublish it in Signature Album first, then unlink it.";
    }
    return null;
  }

  /**
   * Each other module, as `source`'s project sees it: whether it has a project on the workspace
   * (`member`, with its ID and name) and whether that project is linked to this one.
   */
  async function linkState(workspace, source) {
    const unlinked = (await unlinkedPairs([workspace.id])).get(workspace.id);
    const records = await client.visualCurationModuleProject.findMany({ where: { imageSelectionProjectId: workspace.id }, select: { module: true, projectCode: true, projectName: true } });
    return stateFrom(workspace, source, records, unlinked);
  }

  /**
   * What a Projects list needs to draw each manual project's Linked Modules, read once for the whole
   * list: the unticked pairs and module projects of every workspace named, and which modules the
   * viewer may see (`readable`) and change (`writable`). `describe(workspace, source)` then gives a
   * row its `moduleLinks` - only the modules the viewer may open, each saying whether they may change
   * it - and its `unlinkedPairs`, which the workspace reads to offer a send only between linked ones.
   */
  async function listContext(workspaceIds, userId) {
    const ids = [...new Set(workspaceIds.filter(Boolean))];
    const [unlinked, records, levels] = await Promise.all([
      unlinkedPairs(ids),
      ids.length ? client.visualCurationModuleProject.findMany({ where: { imageSelectionProjectId: { in: ids } }, select: { imageSelectionProjectId: true, module: true, projectCode: true, projectName: true } }) : [],
      Promise.all(MODULE_KEYS.map(async (module) => [module, await hasPermission(userId, module, "READ"), await hasPermission(userId, module, "READ_WRITE")])),
    ]);
    const recordsOf = new Map();
    for (const record of records) {
      if (!recordsOf.has(record.imageSelectionProjectId)) recordsOf.set(record.imageSelectionProjectId, []);
      recordsOf.get(record.imageSelectionProjectId).push(record);
    }
    const readable = new Set(levels.filter(([, read]) => read).map(([module]) => module));
    const writable = new Set(levels.filter(([, , write]) => write).map(([module]) => module));
    function describe(workspace, source) {
      if (workspace.salesProjectId) return { moduleLinks: [], unlinkedPairs: [] };
      const pairs = unlinked.get(workspace.id) || new Set();
      return {
        moduleLinks: stateFrom(workspace, source, recordsOf.get(workspace.id) || [], pairs).filter((entry) => readable.has(entry.module)).map((entry) => ({ ...entry, canChange: writable.has(entry.module) })),
        unlinkedPairs: [...pairs],
      };
    }
    return { describe };
  }

  /**
   * Applies Linked Modules ticks from `source`'s Edit Project: `changes` is `{ module: true|false }`
   * for the boxes the form let the viewer change, and a module it leaves out is left exactly as it
   * is. Every change needs the viewer's Read / Write on that module, and an unlink waits for the
   * destination's client link to be unpublished; all of it is checked before anything is written,
   * then written in one transaction with `alsoWrite(tx)` - the project's own name and client - so a
   * refusal leaves the project untouched. Returns what changed.
   */
  async function apply(workspaceId, source, changes, userId, { alsoWrite = null, copyFrom = null } = {}) {
    const workspace = await client.imageSelectionProject.findFirst({
      where: { id: workspaceId, deletedAt: null, albumProofing: false },
      select: { id: true, projectCode: true, projectName: true, clientName: true, clientMainNumber: true, salesProjectId: true, photoSelectionTab: true, photoCullingTab: true, aiEditingTab: true, signatureAlbumTab: true },
    });
    if (!workspace) throw httpError(404, "Project not found.");
    const wanted = Object.entries(changes || {}).filter(([module]) => module !== source);
    for (const [module] of wanted) if (!MODULES[module]) throw httpError(400, "Choose modules from AI Culling, AI Editing, Photo Selection and Signature Album.");
    const state = new Map((await linkState(workspace, source)).map((entry) => [entry.module, entry]));
    const adds = wanted.filter(([module, on]) => on && !state.get(module).linked).map(([module]) => module);
    const removes = wanted.filter(([module, on]) => !on && state.get(module).linked).map(([module]) => module);
    if ((adds.length || removes.length) && workspace.salesProjectId)
      throw httpError(409, "This project's modules come from its Post Production Allocation in Project Management, so they are not linked or unlinked here.");

    for (const module of [...adds, ...removes]) {
      if (!(await hasPermission(userId, module, "READ_WRITE")))
        throw httpError(403, `You can't change links to ${MODULES[module].label}.`, { code: "MODULE_LINK_FORBIDDEN", module });
    }
    for (const module of removes) {
      const blocker = await unlinkBlocker(workspace, module);
      if (blocker) throw httpError(409, blocker, { code: "CLIENT_LINK_ACTIVE", module });
    }

    const members = manualModules(workspace);
    const newMembers = adds.filter((module) => !members.has(module));
    const copy = copyFrom || { projectName: workspace.projectName, clientName: workspace.clientName, clientMainNumber: workspace.clientMainNumber };
    const setPair = (tx, first, second, unlinkedAt) => {
      const [moduleA, moduleB] = pairOf(first, second);
      return tx.visualCurationModuleLink.upsert({
        where: { imageSelectionProjectId_moduleA_moduleB: { imageSelectionProjectId: workspace.id, moduleA, moduleB } },
        create: { imageSelectionProjectId: workspace.id, moduleA, moduleB, unlinkedAt, unlinkedByUserId: unlinkedAt ? userId : null },
        update: { unlinkedAt, unlinkedByUserId: unlinkedAt ? userId : null },
      });
    };

    const created = [];
    await client.$transaction(async (tx) => {
      if (alsoWrite) await alsoWrite(tx);
      for (const module of newMembers) {
        if (module === "photos") {
          // Photo Selection's project is the workspace itself, under the ID it already carries.
          await tx.imageSelectionProject.update({ where: { id: workspace.id }, data: { photoSelectionTab: true, projectName: copy.projectName, clientName: copy.clientName, clientMainNumber: copy.clientMainNumber } });
          created.push({ module, projectCode: workspace.projectCode, projectName: copy.projectName });
        } else {
          const record = await tx.visualCurationModuleProject.create({
            data: { imageSelectionProjectId: workspace.id, module, projectCode: await nextCode(RECORD_SCHEMES[module], {}, tx), projectName: copy.projectName, clientName: copy.clientName, clientMainNumber: copy.clientMainNumber, createdByUserId: userId },
            select: { module: true, projectCode: true, projectName: true },
          });
          await tx.imageSelectionProject.update({ where: { id: workspace.id }, data: { [MODULES[module].flag]: true } });
          created.push(record);
        }
        // Linked to this project and to whatever else is ticked in the same save - not to the
        // workspace's other projects, which nobody asked about.
        for (const other of members) if (other !== source) await setPair(tx, module, other, now());
      }
      for (const module of adds) await setPair(tx, source, module, null);
      for (let index = 0; index < newMembers.length; index += 1)
        for (const other of newMembers.slice(index + 1)) await setPair(tx, newMembers[index], other, null);
      for (const module of removes) await setPair(tx, source, module, now());
    });
    return { linked: adds, unlinked: removes, created };
  }

  return { unlinkedPairs, areLinked, assertLinked, unlinkBlocker, linkState, listContext, apply };
}

const moduleLinks = createModuleLinks();

/**
 * Route guard for a send between modules: every `[source, destination]` pair it writes across must
 * be linked on the project in the URL - `pairs` is a list, or a function of the request for a send
 * whose destinations depend on its body. Mounted after the permission guards, so it is the server,
 * not a hidden button, that refuses a send between unlinked projects.
 */
function requireProjectLink(pairs) {
  return (req, res, next) => {
    const wanted = typeof pairs === "function" ? pairs(req) : pairs;
    wanted.reduce((chain, [source, destination]) => chain.then(() => moduleLinks.assertLinked(String(req.params.projectId), source, destination)), Promise.resolve())
      .then(() => next())
      .catch((error) => (error.status ? res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details || {}) }) : next(error)));
  };
}

module.exports = moduleLinks;
module.exports.createModuleLinks = createModuleLinks;
module.exports.requireProjectLink = requireProjectLink;
module.exports.pairKey = pairKey;
module.exports.stateFrom = stateFrom;
