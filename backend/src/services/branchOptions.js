const iamService = require("./iam.service");

/**
 * The branches a screen may offer, and the one rule for deciding them.
 *
 * Every branch picker in the application asks the same question - which of the studio's branches may
 * this person file something against - and it has to get the same answer, or two screens describe
 * two different studios. It lived in `sales/projects/controller.js` as `sourceBranchOptions` and was
 * read only there; the CRM had a hard-coded list of its own, which is what this exists to end.
 *
 * ── What the CRM's list was ───────────────────────────────────────────────────────────────────
 *
 * `nearestBranchOptions` in the frontend named six branches - Erode, Tiruppur, Coimbatore,
 * Bangalore, Hyderabad, Vizag - and **none of them is a branch**. The studio's are `Erode TN`,
 * `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`, `Hyderabad TL` and `Visakhapatnam AP`, which is
 * what Settings -> Organization -> Branches maintains and what every other Sales screen offers. So
 * Assigned Branch on a lead offered six values that exist nowhere, a branch added or renamed by the
 * studio never appeared on the CRM at all, and the six short spellings survived only because
 * `referenceMatchers` reads a branch's name without the state keyword ("Erode" -> "Erode TN") when it
 * resolves `branch_id`. It forgave "Vizag" as well, as a hard-coded alias, and no longer does: a
 * branch is its full name, with or without the state, and nothing shorter.
 *
 * ── With a `userId`, narrowed to what that person reaches ─────────────────────────────────────
 *
 * Which is what the picker offers and what a save is checked against - **for the permission the
 * picker belongs to**, since somebody may reach every branch for leads and one for assets. Without a
 * `userId` it is every active branch: validating an edit needs to know what *exists*, not what one
 * person may choose.
 *
 * The fallback stands in only for a studio with no branches recorded at all, and is not narrowed:
 * there is nothing to narrow it by. A caller who reaches no branch is offered none rather than the
 * fallback, which would hand them branches nobody said they could use.
 */

/** Only for a database with no `branch` rows. The studio's own six, spelled as the table spells them. */
const FALLBACK_BRANCHES = ["Erode TN", "Tiruppur TN", "Coimbatore TN", "Bangalore KA", "Hyderabad TL", "Visakhapatnam AP"];

/**
 * The branch names a caller may choose from.
 *
 * `client` is a Prisma client or a transaction, so a caller inside one sees its own uncommitted
 * rows. `userId` narrows to the branches that person's roles reach; `null` means "everything that
 * exists", which is the question validation asks.
 */
/**
 * The same branches as `{ id, name }`, for a caller that has to *match* a branch rather than only
 * offer one.
 *
 * A screen showing a record's branch cannot rely on the text stored beside it: that text is
 * whatever wrote the record, and a picker built from this list shows nothing for a spelling it does
 * not hold. Given the ids, the screen matches on the reference the server already resolved and
 * names the branch correctly however the text reads.
 *
 * The fallback rows carry `id: null` deliberately. They stand in for a database with no branches at
 * all, and an id there would point at a row that does not exist.
 */
async function branchOptionRows(client, userId = null, scope = {}) {
  /*
   * `scope` is the `{ module, feature }` the picker belongs to, and it is required wherever a
   * `userId` is given: branch reach is per-permission, so a picker on the CRM and a picker on the
   * Sales register can offer different lists to the same person, and a helper shared by both must
   * be told which one it is filling.
   */
  const reachable = userId === null ? null : await iamService.reachableBranchIds(userId, scope);
  const rows = await client.branch.findMany({
    where: { isActive: true, ...(reachable === null ? {} : { id: { in: reachable } }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const named = rows.filter((row) => row.name);
  if (named.length) return named;
  return reachable === null || reachable.length ? FALLBACK_BRANCHES.map((name) => ({ id: null, name })) : [];
}

/** The names alone, which is what a picker and a validator each ask for. */
async function branchOptions(client, userId = null, scope = {}) {
  return (await branchOptionRows(client, userId, scope)).map((row) => row.name);
}

module.exports = { branchOptions, branchOptionRows, FALLBACK_BRANCHES };
