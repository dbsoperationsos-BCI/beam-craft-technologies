/**
 * Resource Management → Recycling Bin: the projects somebody deleted, waiting to be restored or
 * deleted permanently.
 *
 * Deleting a project (the ⋮ menu's Delete, the tick boxes' bulk delete, Pre Production → Import's
 * replace) never erases anything: `retireProjectWithin` in the projects controller stamps the project
 * and what went with it - galleries hidden, client login switched off, client storage taken off the
 * register - and records how, so this file can put back exactly that and nothing else. Items stay
 * here until somebody deletes them permanently; there is no automatic emptying.
 *
 * Every project read here is one the caller reaches through `ASSET / Recycling Bin` (its branch, by
 * `dataScope`) - a write at READ_WRITE reach - so an id from the URL is never trusted on its own.
 */

const fs = require("fs");
const prisma = require("../../config/db");
const dataScope = require("../../services/dataScope.service");
const objectStorage = require("../../services/objectStorage");
const { CLIENT_ROLE } = require("../../services/loginCredentials");
const { restoreProjectClientStorage } = require("./client-storage.service");
// Image Selection's own purge, reused whole: this file never learns what a derivative is.
const imageSelectionProjects = require("../image-selection/projects/service");

const RECYCLING_BIN = { module: "ASSET", feature: "Recycling Bin" };
const BIN_SCOPE_COLUMNS = { branch: "branchId" };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const binScope = (userId, level = "READ") => dataScope.resolve({ userId: Number(userId), ...RECYCLING_BIN, columns: BIN_SCOPE_COLUMNS, level });

const LIST_SELECT = {
  id: true, eventId: true, whatsappGroupName: true, vertical: true, clientMainNumber: true, sourceBranch: true, branchId: true,
  deletedAt: true, deletedByUser: { select: { id: true, name: true } },
};

const listRow = (project) => ({
  id: project.id,
  eventId: project.eventId,
  whatsappGroupName: project.whatsappGroupName,
  vertical: project.vertical || null,
  clientMainNumber: project.clientMainNumber || null,
  sourceBranch: project.sourceBranch || null,
  deletedAt: project.deletedAt,
  deletedBy: project.deletedByUser ? { id: project.deletedByUser.id, name: project.deletedByUser.name } : null,
});

/** The deleted projects this caller reaches, most recently deleted first. */
async function listDeletedProjects(userId) {
  const scope = await binScope(userId);
  const rows = await prisma.salesProject.findMany({
    where: { deletedAt: { not: null }, AND: [scope.where] },
    select: LIST_SELECT,
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
    take: 2000,
  });
  return rows.map(listRow);
}

/**
 * One deleted project in full, for the bin's read-only view - at READ reach, exactly as the list.
 * The fields the project panels show (`commonProjectInfoSections`), and nothing that would need the
 * project's own permissions to read: no shoots, payments or activity.
 */
async function getDeletedProject(userId, id) {
  const scope = await binScope(userId);
  const project = await prisma.salesProject.findFirst({
    where: { id: String(id), deletedAt: { not: null }, AND: [scope.where] },
    select: {
      ...LIST_SELECT, enquiryId: true, projectStatus: true, crmName: true, mainEventDateKnown: true, mainEventDate: true,
      initialConvertedValue: true, deliverables: true, deliverablesDetails: true,
      salesPreProductionRemarks: true, salesProductionRemarks: true, salesPostProductionRemarks: true, createdAt: true, updatedAt: true,
    },
  });
  if (!project || !scope.allows(project)) throw httpError(404, "This project is not in the Project Vault.");
  const record = { ...project, ...listRow(project), initialConvertedValue: project.initialConvertedValue === null ? null : String(project.initialConvertedValue) };
  delete record.deletedByUser;
  delete record.branchId;
  return record;
}

/** One project in the bin that this caller may act on at READ_WRITE reach, or a 404. */
async function binnedProject(userId, id) {
  const scope = await binScope(userId, "READ_WRITE");
  const project = await prisma.salesProject.findFirst({
    where: { id: String(id), deletedAt: { not: null }, AND: [scope.where] },
    select: { ...LIST_SELECT, sheetEventId: true, purgingAt: true },
  });
  if (!project || !scope.allows(project)) throw httpError(404, "This project is not in the Project Vault.");
  return project;
}

