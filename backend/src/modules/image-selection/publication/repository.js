const prisma = require("../../../config/db");

// `selectionValidUntil` is the expiry the studio chose for this project in Selection Settings; a
// publish uses it in place of the studio-wide validity window.
const findProject = (projectId) => prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true, selectionValidUntil: true } });
const findByProject = (projectId) => prisma.imageSelectionGalleryPublication.findUnique({ where: { projectId } });
// The project fields every public-gallery lookup needs, whichever identifier found the row.
const publicGalleryInclude = {
  project: {
    select: {
      id: true,
      projectName: true,
      deletedAt: true,
      salesProject: { select: { whatsappGroupNameId: true, groupType: true, groupNameGeneratorJson: true, mainEventDate: true } },
    },
  },
};
const findByTokenHash = (tokenHash) => prisma.imageSelectionGalleryPublication.findFirst({ where: { tokenHash, status: "PUBLISHED" }, include: publicGalleryInclude });
const findByShortCode = (shortCode) => prisma.imageSelectionGalleryPublication.findFirst({ where: { shortCode, status: "PUBLISHED" }, include: publicGalleryInclude });
// Throws Prisma's P2002 on a duplicate code, which the service treats as "roll again".
const setShortCode = (projectId, shortCode) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { shortCode } });
const countReadyImages = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY" } });
// How many photos the client actually picked. The same two ways of having been chosen the download
// manifest accepts — a per-item selection, or the older whole-gallery flag — so the studio is never
// offered a download the manifest would come back empty for.
const countSelectedImages = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY", OR: [{ photoSelections: { some: {} } }, { selected: true }] } });
const publish = (projectId, data) => prisma.imageSelectionGalleryPublication.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
const revoke = (projectId) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { status: "REVOKED", revokedAt: new Date() } });
const setPin = (projectId, data) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data });
const setExpiry = (projectId, expiresAt) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { expiresAt } });
const markSelectionSubmitted = (projectId) => prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { selectionSubmittedAt: new Date() } });
// Stamps a whole shoot's selection items as submitted in one statement, so the client cannot end up
// with half a shoot locked if the connection drops between two updates.
const markDeliverablesSubmitted = (configIds) => prisma.imageSelectionDeliverableConfig.updateMany({ where: { id: { in: configIds }, selectionSubmittedAt: null }, data: { selectionSubmittedAt: new Date() } });
// The client opened the link: the first time is kept once, the latest time moves with every open.
const markGalleryOpened = (projectId, at) => prisma.$transaction([
  prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId, galleryFirstOpenedAt: null }, data: { galleryFirstOpenedAt: at } }),
  prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId }, data: { galleryLastOpenedAt: at } }),
]);
// The client did something — picked, unpicked, or sent a selection item — which is also an open.
const markClientActivity = (projectId, at) => prisma.imageSelectionGalleryPublication.updateMany({ where: { projectId }, data: { lastClientActivityAt: at, galleryLastOpenedAt: at } });
const findWhatsappGroupName = (id) => id ? prisma.salesWhatsappGroupName.findUnique({ where: { id }, select: { groomName: true, brideName: true, clientName: true, mainEventDate: true } }) : Promise.resolve(null);

module.exports = { findProject, findByProject, findByTokenHash, findByShortCode, setShortCode, countReadyImages, countSelectedImages, publish, revoke, setPin, setExpiry, markSelectionSubmitted, markDeliverablesSubmitted, markGalleryOpened, markClientActivity, findWhatsappGroupName };
