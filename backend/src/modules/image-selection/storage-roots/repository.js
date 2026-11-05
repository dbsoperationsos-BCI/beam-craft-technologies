const prisma = require("../../../config/db");

const rootSelect = { id: true, name: true, notes: true, mappedPath: true, createdAt: true, updatedAt: true };

function createStorageRootRepository(client = prisma) {
  return {
    listRoots: () => client.imageSelectionStorageRoot.findMany({ where: { deletedAt: null }, select: rootSelect, orderBy: [{ name: "asc" }] }),
    findRoot: (id) => client.imageSelectionStorageRoot.findFirst({ where: { id, deletedAt: null }, select: rootSelect }),
    // Name uniqueness is checked among the living: a retired root's name can be used again.
    findRootByName: (name, excludeId) => client.imageSelectionStorageRoot.findFirst({ where: { name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }),
    createRoot: (data) => client.imageSelectionStorageRoot.create({ data, select: rootSelect }),
    updateRoot: (id, data) => client.imageSelectionStorageRoot.update({ where: { id }, data, select: rootSelect }),
  };
}

module.exports = createStorageRootRepository();
module.exports.createStorageRootRepository = createStorageRootRepository;
