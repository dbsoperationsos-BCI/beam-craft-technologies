const repository = require("./repository");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/**
 * Named storage roots: the durable identity behind "where do this project's originals live".
 *
 * Only the name and its notes live on the server. The local mapping — which drive letter or mount
 * point a root answers to on a particular workstation — is that machine's own configuration, so
 * remapping a NAS from Z:\ to Y:\ never touches a photo record. Deleting is soft: photo rows may
 * point at a root for years, and a dangling name would turn "which drive was that on?" into a
 * guess.
 */
/*
 * The database keeps `name` unique across every row, retired ones included, while the check above
 * each write looks only at the living. A name still held by a retired root therefore passes the
 * check and is refused by the database (P2002) - said here as the 409 it is, with why, instead of
 * surfacing as a 500 "Unable to create the storage root".
 */
const isUniqueClash = (error) => error?.code === "P2002";
const retiredNameError = (name) => httpError(409, `A retired storage root is still named "${name}" - its photos keep pointing at it. Choose another name.`);

function createStorageRootService(repo = repository) {
  async function list() { return repo.listRoots(); }

  async function create(input) {
    if (await repo.findRootByName(input.name)) throw httpError(409, `A storage root named "${input.name}" already exists.`);
    try { return await repo.createRoot({ name: input.name, notes: input.notes ?? null, mappedPath: input.mappedPath ?? null }); }
    catch (error) { if (isUniqueClash(error)) throw retiredNameError(input.name); throw error; }
  }

  async function update(storageRootId, input) {
    const root = await repo.findRoot(storageRootId);
    if (!root) throw httpError(404, "Storage root not found.");
    if (input.name !== undefined && (await repo.findRootByName(input.name, storageRootId)))
      throw httpError(409, `A storage root named "${input.name}" already exists.`);
    const data = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.mappedPath !== undefined) data.mappedPath = input.mappedPath;
    try { return await repo.updateRoot(storageRootId, data); }
    catch (error) { if (isUniqueClash(error)) throw retiredNameError(input.name); throw error; }
  }

  async function remove(storageRootId) {
    const root = await repo.findRoot(storageRootId);
    if (!root) throw httpError(404, "Storage root not found.");
    await repo.updateRoot(storageRootId, { deletedAt: new Date() });
    return { id: storageRootId };
  }

  return { list, create, update, remove };
}

module.exports = { ...createStorageRootService(), createStorageRootService };