/**
 * Whether a live project now holds one of this project's unique values, so restoring it would make
 * two. The database's unique keys make this all but impossible today - the deleted row keeps its
 * Event ID - but it is asked rather than assumed, so a refusal is a sentence instead of a 500.
 */
async function restoreClash(client, project) {
  const keys = [{ eventId: project.eventId }, ...(project.sheetEventId ? [{ sheetEventId: project.sheetEventId }] : [])];
  return client.salesProject.findFirst({ where: { id: { not: project.id }, deletedAt: null, OR: keys }, select: { id: true, eventId: true } });
}

const STALE_CLAIM_MS = 15 * 60 * 1000;
const BUSY_MESSAGE = "This project is already being deleted permanently or restored. Reload the Project Vault.";
const CLASH_MESSAGE = (project) => `Event ID ${project.eventId} is now used by another project, so this project cannot be restored.`;

/**
 * Restore: the whole project back exactly as it was before the delete.
 *
 * Only what that delete touched comes back, matched on what it recorded:
 *   - the project itself (`deletedAt`, `deletedByUserId` cleared);
 *   - its Image Selection galleries carrying the project's own `deletedAt` - a gallery deleted on
 *     its own, at another moment, stays deleted;
 *   - the client login, only one this delete switched off (stamped with the project's `deletedAt` in
 *     `deactivatedWithProjectAt`) and still INACTIVE - a login an admin switched off, before or since,
 *     stays off;
 *   - client storage records removed with the project's reason at that deletion
 *     (`restoreProjectClientStorage`).
 *
 * One transaction, claimed on the project's own `deletedAt` and on no Delete permanently being under
 * way (`purgingAt`), so two restores - or a restore and a Delete permanently - cannot both act on it.
 */
async function restoreDeletedProject(userId, id) {
  const project = await binnedProject(userId, id);
  if (project.purgingAt) throw httpError(409, BUSY_MESSAGE);
  if (await restoreClash(prisma, project)) throw httpError(409, CLASH_MESSAGE(project));
  const { deletedAt } = project;
  try {
    return await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.salesProject.updateMany({
        where: { id: project.id, deletedAt, purgingAt: null },
        data: { deletedAt: null, deletedByUserId: null },
      });
      if (claimed.count !== 1) throw httpError(409, BUSY_MESSAGE);
      const galleries = await transaction.imageSelectionProject.updateMany({ where: { salesProjectId: project.id, deletedAt }, data: { deletedAt: null } });
      const logins = await transaction.user.updateMany({
        where: { clientProjectId: project.id, role: CLIENT_ROLE, status: "INACTIVE", deactivatedWithProjectAt: deletedAt },
        data: { status: "ACTIVE", deactivatedWithProjectAt: null },
      });
      // A stamped login somebody has since changed by hand is left as they left it; only the stamp goes.
      await transaction.user.updateMany({ where: { clientProjectId: project.id, deactivatedWithProjectAt: { not: null } }, data: { deactivatedWithProjectAt: null } });
      const storage = await restoreProjectClientStorage(transaction, project.id, { deletedAt, userId });
      return { id: project.id, eventId: project.eventId, gallery: galleries.count, clientLogin: logins.count, storage };
    });
  } catch (error) {
    if (error?.code === "P2002") throw httpError(409, CLASH_MESSAGE(project));
    throw error;
  }
}

