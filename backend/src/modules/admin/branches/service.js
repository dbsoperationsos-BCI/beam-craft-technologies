const prisma = require("../../../config/db");

/**
 * The studio's branch register: the branches themselves, not the records scoped to them.
 *
 * A branch already existed as a row every part of the application points at — a user's home branch,
 * an asset's location, the branch a role reaches, the code inside a project's identifier. This
 * module is where that row is now *kept*: named, addressed, and carrying what the studio is
 * registered as at that place. Nothing here changes what a branch means anywhere else.
 *
 * Two rules live here rather than in the database, because MySQL cannot express either:
 *
 *   - **One head office.** Setting the flag on a branch clears it on every other, in the same
 *     transaction, so there is never a moment with two. A unique index cannot say this: it would
 *     also allow only one branch that is *not* the head office.
 *   - **A branch is never deleted at all.** It is disabled instead, which is `isActive: false` and
 *     nothing more. Every record that points at a branch — a user's home branch, an asset's
 *     location, a year of quotations — goes on pointing at it, and stays readable. Deleting one
 *     would either fail at the foreign key or orphan those rows, depending on the relation.
 */

/** Every column the browser is given. The rest of the row is bookkeeping. */
const branchSelect = {
  id: true, code: true, name: true, description: true,
  addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true,
  isActive: true, isHeadOffice: true,
  gstNumber: true, panNumber: true, phone: true, alternatePhone: true, email: true, websiteUrl: true,
  bankAccountName: true, bankName: true, bankAccountNumber: true, bankIfsc: true, qrCodeUrl: true,
  createdAt: true, updatedAt: true,
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/*
 * What a second branch may not reuse.
 *
 * The code is the register's key — the seed upserts by it and the asset importer accepts it in a
 * spreadsheet — so two branches holding one would make both ambiguous.
 *
 * A GSTIN is issued once, to one place: two branches holding the same one means one of them is
 * wrong, and an invoice would carry a registration that does not belong to it. A bank account
 * number is the same kind of fact. A name is neither, but a register with two branches called the
 * same thing cannot be used — every picker in the application shows the name and nothing else.
 *
 * Deliberately not here, and each for a reason:
 *   - **PAN** belongs to the company, not the place. Every branch of one studio shares it, so
 *     refusing a repeat would refuse the studio's second branch.
 *   - **IFSC** names a *bank's* branch. Two of the studio's branches banking at the same place
 *     legitimately share it.
 *   - **Phone** may be one line the studio answers for more than one branch.
 */
const UNIQUE_FIELDS = [
  ["code", "code"],
  ["name", "name"],
  ["gstNumber", "GSTIN"],
  ["bankAccountNumber", "account number"],
];

/**
 * Whichever of those another branch already holds, said against the field itself.
 *
 * Closed branches are checked too: a branch that has stopped trading still holds its registration,
 * and handing its GSTIN to a new branch would make the register disagree with itself.
 *
 * Text is compared by the column's own collation, which on this database is case-insensitive - so
 * "erode tn" is caught against "Erode TN" without either being folded here.
 */
async function duplicatesOf(client, input, id = null) {
  const fieldErrors = {};
  await Promise.all(UNIQUE_FIELDS.map(async ([field, label]) => {
    const value = input[field];
    if (value === null || value === undefined) return;
    const clash = await client.branch.findFirst({
      where: { [field]: value, ...(id ? { id: { not: id } } : {}) },
      select: { name: true },
    });
    if (clash) fieldErrors[field] = [`${clash.name} already uses this ${label}.`];
  }));
  return fieldErrors;
}

/** A clash, carrying its messages per field so the form can put each one where it belongs. */
const duplicateError = (fieldErrors) => Object.assign(
  new Error("Another branch already uses these details."),
  { status: 409, fieldErrors },
);

function createBranchesService(client = prisma) {
  /** Whoever else holds the head office loses it, so exactly one branch ever claims to be it. */
  const clearOtherHeadOffices = (tx, keepId) => tx.branch.updateMany({
    where: { isHeadOffice: true, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { isHeadOffice: false },
  });

  return {
    /** The whole register, head office first, then alphabetically — inactive branches included. */
    list: () => client.branch.findMany({
      select: branchSelect,
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    }),

    async create(input) {
      const clashes = await duplicatesOf(client, input);
      if (Object.keys(clashes).length) throw duplicateError(clashes);
      return client.$transaction(async (tx) => {
        if (input.isHeadOffice) await clearOtherHeadOffices(tx, null);
        return tx.branch.create({ data: input, select: branchSelect });
      });
    },

    /**
     * An edit, including the one that takes a branch out of use.
     *
     * Disabling is `isActive: false` and nothing more, which is why it is not an operation of its
     * own: a branch is never deleted, so there is no second outcome to choose between. What every
     * record already points at stays pointing at it, and turning it back on is the same edit the
     * other way.
     */
    async update(id, input) {
      const existing = await client.branch.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw httpError(404, "That branch no longer exists.");
      // The branch being edited is not its own duplicate, so it is left out of the comparison.
      const clashes = await duplicatesOf(client, input, id);
      if (Object.keys(clashes).length) throw duplicateError(clashes);
      // A branch out of use cannot be the head office: the studio is not registered from a place
      // it has stopped working out of, and leaving the flag there would put it on the paperwork.
      const data = input.isActive === false ? { ...input, isHeadOffice: false } : input;
      return client.$transaction(async (tx) => {
        if (data.isHeadOffice) await clearOtherHeadOffices(tx, id);
        return tx.branch.update({ where: { id }, data, select: branchSelect });
      });
    },

  };
}

module.exports = { createBranchesService, branchSelect, UNIQUE_FIELDS };
