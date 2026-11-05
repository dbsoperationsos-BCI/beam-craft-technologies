const repository = require("./projects.repository");
const { cleanupService } = require("../cleanup/service");

/**
 * Album Proofing's own projects: the sidebar list, New Project (a saved WhatsApp group name or a
 * manual name), edit, archive and delete.
 *
 * Kept apart from Image Selection's project service on purpose. The two sections are different
 * jobs held by different people under different permissions, and the only thing they share is the
 * table their rows sit in — which this module's repository pins to its own rows, so nothing here
 * can list, edit or delete a Projects-page project, and Image Selection's service never sees one
 * of these.
 */
const sortFields = { name: "projectName", dateLastOpened: "lastOpenedAt", dateAdded: "createdAt", dateModified: "updatedAt", dateCreated: "createdAt", size: "totalPhotoSize" };

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }
function serialize(project) { return { ...project, totalPhotoSize: String(project.totalPhotoSize ?? 0) }; }
function orderBy(sort, order) {
  const field = sortFields[sort] || sortFields.dateAdded;
  return field === "projectName" ? [{ [field]: order }, { createdAt: order }] : [{ [field]: order }, { createdAt: order }, { id: order }];
}

/**
 * Where a project stands, for the sidebar dot, read from its albums on the product-wide progress
 * ladder: no album yet is "notStarted", every album completed is "completed", any album already
 * with the client (or done) is "partiallyCompleted", and anything else is "inProgress".
 */
function albumProgressOf(statuses) {
  if (!statuses.length) return "notStarted";
  if (statuses.every((status) => status === "COMPLETED")) return "completed";
  if (statuses.some((status) => status === "COMPLETED" || status.startsWith("CLIENT_"))) return "partiallyCompleted";
  return "inProgress";
}

function createAlbumProofingProjectService(repo = repository, dependencies = {}) {
  const cleanup = dependencies.cleanup || cleanupService;

  async function list(input) {
    const rows = await repo.listProjects({ search: input.search, archived: input.archived, orderBy: orderBy(input.sort, input.order) });
    // The dot's answer, batched once for the whole list rather than per row.
    const statusesByProject = new Map();
    for (const album of await repo.albumStatusesByProject(rows.map((row) => row.id))) {
      if (!statusesByProject.has(album.projectId)) statusesByProject.set(album.projectId, []);
      statusesByProject.get(album.projectId).push(album.status);
    }
    // Named `selectionProgress` because the shared sidebar reads that key for its dot.
    return rows.map((row) => ({ ...serialize(row), selectionProgress: albumProgressOf(statusesByProject.get(row.id) || []) }));
  }

  async function create(input, userId) {
    // A manual project carries its own client, which the schema has already insisted on: the
    // proof link has to be sent to somebody, and this is the only screen that asks.
    if (!input.salesProjectId)
      return serialize(await repo.createProject({
        projectName: input.projectName,
        sourceType: "Manual",
        clientName: input.clientName ?? null,
        clientMainNumber: input.clientMainNumber ?? null,
        createdByUserId: userId,
      }));
    // A linked project reads its client from the SalesProject, so storing a second copy here would
    // only create two answers to the same question.
    if (input.clientName != null || input.clientMainNumber != null)
      throw httpError(409, "This project takes its client details from the linked Sales Manager project. Edit them there instead.");
    return repo.transaction(async (tx) => {
      const salesProject = await tx.findSalesProject(input.salesProjectId);
      if (!salesProject) throw httpError(404, "The selected Sales Manager project no longer exists.");
      // Only a duplicate in this section refuses: the Projects page may hold a project for the same
      // group name, and vice versa — the two sidebars are disjoint lists.
      if (await tx.findProjectBySalesProjectId(salesProject.id)) throw httpError(409, "This WhatsApp group name already has an Album Proofing project.");
      return serialize(await tx.createProject({ projectName: salesProject.whatsappGroupName, sourceType: "Sales", salesProjectId: salesProject.id, createdByUserId: userId }));
    });
  }

  // A linked project's name IS the Sales Manager project's WhatsApp group name, so renaming it
  // here would give the same project two names. The sidebar hides Edit for linked projects; this
  // is the same rule enforced where it cannot be bypassed.
  async function edit(projectId, input) {
    const project = await repo.findProject(projectId, { archived: false });
    if (!project) throw httpError(404, "Active Album Proofing project not found.");
    if (project.salesProjectId) throw httpError(409, "This project is named by the linked Sales Manager project's WhatsApp group name. Change it there instead.");
    const data = { projectName: input.projectName };
    if (input.clientName !== undefined) data.clientName = input.clientName;
    if (input.clientMainNumber !== undefined) data.clientMainNumber = input.clientMainNumber;
    return serialize(await repo.updateProject(projectId, data));
  }

  async function archive(projectId) {
    if (!(await repo.findProject(projectId, { archived: false }))) throw httpError(404, "Active Album Proofing project not found.");
    return serialize(await repo.updateProject(projectId, { archivedAt: new Date() }));
  }
  async function restore(projectId) {
    if (!(await repo.findProject(projectId, { archived: true }))) throw httpError(404, "Archived Album Proofing project not found.");
    return serialize(await repo.updateProject(projectId, { archivedAt: null }));
  }

  // Delete is only for a project the studio typed itself: a linked project is the Sales Manager
  // project's presence here and is archived, never deleted. Albums are deleted one at a time, each
  // behind its own high-impact warning, so a project still holding one is refused rather than
  // swept. What is swept is what the albums left behind — page folders and derivatives — and then
  // the row is soft-deleted, so its id keeps answering 404 rather than being reusable.
  async function remove(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Album Proofing project not found.");
    if (project.salesProjectId) throw httpError(409, "This project comes from a Sales Manager WhatsApp group name and cannot be deleted. Archive it instead.");
    const albumCount = await repo.countLiveAlbums(projectId);
    if (albumCount > 0) throw httpError(409, `This project still holds ${albumCount} album${albumCount === 1 ? "" : "s"}. Delete its albums first.`);
    // Read before the purge — afterwards there are no rows left to say which files were ours.
    const uploads = await repo.listUploadFilesForPurge(projectId);
    // Cloud first, strictly: a bucket failure aborts here with the rows — and their keys — intact,
    // so retrying the delete retries exactly the objects that remain.
    await cleanup.purgeDerivatives(uploads);
    return serialize(await repo.purgeProjectData(projectId));
  }

  return { list, create, edit, archive, restore, remove };
}

module.exports = { createAlbumProofingProjectService, albumProgressOf, orderBy };
