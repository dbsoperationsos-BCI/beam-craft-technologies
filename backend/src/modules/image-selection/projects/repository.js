const { nextIdentifier } = require("../../../services/identifiers");
const prisma = require("../../../config/db");

const projectSelect = {
  id: true, projectCode: true, projectName: true, sourceType: true, salesProjectId: true, clientName: true, clientMainNumber: true, status: true,
  photoSelectionTab: true, photoCullingTab: true, signatureAlbumTab: true,
  selectionValidUntil: true, selectionValidityEnabled: true, allowPhotoSelection: true, publicSlug: true, archivedAt: true,
  lastOpenedAt: true, totalPhotoSize: true, publishVersion: true, createdByUserId: true,
  whatsappGroupJid: true, whatsappGroupSubject: true, whatsappGroupLinkedAt: true,
  deletedAt: true, createdAt: true, updatedAt: true,
};

// A linked project may only be listed while the Sales Manager project behind it is still live.
// The cascade that hides it when the booking goes is the real mechanism; this is the safety net
// under it, and the only thing that hides the rows already in the database from before that
// cascade existed. A manual project has no parent to outlive, so it is always in scope.
const LIVE_PARENT = { OR: [{ salesProjectId: null }, { salesProject: { is: { deletedAt: null } } }] };

