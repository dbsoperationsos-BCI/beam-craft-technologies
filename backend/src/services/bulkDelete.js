const { z } = require("zod");

/*
 * ── Deleting a ticked set of rows, from any module's table ─────────────────────────────────────
 *
 * Leads & Followups and the Interview register have had a column of tick boxes for a while, each
 * with a `DELETE /bulk` written by hand beside it. Every other table in the application was worked
 * a row at a time. This is that bulk delete, written once for all of them - the same bargain
 * `tableImport.js` makes for the CSV import beside it.
 *
 * ── What it deliberately does not do ──
 *
 * It does not delete. It has no Prisma client, no model name, and no idea what deleting a vendor
 * entails as against deleting a cash entry - each module already has one function that removes a
 * record and does everything removing one entails: the rows hanging off it, the file on disk, the
 * audit line, the refusal when the record is not this caller's to touch. A bulk route with its own
 * idea of any of that is a second way out of the table that drifts from the first, and the drift
 * shows up as rows deleted that the single-row route would have refused.
 *
 * **That is also the whole of the security argument, so it is worth saying plainly.** The ids
 * arrive in the request body, and CLAUDE.md Rule 4 says never to trust one of those to be a row the
 * caller may touch. Nothing here checks them, because nothing here *could*: only the module knows
 * what makes a row reachable. So `deleteOne` is handed the request alongside the id and is expected
 * to be - or to call straight through to - the same function `DELETE /:id` uses, refusals and all.
 * A module that hands over a bare `prisma.thing.delete` has opened a hole, and the guard above the
 * route will not close it: `ADMIN / Table Select All` says this reader may act on a selection, not
 * that every id they can type belongs to them.
 *
 * ── What it does do ──
 *
 * Walks the ids one at a time and reports per id, the way the importer reports per row: a selection
 * of forty with three rows already gone deletes thirty-seven and says so, rather than refusing the
 * lot or claiming forty. One at a time rather than a `deleteMany`, because the module's own delete
 * is the only thing that knows the record's dependents, and because a set that is partly not yours
 * should lose exactly the part that is.
 */

/**
 * The ids a bulk route accepts.
 *
 * Capped at 500, which is the cap the CRM's own board settled on for a reason worth keeping: a
 * selection larger than a screenful is a script, and a request that deletes ten thousand records
 * holds a connection long enough to look like an outage. A page that needs more can send twice.
 */
const bulkIdsSchema = z
  /*
   * A string **or** a number, because the application's tables are keyed both ways - assets and
   * employees carry integer ids, leads and candidates carry uuids - and a page sends whatever its
   * rows actually hold.
   *
   * Deliberately not normalised to a string. The ids are echoed back in `deletedIds`, and the
   * selection bar clears its ticks by looking each one up in the set it sent: an id that left as
   * the number 12 and came back as the string "12" would match nothing, and every row would stay
   * ticked after a delete that worked.
   */
  .array(z.union([z.string().trim().min(1).max(64), z.number().int()]))
  .min(1, "Select at least one row.")
  .max(500);

/** How many ids one request may carry, so a page can chunk to the same number rather than guess. */
const BULK_DELETE_LIMIT = 500;

/**
 * Deletes each id through the module's own delete, and counts what happened.
 *
 * `deleteOne(id, req)` may throw for any reason the single-row route would - not found, not yours,
 * still referenced by something. Every throw lands the id in `missedIds` rather than failing the
 * request: the reader ticked a set, and the useful answer is which part of it went, not a 500 that
 * leaves them guessing whether any of it did.
 *
 * `noun` / `plural` are only ever read for the sentence shown to the reader.
 */
async function runBulkDelete({ ids, deleteOne, req, noun = "record", plural }) {
  const unique = [...new Set(ids || [])];
  const deletedIds = [];
  const missedIds = [];

  for (const id of unique) {
    try {
      await deleteOne(id, req);
      deletedIds.push(id);
    } catch (error) {
      void error;
      missedIds.push(id);
    }
  }

  const many = plural || `${noun}s`;
  const deleted = `${deletedIds.length} ${deletedIds.length === 1 ? noun : many}`;
  return {
    deletedIds,
    missedIds,
    message: missedIds.length
      ? `${deleted} deleted. ${missedIds.length} could not be deleted and ${missedIds.length === 1 ? "was" : "were"} left alone.`
      : `${deleted} deleted.`,
  };
}

/**
 * The whole `DELETE /bulk` handler, for a module that has nothing to add to it.
 *
 * Answers 400 to a body that is not a list of ids, 404 when none of the selection could be deleted
 * - which is what the reader needs to hear, and is not the same as the partial success above it -
 * and 200 with both lists otherwise. The frontend's selection bar reads `data.deletedIds` to clear
 * exactly the rows that went and leave the ticks on the rows that did not.
 */
function bulkDeleteHandler({ deleteOne, noun = "record", plural }) {
  return async (req, res) => {
    const parsed = z.object({ ids: bulkIdsSchema }).safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Select at least one row.", errors: parsed.error.flatten() });
    }

    const answer = await runBulkDelete({ ids: parsed.data.ids, deleteOne, req, noun, plural });
    if (!answer.deletedIds.length) {
      return res.status(404).json({ message: `None of the selected ${plural || `${noun}s`} could be deleted.`, data: answer });
    }
    return res.json({ message: answer.message, data: answer });
  };
}

/**
 * Mounts `DELETE /bulk` on a module's router, behind its guard.
 *
 * A helper rather than three lines per router, so the guard cannot be left off one of twenty
 * routers and go unnoticed - an unguarded bulk delete is the one mistake in this change that would
 * matter. `guard` is whatever the module needs *on top of* `ADMIN / Table Select All`, which is
 * mounted here for every caller: deleting a set asks for both, exactly as the CRM's own bulk delete
 * asks for Select All and `CRM Lead Deletion` together.
 *
 * **Call it above the router's `/:id` routes.** `/bulk` is a fixed segment, and a router that
 * matches `/:id` first reads it as a record named "bulk" and answers 404 - a route in the wrong
 * order wearing the costume of a missing record.
 */
function mountBulkDelete(router, { path = "/bulk", guard, deleteOne, noun, plural }) {
  const { checkPermission } = require("../middleware/permissionMiddleware");
  const canSelectAll = checkPermission("ADMIN", "Table Select All", "READ_WRITE");
  const guards = [canSelectAll, ...(Array.isArray(guard) ? guard : guard ? [guard] : [])];
  router.delete(path, ...guards, bulkDeleteHandler({ deleteOne, noun, plural }));
  return router;
}

module.exports = { bulkIdsSchema, BULK_DELETE_LIMIT, runBulkDelete, bulkDeleteHandler, mountBulkDelete };
