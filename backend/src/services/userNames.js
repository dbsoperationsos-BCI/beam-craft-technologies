const prisma = require("../config/db");

/*
 * Who did it, by name: a `created_by` / `updated_by` column holds a **user** id - a row of `users` -
 * so its name is that user's, read through the user: the employee the user is linked to, and the
 * user's own name where they are linked to none. Never looked up in `employee` by the same number,
 * which is a different person whenever a user's id and their employee's id differ.
 *
 * Every list a table reads sends the name beside the id (`createdBy` → `createdByName`), so a column
 * shows a person rather than a number; the shared table hides the raw id fields.
 */

/** The fields that hold a user id, on the lists that send them; each gains `<who>Name`. */
const USER_ID_FIELDS = [
  "createdBy", "updatedBy", "createdByUserId", "updatedByUserId",
  "requestedBy", "decidedBy", "decidedById", "assignedById", "inspectedByUserId",
  "whatsappGroupLinkedByUserId", "preProductionStatusByUserId", "productionStatusByUserId",
];

/** `createdByUserId` → `createdByName`, `decidedById` → `decidedByName`, `createdBy` → `createdByName`. */
const nameKeyFor = (field) => `${field.replace(/(UserId|Id)$/, "")}Name`;

/** A user's display name: their linked employee's, else their own. */
const userDisplayName = (user) => user?.linkedEmployee?.employeeName || user?.name || null;

/** Id → display name for these user ids, in one query. */
async function userNamesById(ids, { client = prisma } = {}) {
  const wanted = [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return new Map();
  const users = await client.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, linkedEmployee: { select: { employeeName: true } } },
  });
  return new Map(users.map((user) => [user.id, userDisplayName(user)]));
}

/**
 * The rows with each user id field they carry named beside it. `fields` narrows which; by default
 * every field in `USER_ID_FIELDS` a row has. A name already sent is replaced, so every list names a
 * person the same way.
 */
async function withUserNames(rows, { fields = USER_ID_FIELDS, client = prisma } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  /*
   * Only a field holding a login *id*. The same name can be a relation on another model - a
   * payment request's `requestedBy` is the employee record itself - and reading that as an id found
   * nobody and wrote `null` over the name the row already carried (`requestedByName`).
   */
  const isId = (value) => value === null || typeof value === "number" || typeof value === "string";
  const present = fields.filter((field) => list.some((row) => row && row[field] !== undefined && isId(row[field])));
  if (!present.length) return list;
  const names = await userNamesById(list.flatMap((row) => present.map((field) => row?.[field])), { client });
  return list.map((row) => {
    if (!row) return row;
    const named = { ...row };
    for (const field of present) {
      if (row[field] === undefined || !isId(row[field])) continue;
      named[nameKeyFor(field)] = row[field] === null ? null : names.get(Number(row[field])) || null;
    }
    return named;
  });
}

module.exports = { USER_ID_FIELDS, nameKeyFor, userDisplayName, userNamesById, withUserNames };
