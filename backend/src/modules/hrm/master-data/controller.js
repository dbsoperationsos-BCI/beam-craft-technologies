const prisma = require("../../../config/db");
// Three of these lists carry meaning the rest of the application reads - which statuses count as
// working, which marital statuses ask for a spouse, what a gender may be - and that is cached.
// Writing to one drops the cache, so a change made here is in force on the next request.
const { forgetEmployeeOptionLists } = require("../../../services/employeeOptionLists");
const { forgetPaymentOptionLists } = require("../../../services/paymentOptionLists");
const { forgetOptionLists } = require("../../../services/optionLists");

/**
 * A list has been written to, so nothing cached from it is current.
 *
 * Two services cache these lists - the employee ones and the payment ones - and each ignores a
 * resource it does not hold. Told together here so that adding a third cache is one line rather
 * than four, and so that no write can empty one and forget the other: what a stale cache costs is a
 * form offering a value the server has just stopped accepting, or refusing one it has just started.
 */
function forgetCachedLists(key) {
  forgetEmployeeOptionLists(key);
  forgetPaymentOptionLists(key);
  forgetOptionLists(key);
}

/**
 * Whether taking this row away would leave the list without the one row that carries its meaning.
 *
 * Some flags have to be held by somebody. A payment schedule's closing row is the case: it is what
 * pins a row to the bottom and stops the schedule appending forever, and the flag rather than the
 * name is now what says so - which is exactly what lets the studio rename it. What the studio may
 * not do is remove the last one, because the flag is not something this screen can hand to another
 * row. Answers `null` when the row may go.
 */
async function blockedForBeingTheLast(prismaClient, definition, id) {
  const required = definition.requiredFlag;
  if (!required) return null;
  const row = await prismaClient[definition.model].findUnique({ where: { id }, select: { name: true, [required.field]: true } });
  if (!row || !row[required.field]) return null;
  const others = await prismaClient[definition.model].count({
    where: { id: { not: id }, isActive: true, [required.field]: true },
  });
  if (others) return null;
  return `"${row.name}" is the only ${definition.label.toLowerCase()} that ${required.reason}, so it cannot be removed. `
    + "Rename it instead, or add another one first.";
}
// These lists are held on the records as plain text, so an entry cannot simply be deleted out
// from under them, and renaming one has to take them with it. See `usage.js`.
const { countUsage, refusalMessage, renameUsage } = require("./usage");
const { definitions, codeFromName } = require("./definitions");
const iamService = require("../../../services/iam.service");

const querySchema = require("zod").z.object({
  search: require("zod").z.string().trim().max(120).optional(),
  active: require("zod").z.enum(["true", "false"]).optional(),
  // One brand's rows of a list kept per brand (`scopedBy: "vertical"` on the definition). Ignored
  // on every other list, where the column does not exist.
  vertical: require("zod").z.string().trim().max(50).optional(),
  page: require("zod").z.coerce.number().int().positive().default(1),
  pageSize: require("zod").z.coerce.number().int().min(1).max(100).default(25),
});
const idSchema = require("zod").z.coerce.number().int().positive();

function getDefinition(key) {
  return definitions[key];
}

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, label, { onDuplicate } = {}) {
  if (error.code === "P2002") return res.status(409).json({ message: onDuplicate || `${label} code already exists` });
  if (error.code === "P2025") return res.status(404).json({ message: `${label} not found` });
  return res.status(500).json({ message: `Unable to process ${label.toLowerCase()}`, error: error.message });
}

function parseId(req, res) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return null;
  }
  return parsed.data;
}

/**
 * Who is making the change, for the definitions that record it.
 *
 * Opt-in per definition: a designation or a skill is a label, and nobody needs to know who typed
 * it. A bank account is how money leaves the studio, so it does.
 */
const actorFields = (definition, req, creating) => {
  if (!definition.tracksActor) return {};
  const actor = Number(req.user?.id) || null;
  return creating ? { createdBy: actor, updatedBy: actor } : { updatedBy: actor };
};

