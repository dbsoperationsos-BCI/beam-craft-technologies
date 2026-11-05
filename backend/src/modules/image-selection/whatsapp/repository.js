const prisma = require("../../../config/db");
const { createRepository: createProjectRepository } = require("../projects/repository");
const notificationSelect = { id: true, status: true, providerMessageId: true, idempotencyKey: true, recipientMasked: true, template: true, sentAt: true, errorCode: true, errorMessage: true };
function createWhatsappRepository(client = prisma) {
  // The project rows the group link lives on, read and written through the projects repository so
  // a linked project comes back in the same full shape the sidebar and workspace already hold.
  const projects = createProjectRepository(client);
  return {
    findProject: (id) => projects.findProject(id),
    // The live project - not archived, not deleted, Projects page only - already holding this
    // group, if any. Album Proofing shares the table and is never linked from here.
    findLiveProjectByGroupJid: (jid, excludeId) => client.imageSelectionProject.findFirst({ where: { whatsappGroupJid: jid, albumProofing: false, deletedAt: null, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, projectName: true } }),
    // Every live project's link, for marking a picker's taken groups and for the match-all pass.
    listLiveProjectLinks: () => client.imageSelectionProject.findMany({ where: { albumProofing: false, deletedAt: null, archivedAt: null }, select: { id: true, projectName: true, whatsappGroupJid: true }, orderBy: { createdAt: "asc" } }),
    linkGroup: (id, { jid, subject }) => projects.updateProject(id, { whatsappGroupJid: jid, whatsappGroupSubject: subject || null, whatsappGroupLinkedAt: new Date() }),
    unlinkGroup: (id) => projects.updateProject(id, { whatsappGroupJid: null, whatsappGroupSubject: null, whatsappGroupLinkedAt: null }),
    findByKey: (idempotencyKey) => client.imageSelectionWhatsAppNotification.findUnique({ where: { idempotencyKey }, select: notificationSelect }), findById: (id) => client.imageSelectionWhatsAppNotification.findUnique({ where: { id }, select: { ...notificationSelect, messageSnapshot: true } }), create: (data) => client.imageSelectionWhatsAppNotification.create({ data, select: notificationSelect }), update: (id, data) => client.imageSelectionWhatsAppNotification.update({ where: { id }, data, select: notificationSelect }),
  };
}
module.exports = createWhatsappRepository(); module.exports.createWhatsappRepository = createWhatsappRepository;
