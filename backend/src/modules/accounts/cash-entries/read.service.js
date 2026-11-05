const prisma = require("../../../config/db");

/**
 * Reading cash entries, for callers that are not an HTTP handler.
 *
 * The module's list logic lives in `listEntries(req, res)`. This is the same query as a function.
 * Additive: the controller is untouched and still has its copy, which is a duplication owed a
 * follow-up rather than a design.
 *
 * Money is the sensitive part here, so the shape is narrow. Bank account numbers, transaction ids
 * and payment proofs are never selected: "how much came in this month" needs none of them, and a
 * transaction id in a prompt is a transaction id in a log.
 */

const SAFE_FIELDS = {
  entryId: true,
  entryType: true,
  category: true,
  amount: true,
  entryDate: true,
  branch: true,
  clientName: true,
  handlerName: true,
};

const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

function boundedLimit(value) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked < 1) return DEFAULT_ROWS;
  return Math.min(Math.floor(asked), MAX_ROWS);
}

/**
 * The rows the caller may see, as `dataScope.resolve()` answered - always under `AND`, never spread.
 *
 * The rule's `where` is itself an `OR` (your name, your team's, your branches), so spreading it
 * beside a search that sets its own `OR` replaced the rule with the search and returned rows the
 * caller may not see. Under `AND` the two cannot collide, whatever either of them holds.
 *
 * Nothing given means nothing narrowed, which only the shape tests do.
 */
function scopeWhere(scope) {
  return { AND: [scope?.where || {}] };
}

/** Entries matching a search, in the safe shape. */
async function searchEntries({ search, entryType, category, limit, scope } = {}) {
  const where = { deletedAt: null, ...scopeWhere(scope) };

  const term = String(search || "").trim();
  if (term) {
    where.OR = [{ clientName: { contains: term } }, { entryId: { contains: term } }];
  }
  const type = String(entryType || "").trim();
  if (type) where.entryType = type;
  const inCategory = String(category || "").trim();
  if (inCategory) where.category = inCategory;

  const take = boundedLimit(limit);
  const [rows, total] = await Promise.all([
    prisma.cashEntry.findMany({ where, select: SAFE_FIELDS, orderBy: { entryDate: "desc" }, take }),
    prisma.cashEntry.count({ where }),
  ]);

  return {
    count: rows.length,
    total,
    limit: take,
    truncated: total > rows.length,
    // Decimal comes back as an object; the model needs a number it can read.
    items: rows.map((row) => ({ ...row, amount: row.amount === null ? null : Number(row.amount) })),
  };
}

/**
 * What came in and what went out, totalled.
 *
 * Summed in the database. Asking a model to add up a page of amounts is how a figure ends up wrong,
 * and a wrong figure about money is worse than most.
 */
async function getCashSummary({ scope } = {}) {
  const where = { deletedAt: null, ...scopeWhere(scope) };
  const [byType, byCategory, total] = await Promise.all([
    prisma.cashEntry.groupBy({ by: ["entryType"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.cashEntry.groupBy({ by: ["category"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.cashEntry.count({ where }),
  ]);

  const shape = (rows, key) => rows
    .map((row) => ({
      value: row[key] || "(not set)",
      count: row._count._all,
      amount: row._sum.amount === null ? 0 : Number(row._sum.amount),
    }))
    .sort((a, b) => b.amount - a.amount);

  return { entries: total, byType: shape(byType, "entryType"), byCategory: shape(byCategory, "category") };
}

module.exports = { searchEntries, getCashSummary, SAFE_FIELDS, MAX_ROWS };
