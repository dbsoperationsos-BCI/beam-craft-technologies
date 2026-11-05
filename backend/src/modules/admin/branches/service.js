const prisma = require("../../../config/db");
const { renameBranchCopies } = require("../../../services/nameCopies");

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
  locationUrl: true, googleReviewUrl: true, customSocialLinks: true,
  qrCodeUrl: true, upiIds: true,
  /*
   * The accounts this branch is paid into, in the studio's own order - which is what the client's
   * payment page prints in. `position` is not given to the browser: the order *is* the list, and a
   * form that was handed the numbers would have to keep them in step with it.
   */
  bankAccounts: {
    select: { id: true, accountHolderName: true, bankName: true, accountNumber: true, ifscCode: true },
    orderBy: { position: "asc" },
  },
  createdAt: true, updatedAt: true,
};

/**
 * A branch as the browser is given it.
 *
 * Only the UPI list needs saying: it is a JSON column, so a branch written before the column
 * existed answers NULL where every branch written since answers a list. Both mean "no UPI IDs",
 * and a form that has to tell them apart is a form that will one day forget to. The column is the
 * only place the difference exists, and it ends here.
 */
const serializeBranch = (row) => ({
  ...row,
  upiIds: Array.isArray(row.upiIds) ? row.upiIds : [],
  // Always a list, so a branch written before the column cannot answer NULL to the form.
  customSocialLinks: Array.isArray(row.customSocialLinks) ? row.customSocialLinks : [],
  bankAccounts: Array.isArray(row.bankAccounts) ? row.bankAccounts : [],
});

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
  const rowErrors = await accountClashesOf(client, input.bankAccounts, id);
  if (Object.keys(rowErrors).length) fieldErrors.bankAccounts = rowErrors;
  return fieldErrors;
}

/**
 * An account number another branch already holds, said against the row that holds it.
 *
 * The same rule the branch's single account number was held to before it became a list - "a bank
 * account number is a fact, and two branches holding the same one means one of them is wrong" - now
 * asked of each row. A repeat *within* one list is the schema's (see `bankAccountList`), because
 * nothing has to be read to see it; this is the half only the register can answer.
 *
 * Keyed by row index, each with the field it belongs to, which is the shape the form draws its
 * per-row errors from. The branch being edited is excluded, so saving a branch without touching its
 * accounts never reports them as clashing with themselves.
 */
async function accountClashesOf(client, accounts, id = null) {
  if (!Array.isArray(accounts) || !accounts.length) return {};
  const numbers = accounts.map((account) => account.accountNumber).filter(Boolean);
  if (!numbers.length) return {};
  const clashes = await client.branchBankAccount.findMany({
    where: { accountNumber: { in: numbers }, ...(id ? { branchId: { not: id } } : {}) },
    select: { accountNumber: true, branch: { select: { name: true } } },
  });
  if (!clashes.length) return {};
  const byNumber = new Map(clashes.map((clash) => [clash.accountNumber, clash.branch?.name || "Another branch"]));
  const rowErrors = {};
  accounts.forEach((account, index) => {
    const holder = byNumber.get(account.accountNumber);
    if (holder) rowErrors[index] = { accountNumber: `${holder} already uses this account number.` };
  });
  return rowErrors;
}

/** A clash, carrying its messages per field so the form can put each one where it belongs. */
const duplicateError = (fieldErrors) => Object.assign(
  new Error("Another branch already uses these details."),
  { status: 409, fieldErrors },
);

/**
 * The branch's own columns and its accounts, told apart.
 *
 * `bankAccounts` arrives in the same body as the branch's fields and is not one of them - it is a
 * table - so it is lifted out before the row is written. `rows` is undefined where the request did
 * not mention accounts at all, which an edit is allowed to do and which must leave the list alone;
 * an empty list never reaches here, the schema refusing a branch with no account.
 */
function splitAccounts(input) {
  const { bankAccounts, ...branch } = input;
  return { branch, rows: bankAccounts };
}

/**
 * The accounts as rows, numbered by their place in the list.
 *
 * `position` is written from the order the form sent rather than kept by the row, so the studio's
 * order is whatever the list on screen reads - which is what the client's payment page prints in.
 */
const accountRows = (rows) => rows.map((row, index) => ({ ...row, position: index }));