/**
 * Delete permanently: the project and everything hanging off it, for good - and its photos.
 *
 * `confirmEventId` is the Event ID the person confirmed in the dialog, checked against the project's
 * own: a request that does not name the right project erases nothing (400).
 *
 * **Claimed before anything is destroyed.** `purgingAt` is stamped on the project - only while it is
 * in the bin and nobody else holds it - so a Restore or a second Delete permanently (a double-click)
 * arriving meanwhile is refused with a 409 rather than racing this and leaving a restored project
 * whose photos are gone.
 *
 * Then Image Selection's own purge, for each of the project's galleries on the Projects page side.
 * **An Album Proofing gallery is not purged**: its proof pages carry upload ids no foreign key
 * protects, so emptying its photos would leave proofs standing and broken. It is only unlinked from
 * the project below (`salesProjectId: null`), staying soft-deleted as the delete left it. A bucket
 * failure stops here: the claim is released and the project stays in the bin, so pressing Delete
 * permanently again retries exactly what remains - though a gallery purged before the failure has
 * already lost its photos, which the 502 says.
 *
 * Then the row, in one transaction, and the database takes what hangs off it: shoots, pre
 * production, production with its team, crew, footage and files, deliverables, post production,
 * extra quotations, feedback, attachments, the CRD document. Payments, payment-request expenses and
 * client storage discs are records of money and objects, not of the project: they stay, with their
 * project cleared. The files the rows pointed at - attachments on disk, production files in the
 * bucket - are removed after the transaction, best-effort, as their own deletes do.
 */
async function purgeDeletedProject(userId, id, { confirmEventId } = {}) {
  const project = await binnedProject(userId, id);
  if (String(confirmEventId || "").trim() !== project.eventId) throw httpError(400, `Confirm the Event ID ${project.eventId} to delete this project permanently.`);
  // A claim older than `STALE_CLAIM_MS` belonged to a process that died mid-purge: it may be taken over,
  // or the project would be stuck in the bin for ever. Restore never takes one - its photos may be gone.
  const now = new Date();
  const claimed = await prisma.salesProject.updateMany({
    where: { id: project.id, deletedAt: { not: null }, OR: [{ purgingAt: null }, { purgingAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }] },
    data: { purgingAt: now },
  });
  if (claimed.count !== 1) throw httpError(409, BUSY_MESSAGE);

  const galleries = await prisma.imageSelectionProject.findMany({ where: { salesProjectId: project.id, albumProofing: false }, select: { id: true } });
  let purged = 0;
  for (const gallery of galleries) {
    try {
      await imageSelectionProjects.purgeData(gallery.id);
      purged += 1;
    } catch (error) {
      console.error(`Project Vault: the photos of Image Selection project ${gallery.id} (sales project ${project.id}) could not be erased:`, error?.message || error);
      await prisma.salesProject.updateMany({ where: { id: project.id }, data: { purgingAt: null } });
      throw httpError(502, purged
        ? "Some of the project's photos could not be erased, and some already are. The project was left in the Project Vault; try Delete permanently again."
        : "The project's photos could not be erased, so it was left in the Project Vault. Try again.");
    }
  }
  const files = await prisma.$transaction(async (transaction) => {
    const [attachments, productionFiles] = await Promise.all([
      transaction.projectAttachment.findMany({ where: { projectId: project.id }, select: { filePath: true } }),
      transaction.projectProductionFile.findMany({ where: { production: { salesProjectId: project.id } }, select: { url: true } }),
    ]);
    await transaction.imageSelectionWhatsAppNotification.deleteMany({ where: { salesProjectId: project.id } });
    // Album Proofing galleries are unlinked here, never purged (see above).
    await transaction.imageSelectionProject.updateMany({ where: { salesProjectId: project.id }, data: { salesProjectId: null } });
    // Only while this claim still holds it.
    const removed = await transaction.salesProject.deleteMany({ where: { id: project.id, deletedAt: { not: null }, purgingAt: { not: null } } });
    if (removed.count !== 1) throw httpError(409, BUSY_MESSAGE);
    return { attachments, productionFiles };
  }, { timeout: 60000 }).catch(async (error) => {
    // The row is still there (the transaction rolled back): release the claim so it can be retried.
    await prisma.salesProject.updateMany({ where: { id: project.id }, data: { purgingAt: null } }).catch(() => {});
    throw error;
  });
  for (const attachment of files.attachments) fs.promises.unlink(attachment.filePath).catch(() => {});
  // `deleteObject` is best-effort and never throws, and skips inline data and links it does not own.
  await Promise.all(files.productionFiles.map((file) => objectStorage.deleteObject(file.url)));
  return { id: project.id, eventId: project.eventId, galleries: galleries.length };
}

module.exports = { RECYCLING_BIN, listDeletedProjects, getDeletedProject, restoreDeletedProject, purgeDeletedProject, restoreClash };
