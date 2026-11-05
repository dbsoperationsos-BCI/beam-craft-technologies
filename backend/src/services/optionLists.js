const prisma = require("../config/db");

/**
 * The studio's own vocabularies, read from the lists it maintains.
 *
 * `employeeOptionLists` and `paymentOptionLists` beside this each answer for one family of lists and
 * were written when there were two. There are a dozen now - what state an asset is in, how it
 * travels, what a vendor is engaged for, what kind of work a task is - and they all want the same
 * three things: the active names, the names carrying some behaviour flag, and a cache that empties
 * when Field Settings writes. So this is the general form of it, and a new list is one call rather
 * than one more module.
 *
 * The two rules those two established hold here too, and for the same reasons.
 *
 * **Never answers with nothing.** Every read takes the fallback the code used to hold, and returns
 * it when the read fails *or* comes back empty. "No condition is valid" would refuse every asset
 * inspection the studio tried to record; an empty picker is not a smaller failure than a wrong one.
 *
 * **Cached for a minute, and dropped the moment a list is written to.** These are read on the write
 * path of ordinary forms, so a round trip per call for a table of four rows is a cost worth
 * avoiding. `forgetOptionLists()` is called by the master-data controller on every create, rename,
 * flag change and delete, so an edit in Settings is live on the next request rather than within a
 * minute of it.
 */

const TTL_MS = 60_000;
const cache = new Map();

async function rows(model) {
  const hit = cache.get(model);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  try {
    value = await prisma[model].findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  } catch (error) {
    console.warn(`Unable to read the ${model} list, using what the code used to say:`, error?.message || error);
    return null;
  }
  if (!value?.length) return null;
  cache.set(model, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** The names a field may hold, or the fallback where the list cannot be read or is empty. */
async function optionNames(model, fallback) {
  const found = await rows(model);
  return found ? found.map((row) => row.name) : fallback;
}

/**
 * The names carrying one of the row's behaviour flags - the task types that ask what the work was,
 * the settlement that means money comes back.
 *
 * The fallback is the literal the code used to compare against, so an unreadable list behaves
 * exactly as the application did before the list existed.
 */
async function namesWithFlag(model, field, fallback) {
  const found = await rows(model);
  return found ? found.filter((row) => row[field]).map((row) => row.name) : fallback;
}

/** The single name carrying a flag only one row may hold, or the fallback. */
async function nameWithFlag(model, field, fallback) {
  const [first] = await namesWithFlag(model, field, [fallback]);
  return first || fallback;
}

/**
 * Field Settings has written to a list, so nothing cached from it is current.
 *
 * Emptied wholesale rather than by resource: the resource key and the Prisma model are different
 * names for the same list, and a mapping between them is one more thing to keep in step for no gain
 * - these are a dozen small arrays, and rebuilding them costs a query each.
 */
function forgetOptionLists() {
  cache.clear();
}

module.exports = { optionNames, namesWithFlag, nameWithFlag, forgetOptionLists };