function createBranchesService(client = prisma) {
  /** Whoever else holds the head office loses it, so exactly one branch ever claims to be it. */
  const clearOtherHeadOffices = (tx, keepId) => tx.branch.updateMany({
    where: { isHeadOffice: true, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { isHeadOffice: false },
  });

  /*
   * There is always one head office - the payslip prints its address. So a branch added while there is
   * none has to be it, and the head office can only stop being it by another branch becoming it: never
   * switched off, nor taken out of use, while it is the one.
   */
  const NEEDS_HEAD_OFFICE = "Choose a head office: the studio has none yet, and the payslip prints the head office's address. Turn on Head office for this branch.";
  const KEEP_HEAD_OFFICE = "This is the head office, and there always has to be one - the payslip prints its address. Make another branch the head office first.";

  return {
    /** The whole register, head office first, then alphabetically — inactive branches included. */
    list: async () => (await client.branch.findMany({
      select: branchSelect,
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    })).map(serializeBranch),

    async create(input) {
      const clashes = await duplicatesOf(client, input);
      if (Object.keys(clashes).length) throw duplicateError(clashes);
      if (!input.isHeadOffice && !(await client.branch.count({ where: { isHeadOffice: true } }))) throw httpError(400, NEEDS_HEAD_OFFICE);
      const { branch, rows } = splitAccounts(input);
      return client.$transaction(async (tx) => {
        if (input.isHeadOffice) await clearOtherHeadOffices(tx, null);
        return serializeBranch(await tx.branch.create({
          /*
           * The accounts are written with the branch, in one statement and one transaction, so a
           * branch never exists without the accounts it was created with. Nested only when there
           * are rows: the schema will not pass a new branch without one, and the service is not
           * the place to repeat that - it just writes what it was handed.
           */
          data: { ...branch, ...(rows ? { bankAccounts: { create: accountRows(rows) } } : {}) },
          select: branchSelect,
        }));
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
      const existing = await client.branch.findUnique({ where: { id }, select: { id: true, name: true, isHeadOffice: true } });
      if (!existing) throw httpError(404, "That branch no longer exists.");
      if (existing.isHeadOffice && (input.isHeadOffice === false || input.isActive === false)) throw httpError(400, KEEP_HEAD_OFFICE);
      // The branch being edited is not its own duplicate, so it is left out of the comparison.
      const clashes = await duplicatesOf(client, input, id);
      if (Object.keys(clashes).length) throw duplicateError(clashes);
      // A branch out of use cannot be the head office: the studio is not registered from a place
      // it has stopped working out of, and leaving the flag there would put it on the paperwork.
      const { branch: fields, rows } = splitAccounts(input);
      const data = input.isActive === false ? { ...fields, isHeadOffice: false } : fields;
      const renaming = data.name !== undefined && data.name !== existing.name;
      return client.$transaction(async (tx) => {
        if (data.isHeadOffice) await clearOtherHeadOffices(tx, id);
        /*
         * The list is **replaced**, not merged: the form holds the whole list, rows are added and
         * removed in it, and an account has no identity of its own that anything else points at - so
         * matching the rows up by id would be bookkeeping in aid of nothing. Inside the branch's own
         * transaction, so a save that fails later leaves the accounts as they were.
         *
         * Only when the request mentioned accounts. An edit that changes the phone number says
         * nothing about them, and clearing the list for that would take the branch's accounts away
         * on a save that never meant to touch them.
         */
        if (rows !== undefined) {
          await tx.branchBankAccount.deleteMany({ where: { branchId: id } });
          await tx.branchBankAccount.createMany({ data: accountRows(rows).map((row) => ({ ...row, branchId: id })) });
        }
        const branch = await tx.branch.update({ where: { id }, data, select: branchSelect });
        /*
         * A rename reaches every record that wrote the branch's name out as text - projects,
         * quotations, leads, cash entries, payment requests, tasks, candidates, saved group names -
         * in the same transaction as the register, so the two cannot disagree. Without this the
         * screens went on printing the old name, and the next save of any of those rows looked the
         * old name up, found no branch, and dropped the row out of scope. `renamed` is how many rows
         * followed, for the message the controller returns.
         */
        const renamed = renaming ? await renameBranchCopies(tx, id, existing.name, data.name) : 0;
        return { ...serializeBranch(branch), renamed };
      });
    },

  };
}

module.exports = { createBranchesService, branchSelect, UNIQUE_FIELDS };