function createRepository(client = prisma) {
  return {
    transaction: (callback) => client.$transaction((transaction) => callback(createRepository(transaction))),
    // Album Proofing files its own projects in this same table under `albumProofing: true`; every
    // query here pins the flag false, so this repository only ever sees the Projects page's rows
    // and Album Proofing's module is the only thing that can touch its own.
    listProjects: ({ search, archived, orderBy }) => client.imageSelectionProject.findMany({
      where: { deletedAt: null, albumProofing: false, ...LIVE_PARENT, archivedAt: archived ? { not: null } : null, ...(search ? { projectName: { contains: search } } : {}) },
      select: projectSelect, orderBy,
    }),
    findProject: (id, { archived } = {}) => client.imageSelectionProject.findFirst({
      where: { id, albumProofing: false, deletedAt: null, ...(archived === true ? { archivedAt: { not: null } } : archived === false ? { archivedAt: null } : {}) }, select: projectSelect,
    }),
    // Pinned like every other read here: an Album Proofing project holding this name is not a
    // reason to refuse it on the Projects page, or to name a duplicate "- Copy 2". This was the
    // one query in the file that could still see the other section's rows.
    findProjectByName: (projectName) => client.imageSelectionProject.findFirst({ where: { projectName, albumProofing: false, deletedAt: null }, select: { id: true } }),
    findSalesProject: (id) => client.salesProject.findFirst({ where: { id, deletedAt: null }, select: { id: true, whatsappGroupName: true } }),
    /*
     * The same question as `findSalesProject`, asked with the row locked.
     *
     * The sync reads its pending list and creates projects from it a moment later, so a booking
     * deleted in between would be handed a brand new Image Selection project by the very next
     * list load. A plain re-read inside the create transaction does not catch that: MySQL's
     * REPEATABLE READ answers it from the snapshot the transaction opened with, which still shows
     * the booking live. `FOR UPDATE` reads the latest committed row instead and waits on the
     * delete's own lock, so the create either finishes first and is cascaded over by the delete,
     * or blocks until the delete commits and then sees `deleted_at` set and stands down.
     */
    findLiveSalesProjectForUpdate: async (id) => {
      const rows = await client.$queryRaw`SELECT id FROM sales_project WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
      return rows.length ? { id: rows[0].id } : null;
    },
    // Sales projects the production team has moved into an in-progress state that have no Image
    // Selection presence yet — the rows the list sync turns into linked projects automatically.
    listSalesProjectsAwaitingImageProject: (statuses) => client.salesProject.findMany({
      where: { deletedAt: null, projectStatus: { in: statuses }, whatsappGroupName: { not: "" }, imageSelectionProjects: { none: { albumProofing: false } } },
      select: { id: true, whatsappGroupName: true },
    }),
    // What the sidebar dot needs to say where each project stands, batched for the whole list:
    // which projects are published, their live selection items, and which items the client has
    // picked at least one photo for.
    selectionProgressData: async (projectIds) => {
      if (!projectIds.length) return { publishedProjectIds: [], configs: [], selectedConfigIds: [] };
      const [publications, configs] = await Promise.all([
        client.imageSelectionGalleryPublication.findMany({ where: { projectId: { in: projectIds }, status: "PUBLISHED" }, select: { projectId: true } }),
        client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId: { in: projectIds }, inactiveAt: null, enabled: true }, select: { id: true, imageSelectionProjectId: true, selectionSubmittedAt: true } }),
      ]);
      const selections = configs.length
        ? await client.imageSelectionPhotoSelection.findMany({ where: { imageSelectionDeliverableConfigId: { in: configs.map((config) => config.id) } }, distinct: ["imageSelectionDeliverableConfigId"], select: { imageSelectionDeliverableConfigId: true } })
        : [];
      return { publishedProjectIds: publications.map((publication) => publication.projectId), configs, selectedConfigIds: selections.map((selection) => selection.imageSelectionDeliverableConfigId) };
    },
    // A soft-deleted project must not hold a group name hostage: only a live row counts as "already
    // has a project". The purge below releases the link on the deleted row too, so the unique index
    // is free for the next project.
    findProjectBySalesProjectId: (salesProjectId) => client.imageSelectionProject.findFirst({ where: { salesProjectId, albumProofing: false, deletedAt: null }, select: { id: true } }),
    /*
     * Every project is handed its own DBS-VCIS-000001 on the way in.
     *
     * Here rather than at the four call sites above it - a project is created from a sales project,
     * by hand, on the way into the workspace, and as a duplicate - because a project without an
     * identifier is one the studio cannot refer to, and four call sites is four chances to forget.
     * The counter is one for the whole studio: a gallery belongs to the client, and the sales
     * project behind it already says which branch and vertical it came from.
     */
    createProject: async (data) => client.imageSelectionProject.create({
      data: { ...data, projectCode: data.projectCode || await nextIdentifier("IMAGE_SELECTION", {}, client) },
      select: projectSelect,
    }),
    updateProject: (id, data) => client.imageSelectionProject.update({ where: { id }, data, select: projectSelect }),
    listFoldersForDuplicate: (projectId) => client.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, name: true, sortOrder: true, createdByUserId: true }, orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    createFolder: (data) => client.imageSelectionFolder.create({ data, select: { id: true } }),
    listDeliverableConfigs: (imageSelectionProjectId) => client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId }, select: { projectPostProductionAllocationId: true, projectShootDeliverableId: true, enabled: true, selectionLimitOverride: true, displayOrder: true, inactiveAt: true } }),
    createDeliverableConfigs: (data) => data.length ? client.imageSelectionDeliverableConfig.createMany({ data }) : Promise.resolve({ count: 0 }),
    // What each photo left on this server and in the bucket, read before the rows go so the files
    // can be removed after. `originalPath` is only read to tell a browser upload (whose master is
    // ours to delete) from a registered one (whose master is the studio's and is never touched).
    listUploadFilesForPurge: (projectId) => client.imageSelectionUpload.findMany({ where: { projectId }, select: { storageName: true, originalPath: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true } }),
    // What deleting the whole project would take with it, counted before anything is destroyed.
    // A client-submitted selection is a photo selection whose item the client already sent
    // (`selectionSubmittedAt` set) — its presence escalates the delete to a high-impact warning.
    deletionImpact: async (projectId) => {
      const [shootCount, folderCount, photoCount, submittedSelectionCount] = await Promise.all([
        client.imageSelectionFolder.count({ where: { projectId, deletedAt: null, projectShootId: { not: null } } }),
        client.imageSelectionFolder.count({ where: { projectId, deletedAt: null } }),
        client.imageSelectionUpload.count({ where: { projectId } }),
        client.imageSelectionPhotoSelection.count({ where: { image: { projectId }, deliverableConfig: { selectionSubmittedAt: { not: null } } } }),
      ]);
      return { shootCount, folderCount, photoCount, submittedSelectionCount };
    },
    // Deleting a project deletes its data, not just its row: photos, selections, folders,
    // selection items, invite logs and the published gallery all go, in one transaction, ordered
    // child-first so no foreign key is left pointing at a gone row (folders shed their parent
    // links first for the same reason deleteFolderTree does). The project row itself stays,
    // soft-deleted, so the id keeps answering 404 rather than being reusable.
    purgeProjectData: (projectId) => client.$transaction(async (transaction) => {
      // The People filter's people: their mappings and scans cascade from the photos below, but a
      // person row hangs off the project, which is soft-deleted and so never cascades.
      await transaction.imageSelectionFacePerson.deleteMany({ where: { projectId } });
      await transaction.imageSelectionPhotoSelection.deleteMany({ where: { image: { projectId } } });
      await transaction.imageSelectionUpload.deleteMany({ where: { projectId } });
      await transaction.imageSelectionUploadBatch.deleteMany({ where: { projectId } });
      await transaction.imageSelectionFolder.updateMany({ where: { projectId }, data: { parentId: null } });
      await transaction.imageSelectionFolder.deleteMany({ where: { projectId } });
      await transaction.imageSelectionDeliverableConfig.deleteMany({ where: { imageSelectionProjectId: projectId } });
      await transaction.imageSelectionWhatsAppNotification.deleteMany({ where: { imageSelectionProjectId: projectId } });
      await transaction.imageSelectionGalleryPublication.deleteMany({ where: { projectId } });
      // `salesProjectId: null` gives the WhatsApp group name back: the deleted row would otherwise
      // keep occupying the Sales project's unique slot forever. The group link goes for the same
      // reason - a deleted project must not go on claiming the group the next one needs.
      return transaction.imageSelectionProject.update({ where: { id: projectId }, data: { deletedAt: new Date(), totalPhotoSize: BigInt(0), salesProjectId: null, whatsappGroupJid: null, whatsappGroupSubject: null, whatsappGroupLinkedAt: null }, select: projectSelect });
    }),
  };
}

const repository = createRepository();
module.exports = repository;
module.exports.createRepository = createRepository;
module.exports.LIVE_PARENT = LIVE_PARENT;
