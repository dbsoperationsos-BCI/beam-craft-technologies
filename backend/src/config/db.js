const { PrismaClient } = require("@prisma/client");
const { extendWithResolvedNames } = require("../services/resolvedNames");
const { extendWithChangeTracking } = require("../services/changeTracking");

/*
 * The one client the application reads and writes through, with the one reading rule applied to it:
 * a name comes from the linked row where the reference is set, and from the stored text where it is
 * not (see services/resolvedNames.js). Applied here rather than at each read so that no module,
 * screen or assistant tool can read a copied name around it.
 *
 * And then **change tracking** (`services/changeTracking.js`): an update to a watched record
 * describes what it changed, for the activity log, without each handler having to say so. Applied
 * after the names, so what it compares is what a read of that record would have shown rather than the
 * raw columns. It records only inside a request, and only for the records in its own short list.
 */
const prisma = extendWithChangeTracking(extendWithResolvedNames(new PrismaClient()));

module.exports = prisma;