/**
 * The names behind those ids, resolved once for a page rather than per row. `createdBy` is a plain
 * id with no relation — the row outlives the account that made it — so the names are read here
 * instead of being included by Prisma.
 */
async function withActorNames(definition, rows) {
  if (!definition.tracksActor) return rows;
  const list = Array.isArray(rows) ? rows : [rows];
  const ids = [...new Set(list.flatMap((row) => [row.createdBy, row.updatedBy]).filter(Boolean))];
  if (!ids.length) return rows;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((user) => [user.id, user.name]));
  const decorate = (row) => ({ ...row, createdByName: nameOf.get(row.createdBy) || null, updatedByName: nameOf.get(row.updatedBy) || null });
  return Array.isArray(rows) ? list.map(decorate) : decorate(rows);
}

function createController(key) {
  const definition = getDefinition(key);
  const repository = prisma[definition.model];
  const options = definition.include ? { include: definition.include } : {};

  return {
    async list(req, res) {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return validationError(res, parsed.error);
      const { search, active, page, pageSize, vertical } = parsed.data;
      /*
       * The branch list is the one piece of reference data that is not
       * the same for everybody: it is what every branch picker in the app offers, so it is narrowed
       * to the branches the caller's roles actually reach. A super admin reaches all of them and is
       * narrowed by nothing.
       *
       * Only this definition. Departments and designations are the same list for the whole studio.
       */
      /*
       * `anyRole`, and this is the one place that is right rather than a shortcut.
       *
       * Branch reach is per-permission everywhere else, but this endpoint is **shared**: `/branches`
       * and the `/locations` alias fill branch pickers on screens all over the application, so there
       * is no single `module / feature` it could name without being wrong for most of its readers -
       * the trap CLAUDE.md Rule 4 describes. Answering with every branch the person reaches at all
       * is the honest list for a list that does not know who is asking.
       *
       * It is not a hole: **the save is what is guarded**, per module and per permission -
       * `canUseBranchId` on an asset, on an employee, on a user - so a branch offered here and not
       * reachable for that screen is refused where it is used. A screen that wants its own narrower
       * list asks its own module for one, as the CRM's `/crm-leads/branches` already does.
       */
      const reachable = key === "branches" ? await iamService.reachableBranchIds(req.user.id, { anyRole: true }) : null;
      const where = {
        ...(reachable === null ? {} : { id: { in: reachable } }),
        ...(vertical && definition.scopedBy === "vertical" ? { vertical } : {}),
        ...(active !== undefined ? { isActive: active === "true" } : {}),
        ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {}),
      };
      try {
        const [data, total] = await prisma.$transaction([
          repository.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: definition.orderBy, ...options }),
          repository.count({ where }),
        ]);
        return res.json({ data: await withActorNames(definition, data), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
      } catch (error) { return handleError(res, error, definition.label); }
    },
    async get(req, res) {
      const id = parseId(req, res);
      if (!id) return;
      try {
        const data = await repository.findUnique({ where: { id }, ...options });
        if (!data) return res.status(404).json({ message: `${definition.label} not found` });
        return res.json({ data });
      } catch (error) { return handleError(res, error, definition.label); }
    },
    async create(req, res) {
      const parsed = definition.createSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed.error);
      /*
       * The code is minted from the name when the caller does not care what it is.
       *
       * Which is every screen that maintains one of these lists as a list of names - Field Settings
       * and Employee Settings both ask for a designation, not for a key. A name with nothing usable
       * in it (`--`, an emoji) mints to an empty string and would be refused by the column rather
       * than by anything that could explain itself, so that is answered here in the words the screen
       * is asking in.
       */
      const code = parsed.data.code || codeFromName(parsed.data.name);
      if (!code) return res.status(400).json({ message: `Give this ${definition.label.toLowerCase()} a name with letters or numbers in it` });
      try {
        const created = await repository.create({ data: { ...parsed.data, code, ...actorFields(definition, req, true) }, ...options });
        forgetCachedLists(key);
        return res.status(201).json({ data: await withActorNames(definition, created) });
      } catch (error) {
        /*
         * A clash on the code, said as what the person actually did.
         *
         * The code is derived from the name, so the only way to collide with one is to re-enter a
         * name that is already in the list. "Designation code already exists" describes a field the
         * screen does not show and a value nobody typed.
         */
        return handleError(res, error, definition.label, { onDuplicate: `${parsed.data.name} is already in this list` });
      }
    },
    async update(req, res) {
      const id = parseId(req, res);
      if (!id) return;
      const parsed = definition.updateSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed.error);
      if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "Provide at least one field to update" });
      try {
        if (definition.model === "department" && parsed.data.parentDepartmentId === id) return res.status(400).json({ message: "A department cannot be its own parent" });
        /*
         * A rename is carried through to every record holding the old value, in one transaction.
         *
         * The lists are stored on the record as text, so renaming the row alone left every employee
         * under the old word - the list and the records disagreeing with nothing to say so. The two
         * move together or neither does.
         */
        const existing = await repository.findUnique({ where: { id }, select: { name: true } });
        const renaming = existing && parsed.data.name !== undefined && String(parsed.data.name).trim() !== String(existing.name).trim();
        const [updated, renamed] = await prisma.$transaction(async (tx) => [
          await tx[definition.model].update({ where: { id }, data: { ...parsed.data, ...actorFields(definition, req, false) }, ...options }),
          renaming ? await renameUsage(tx, definition, existing.name, parsed.data.name) : 0,
        ]);
        forgetCachedLists(key);
        /*
         * Said rather than left to be noticed. Renaming a department quietly rewrites it on every
         * employee filed under it, and somebody who did not expect that should hear about it at the
         * moment it happens rather than find it later.
         */
        return res.json({
          data: await withActorNames(definition, updated),
          ...(renamed ? { message: `${definition.label} renamed, and updated on ${renamed} record${renamed === 1 ? "" : "s"} that used it.` } : {}),
        });
      } catch (error) { return handleError(res, error, definition.label); }
    },
    /**
     * Deactivates by default, so a record other rows still refer to keeps reading correctly. The
     * lists behind the employee form's dropdowns are held as plain text on the employee rather than
     * as a link to the row, so nothing breaks when one is dropped for good — those pass
     * `?permanent=true` and the row goes, leaving the code free to be used again.
     *
     * A permanent delete is refused while anything still uses the value. It used to go through
     * unchecked, which is how removing "Accounts" from Departments left every employee filed under
     * it naming a department no list offered - nothing failed and nothing was reported, and the
     * studio simply could not choose it again. An archived employee counts: their record still shows
     * what it shows. See `usage.js` for how a value is matched.
     */
    async remove(req, res) {
      const id = parseId(req, res);
      if (!id) return;
      try {
        // Before anything else: the list may not be left without the row that carries its meaning.
        const blocked = await blockedForBeingTheLast(prisma, definition, id);
        if (blocked) return res.status(409).json({ message: blocked });
        if (req.query.permanent === "true") {
          const row = await repository.findUnique({ where: { id }, select: { name: true } });
          if (row) {
            const usage = await countUsage(definition, row.name);
            if (usage.total) return res.status(409).json({ message: refusalMessage(definition, row.name, usage), usage });
          }
          await repository.delete({ where: { id } });
          forgetCachedLists(key);
          return res.json({ message: `${definition.label} deleted`, data: { id } });
        }
        const data = await repository.update({ where: { id }, data: { isActive: false }, ...options });
        forgetCachedLists(key);
        return res.json({ message: `${definition.label} deactivated`, data });
      } catch (error) { return handleError(res, error, definition.label); }
    },
  };
}

//  is exported for its test - the rule it enforces is worth holding to
// directly rather than only through an HTTP round trip.
module.exports = { createController, blockedForBeingTheLast };
