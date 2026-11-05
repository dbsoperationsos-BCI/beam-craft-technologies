const { everyChunk } = require("./wordChunks");

/**
 * A picker that is **searched on the server** rather than handed its whole list.
 *
 * ── Why this exists ──
 *
 * A picker over a long list used to be filled by its screen's `/options` call, capped so the payload
 * stayed sane - `take: 200` - and then filtered in the browser as somebody typed. The cap reads like
 * a page. It is not: nothing fetches the next one, so it is the limit of **what can be chosen at
 * all**, and the picker filters only what it was given. Type an id outside the cap and the menu says
 * "No options available", which is the app saying the record does not exist.
 *
 * It is worse than a flat limit, because these lists are ordered newest-first. What falls off the end
 * is the oldest - which is a studio's imported history. On the development database that was 200 of
 * 986 shoots and 200 of 640 projects reachable, and the rows out of reach were exactly the ones a
 * studio brings in when it starts using the app.
 *
 * ── What replaces it ──
 *
 * The typing comes to the server. Every word typed must appear somewhere in the row, in any order
 * (`wordChunks`), matched across whichever columns the caller names - an id, a name, the code of the
 * thing it belongs to. The caller gets a page and the **real** total, so the menu can say "Showing 50
 * of 312" instead of stopping and looking like a list that has lost entries.
 *
 * `/options` still carries a page for the picker to open on, which is the one honest use of a short
 * list: something to show before anybody has typed.
 *
 * ── Using it ──
 *
 *     const page = await searchPicker(prisma.projectShoot, {
 *       search,
 *       where: { deletedAt: null, project: { deletedAt: null } },
 *       chunkIn: (chunk) => [{ shootId: { contains: chunk } }, { shoot: { contains: chunk } }],
 *       select: { id: true, shootId: true, shoot: true },
 *       orderBy: [{ dateCreated: "desc" }],
 *     });
 *     // → { rows, total, capped }
 */

/** How many a picker shows at once. One number, so every picker in the app stops at the same place. */
const PICKER_PAGE = 50;

/**
 * One page of a searched picker, and how many matched in all.
 *
 * `chunkIn(chunk)` returns the clauses **one** typed word may satisfy - usually a column list - and
 * every word must satisfy one of them, so "sudheer maternity" finds a row whose name holds one and
 * whose project holds the other.
 *
 * The total is counted only when the page came back full, so the common case - a search narrow enough
 * to fit - costs a single query.
 */
async function searchPicker(model, { search = "", where = {}, chunkIn, select, orderBy, take = PICKER_PAGE } = {}) {
  const chunks = everyChunk(search, (chunk) => ({ OR: chunkIn(chunk) }));
  // Kept under one `AND` beside whatever the caller already narrowed on, never replacing it: a
  // `where` built by spreading would drop the caller's own `AND` (a branch rule, a scope) silently.
  const full = chunks.length ? { ...where, AND: [...(where.AND ? [].concat(where.AND) : []), ...chunks] } : where;
  const rows = await model.findMany({ where: full, orderBy, take, select });
  const total = rows.length < take ? rows.length : await model.count({ where: full });
  return { rows, total, capped: total > rows.length };
}

module.exports = { PICKER_PAGE, searchPicker };
