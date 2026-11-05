/**
 * Raising client storage records from the sales side.
 *
 * A project that starts with "Storage Needed = Yes" gets one storage record, created for it
 * automatically so nobody has to remember to open Client Storage Management and add it by hand.
 * The record carries only the links; the client, project status, coordinators and shoot columns
 * are read back through those links, and the employee holding the hard disc fills in the rest
 * (brand, capacity, WID, footage location and the checks).
 */

const { nextIdentifier } = require("../../services/identifiers");
const dataScope = require("../../services/dataScope.service");
const { projectAccessWhere } = require("../../services/projectScope");

/** Earliest shoot first, matching how shoots are ordered everywhere else in the project module. */
const earliestShoot = (client, projectId) => client.projectShoot.findFirst({
  where: { projectId, deletedAt: null },
  orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
  select: { id: true },
});

// DBS-STOMGMT-000001. One run of numbers for the studio: a hard disc holding a client's footage
// belongs to the studio rather than to the branch or the vertical the shoot came from.
const nextStorageId = (client) => nextIdentifier("CLIENT_STORAGE", {}, client);

/**
 * Creates the project's storage record if it does not have one yet, and returns it.
 *
 * Safe to call repeatedly: it is the same call behind starting a project, turning Storage Needed
 * on for an already started project, and adding a shoot to one. A project that has ever had a
 * storage record — including one an employee has since removed with a reason — is left alone, so
 * a deliberate removal is never undone by a later shoot being added.
 *
 * Returns the record, or null when the project is not one that raises storage.
 */
async function ensureProjectClientStorage(client, projectId, options = {}) {
  // `req.user` is the decoded JWT payload, so the id is coerced rather than trusted to be a number.
  const userId = Number(options.userId) || null;
  const project = await client.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, storageNeeded: true, projectStatus: true },
  });
  // Only started projects raise storage: while a project is still "Yet to Start" the answer can
  // still change, and a draft save must not leave a stray record behind.
  if (!project || project.storageNeeded !== "Yes" || project.projectStatus === "Yet to Start") return null;

  const existing = await client.clientStorage.findFirst({ where: { projectId: project.id }, orderBy: { id: "asc" } });
  if (existing) {
    // The project had no shoots when its record was raised. Attach the first one that appears,
    // but never overwrite a shoot somebody has already chosen.
    if (existing.shootId || existing.isDeleted) return existing;
    const shoot = await earliestShoot(client, project.id);
    if (!shoot) return existing;
    return client.clientStorage.update({ where: { id: existing.id }, data: { shootId: shoot.id, ...(userId ? { updatedBy: userId } : {}) } });
  }

  const shoot = await earliestShoot(client, project.id);
  return client.clientStorage.create({
    data: {
      storageId: await nextStorageId(client),
      projectId: project.id,
      shootId: shoot?.id || null,
      createdBy: userId,
      updatedBy: userId,
    },
  });
}

/**
 * The reason stamped on a record removed because its project was.
 *
 * Removing a storage record by hand asks for a reason, and the register shows it. A record that
 * goes because the project went was chosen by nobody, so it says so in the same field rather than
 * appearing to have been removed by whoever last touched it.
 */
const PROJECT_DELETED_REASON = "The project this record was raised against was deleted.";

/**
 * Takes a deleted project's storage records with it.
 *
 * A project is soft-deleted - the row stays and `deletedAt` is set - so nothing at the database
 * level reaches the records hanging off it: the foreign key's `onDelete: SetNull` only fires on a
 * row actually being removed, which never happens here. The storage register filters on its own
 * `isDeleted` and never looks at the project's, so a deleted project's disc went on being listed
 * against a project that no longer appeared anywhere else in the application.
 *
 * Marked rather than erased, and with the same three columns the register's own Remove writes, so
 * a record removed this way reads exactly like one removed by hand and stays recoverable in the
 * database. `ensureProjectClientStorage` already leaves an `isDeleted` record alone, so nothing
 * raises it again.
 *
 * Called inside the transaction that deletes the project: a project that fails to delete must not
 * take its records with it, and a record that fails to go must not leave the project gone.
 */
async function removeProjectClientStorage(client, projectId, options = {}) {
  const userId = Number(options.userId) || null;
  const { count } = await client.clientStorage.updateMany({
    // Already removed, by hand or otherwise, is left as it is: its own reason is the true one, and
    // overwriting it would rewrite why somebody took the disc off the register.
    where: { projectId, isDeleted: false },
    data: {
      isDeleted: true,
      deletedReason: PROJECT_DELETED_REASON,
      // The project's own deletion time where the caller has it, so Restore can find exactly these.
      deletedAt: options.deletedAt || new Date(),
      ...(userId ? { updatedBy: userId } : {}),
    },
  });
  return count;
}

/**
 * Puts back the storage records a project's delete took off the register - Recycling Bin → Restore.
 *
 * Only the records that delete removed: the project's reason on them, and removed at or after the
 * project's `deletedAt`. A disc somebody removed by hand, with a reason of their own, stays removed;
 * so does one removed with this reason at an earlier delete (that delete's restore already put it
 * back, or it was removed by hand since). `gte` rather than an exact match because a project deleted
 * before the bin existed stamped its records a moment after its own `deletedAt`.
 */
async function restoreProjectClientStorage(client, projectId, options = {}) {
  const userId = Number(options.userId) || null;
  if (!options.deletedAt) return 0;
  const { count } = await client.clientStorage.updateMany({
    where: { projectId, isDeleted: true, deletedReason: PROJECT_DELETED_REASON, deletedAt: { gte: options.deletedAt } },
    data: { isDeleted: false, deletedReason: null, deletedAt: null, ...(userId ? { updatedBy: userId } : {}) },
  });
  return count;
}

/**
 * The names on a storage record: who is holding the hard disc, who handed it to them, and who
 * raised the record. `assignedToId` is an employee; the other two are logins.
 */
const CLIENT_STORAGE_SCOPE_COLUMNS = { employee: ["assignedToId"], user: ["assignedById", "createdBy"] };

/**
 * Which storage records a person may read.
 *
 * The studio's one rule (`docs/project-state/DATA-SCOPE.md`) on the three names above, plus the
 * project the disc holds footage for - through the record's own link and through its shoot, because
 * a record raised when a project starts may not have a shoot yet. A hard disc is part of running
 * that wedding, so the people running it see it whether or not their name is on the record.
 *
 * Returned as one fragment to put under `AND`, never spread: it carries an `OR` of its own, and a
 * search that sets another `OR` beside it would replace the rule rather than narrow by it.
 */
async function clientStorageAccessWhere({ userId, permissions }) {
  const scope = await dataScope.resolve({
    userId,
    permissions: Array.isArray(permissions) ? permissions : [permissions],
    columns: CLIENT_STORAGE_SCOPE_COLUMNS,
  });
  if (scope.unlimited) return {};
  const project = await projectAccessWhere({ userId, permissions });
  return { OR: [scope.where, { project }, { shoot: { project } }] };
}

module.exports = { nextStorageId, ensureProjectClientStorage, removeProjectClientStorage, restoreProjectClientStorage, clientStorageAccessWhere, CLIENT_STORAGE_SCOPE_COLUMNS, PROJECT_DELETED_REASON };
