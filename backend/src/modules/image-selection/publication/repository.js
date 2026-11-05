const prisma = require("../../../config/db");
const { heldShootFolderIds } = require("../shoot-visibility");

// `selectionValidUntil` is the expiry the studio chose for this project in Selection Settings; a
// publish uses it in place of the studio-wide validity window.
const findProject = (projectId) => prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true, selectionValidUntil: true, salesProjectId: true } });
const findByProject = (projectId) => prisma.imageSelectionGalleryPublication.findUnique({ where: { projectId } });
// The project fields every public-gallery lookup needs, whichever identifier found the row.
const publicGalleryInclude = {
  project: {
    select: {
      id: true,
      projectName: true,
      // A manually named project's own client; a linked project leaves it null and reads the group.
      clientName: true,
      deletedAt: true,
      // A project disabled from Expand pauses its link (`service.authorize`).
      disabledAt: true,
      salesProject: { select: { whatsappGroupNameId: true, groupType: true, groupNameGeneratorJson: true, mainEventDate: true } },
    },
  },
};
const findByTokenHash = (tokenHash) => prisma.imageSelectionGalleryPublication.findFirst({ where: { tokenHash, status: "PUBLISHED" }, include: publicGalleryInclude });
const findByShortCode = (shortCode) => prisma.imageSelectionGalleryPublication.findFirst({ where: { shortCode, status: "PUBLISHED" }, include: publicGalleryInclude });
// Throws Prisma's P2002 on a duplicate code, which the service treats as "roll again".
// The same row whatever its status - only for telling a link that lapsed from one that never was.
const findAnyByTokenHash = (tokenHash) => prisma.imageSelectionGalleryPublication.findFirst({ where: { tokenHash }, include: publicGalleryInclude });
const findAnyByShortCode = (shortCode) => prisma.imageSelectionGalleryPublication.findFirst({ where: { shortCode }, include: publicGalleryInclude });
const setShortCode = (projectId, shortCode) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { shortCode } });
// Both counts exclude photos a FINALIZED culling session rejected: `imageCount` feeds the
// publish guard and the client's landing badge, so a project whose cull rejected everything
// cannot publish an empty gallery. Photos with selections are never cull-stamped, so the
// selected count only changes when it should.
const countReadyImages = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY", cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null } });
// How many photos the client actually picked. The same two ways of having been chosen the download
// manifest accepts — a per-item selection, or the older whole-gallery flag — so the studio is never
// offered a download the manifest would come back empty for.
const countSelectedImages = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY", cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null, OR: [{ photoSelections: { some: {} } }, { selected: true }] } });
const publish = (projectId, data) => prisma.imageSelectionGalleryPublication.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
// `reason` says why (`revokedReason`): MANUAL for the studio's own Publish Status switch, EXPIRED for a
// lapsed link. Only an EMPTY one (`revokeEmpty` below) is ever published again by itself.
const revoke = (projectId, reason = "MANUAL") => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason } });
/*
 * How many photos the client could see in the gallery right now, across every folder and subfolder
 * and the unfiled ones: ready, not rejected by a finished cull, not waiting in AI Culling or AI
 * Editing, and not in a shoot folder held back until its date (`heldShootFolderIds`). Whether the
 * gallery is worth keeping published turns on this alone - never on one folder, a subfolder count or
 * a selection item.
 */
async function countClientVisibleImages(projectId) {
  const folders = await prisma.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, projectShoot: { select: { dateCreated: true } } } });
  const held = heldShootFolderIds(folders);
  return prisma.imageSelectionUpload.count({
    where: {
      projectId, status: "READY", cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null,
      ...(held.size ? { OR: [{ folderId: null }, { folderId: { notIn: [...held] } }] } : {}),
    },
  });
}
// Both guarded on the state they leave, so a manual switch or another sync in between wins: an empty
// gallery is revoked only while still published, and revived only while still revoked *as empty*.
// The token, PIN, short code, publish date and expiry are not touched either way.
const revokeEmpty = (projectId) => prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId, status: "PUBLISHED" }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: "EMPTY" } });
const reviveEmpty = (projectId) => prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId, status: "REVOKED", revokedReason: "EMPTY" }, data: { status: "PUBLISHED", revokedAt: null, revokedReason: null } });
const setPin = (projectId, data) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data });
const setExpiry = (projectId, expiresAt) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { expiresAt } });
const markSelectionSubmitted = async (projectId) => { const now = new Date(); await prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { selectionSubmittedAt: now } }); return now; };
/*
 * A submit's writes together, in one transaction: the items it sends (only this project's), and the
 * project-level flag once none of the items the gallery offers (`offeredIds`) is left open.
 *
 * - Touching the publication row first takes its lock, so two submits on one gallery run one after
 *   the other. Without it, two tabs each sending the last open item saw the other still open and
 *   neither set the project flag.
 * - An item another request already sent (a double press, a retry) stamps short of the count, and
 *   the whole write rolls back as already submitted: Submit All is never left with some items sent.
 *
 * Answers the instant it stamped: it is this submission's identity for the notification, so an
 * item the studio reopens and the client sends again is a new submission, not the old one again.
 */
const markSubmitted = (projectId, configIds, offeredIds) => prisma.$transaction(async (tx) => {
  const now = new Date();
  await tx.imageSelectionGalleryPublication.update({ where: { projectId }, data: { lastClientActivityAt: now, galleryLastOpenedAt: now } });
  const ids = [...new Set(configIds)];
  const stamped = await tx.imageSelectionDeliverableConfig.updateMany({ where: { id: { in: ids }, imageSelectionProjectId: projectId, selectionSubmittedAt: null }, data: { selectionSubmittedAt: now } });
  if (stamped.count !== ids.length) throw Object.assign(new Error("This selection has already been submitted. Refresh to see what was sent."), { status: 409 });
  const open = await tx.imageSelectionDeliverableConfig.count({ where: { id: { in: offeredIds }, imageSelectionProjectId: projectId, selectionSubmittedAt: null } });
  if (!open) await tx.imageSelectionGalleryPublication.update({ where: { projectId }, data: { selectionSubmittedAt: now } });
  return now;
});
// The client opened the link: the first time is kept once, the latest time moves with every open.
const markGalleryOpened = (projectId, at) => prisma.$transaction([
  prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId, galleryFirstOpenedAt: null }, data: { galleryFirstOpenedAt: at } }),
  prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId }, data: { galleryLastOpenedAt: at } }),
]);
// The client did something — picked, unpicked, or sent a selection item — which is also an open.
const markClientActivity = (projectId, at) => prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId }, data: { lastClientActivityAt: at, galleryLastOpenedAt: at } });
const findWhatsappGroupName = (id) => id ? prisma.salesWhatsappGroupName.findUnique({ where: { id }, select: { groomName: true, brideName: true, clientName: true, mainEventDate: true } }) : Promise.resolve(null);

module.exports = { findProject, findByProject, findByTokenHash, findByShortCode, findAnyByTokenHash, findAnyByShortCode, setShortCode, countReadyImages, countSelectedImages, countClientVisibleImages, publish, revoke, revokeEmpty, reviveEmpty, setPin, setExpiry, markSelectionSubmitted, markSubmitted, markGalleryOpened, markClientActivity, findWhatsappGroupName };
