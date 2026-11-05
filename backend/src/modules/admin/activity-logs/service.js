const http = require("node:http");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { statusTextFor } = require("../../../services/activityLog");
const { everyChunk } = require("../../../services/wordChunks");

/** The permission this list is read under - and so whose branches it narrows to. */
const PERMISSION = { module: "ADMIN", feature: "User Activity Logs" };

const SORTABLE = ["createdAt", "username", "module", "action", "method", "clientIp", "statusCode"];

/**
 * Which lines this reader may see.
 *
 * A Super Admin is narrowed by nothing. Anybody else sees the lines of **people homed in** the
 * branches of the roles granting `ADMIN / User Activity Logs` (a line's branch is its actor's home
 * branch when it was written) - and never a line a Super Admin made, since that account answers to
 * no branch. A reader whose roles name no branch for the permission sees nothing. Lines with no
 * branch - a failed sign-in naming no account, a login with no home branch - are a Super Admin's
 * alone.
 *
 * `null` when nothing at all is reachable, so the caller can answer without a query.
 */
async function branchScope(userId) {
  const branchIds = await iamService.reachableBranchIds(userId, PERMISSION);
  if (branchIds === null) return {};
  if (!branchIds.length) return null;
  return {
    branchId: { in: branchIds },
    // `User.role` is what `reachableBranchIds` itself reads to decide a Super Admin. A line whose
    // login has since been deleted (`userId` null) has no actor left to hide.
    OR: [{ userId: null }, { user: { is: { role: { not: "SUPER_ADMIN" } } } }],
  };
}

/**
 * The status codes a "status" filter means. Digits match the code - a whole code exactly, a part
 * of one as its leading digits ("4" is every 4xx, "40" is 400-409) - and words match the reason
 * phrase ("OK", "not found"). `null` when the filter names no status at all.
 */
function statusCodesFor(status) {
  const wanted = String(status || "").trim();
  if (!wanted) return undefined;
  if (/^\d{1,3}$/.test(wanted)) {
    if (wanted.length === 3) return { equals: Number(wanted) };
    const scale = 10 ** (3 - wanted.length);
    return { gte: Number(wanted) * scale, lt: (Number(wanted) + 1) * scale };
  }
  const lower = wanted.toLowerCase();
  const codes = Object.entries(http.STATUS_CODES)
    .filter(([, phrase]) => String(phrase).toLowerCase().includes(lower))
    .map(([code]) => Number(code));
  return codes.length ? { in: codes } : null;
}

/** The Prisma `where` for a parsed query, inside the reader's branch scope. */
function whereFor(scope, filters = {}) {
  const and = [scope];
  if (filters.from || filters.to) {
    and.push({ createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } });
  }
  // Case-insensitive by the table's collation (utf8mb4_unicode_ci), which is how every other text
  // filter in the application matches. Word Chunk Search: every word typed, any order.
  and.push(...everyChunk(filters.username, (chunk) => ({ OR: [
    { username: { contains: chunk } },
    { user: { is: { name: { contains: chunk } } } },
  ] })));
  and.push(...everyChunk(filters.module, (chunk) => ({ module: { contains: chunk } })));
  and.push(...everyChunk(filters.action, (chunk) => ({ action: { contains: chunk } })));
  if (filters.method) and.push({ method: filters.method });
  and.push(...everyChunk(filters.clientIp, (chunk) => ({ clientIp: { contains: chunk } })));
  /*
   * What changed, searched by word: "event date" finds every line that moved one, whoever moved it,
   * which is the question this column exists to answer. Word Chunk Search like the rest, so "ravi
   * event date" is not a phrase anybody has to type in the right order.
   */
  and.push(...everyChunk(filters.changes, (chunk) => ({ changes: { contains: chunk } })));
  if (filters.status) {
    const codes = statusCodesFor(filters.status);
    if (codes === null) return null;
    if (codes) and.push({ statusCode: codes });
  }
  return { AND: and };
}

/*
 * What the grid draws, and nothing more: the list is the part read a hundred lines at a time, so the
 * browser text, the route, the names and the timing - read only in the details panel - are left to
 * `detail`, and the list needs no join to the user or the branch.
 */
/*
 * `changes` is on the **list** as well as the detail: it is the column the log was missing, and a
 * reader looking for "what did he change on that project" should not have to open every line of the
 * day to find out which one carried it.
 */
const LIST_FIELDS = { id: true, createdAt: true, username: true, module: true, action: true, method: true, clientIp: true, statusCode: true, changes: true };

const toListRow = (row) => ({
  id: String(row.id),
  createdAt: row.createdAt,
  username: row.username,
  module: row.module,
  action: row.action,
  method: row.method,
  clientIp: row.clientIp,
  statusCode: row.statusCode,
  statusText: statusTextFor(row.statusCode),
  changes: row.changes || null,
});

/** One line in full, for the details panel. */
const toRow = (row) => ({
  id: String(row.id),
  createdAt: row.createdAt,
  userId: row.userId,
  username: row.username,
  userName: row.user?.name ?? null,
  module: row.module,
  action: row.action,
  method: row.method,
  path: row.path,
  statusCode: row.statusCode,
  statusText: statusTextFor(row.statusCode),
  clientIp: row.clientIp,
  userAgent: row.userAgent,
  durationMs: row.durationMs,
  branchId: row.branchId,
  branchName: row.branch?.name ?? null,
  // What the handler said it changed, where it said anything - see `services/activityLog.js`.
  changes: row.changes || null,
});

/**
 * One page of the log, newest first unless asked otherwise.
 *
 * `total` is counted on the first page only - a count over a large table on every page turn is the
 * expensive half of the request - and is `null` on later pages, where the screen keeps the first
 * page's. How deep a reader may page is bounded by the controller (`MAX_DEPTH`).
 */
async function list(userId, { page = 1, pageSize = 50, sortBy = "createdAt", sortOrder = "desc", ...filters } = {}) {
  const empty = { rows: [], total: page === 1 ? 0 : null, page, pageSize };
  const scope = await branchScope(userId);
  if (!scope) return empty;
  const where = whereFor(scope, filters);
  if (!where) return empty;

  const field = SORTABLE.includes(sortBy) ? sortBy : "createdAt";
  const order = sortOrder === "asc" ? "asc" : "desc";
  const [total, rows] = await Promise.all([
    page === 1 ? prisma.userActivityLog.count({ where }) : Promise.resolve(null),
    prisma.userActivityLog.findMany({
      where,
      // The id breaks ties, so a page boundary never repeats or skips a line.
      orderBy: [{ [field]: order }, { id: order }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_FIELDS,
    }),
  ]);
  return { rows: rows.map(toListRow), total, page, pageSize };
}

/**
 * One line in full - who, from where, on which route, how long it took - or `null` when it does
 * not exist or is outside what this reader may see (the same scope as the list, so an id guessed
 * from another branch answers exactly like one that was never written).
 */
async function detail(userId, id) {
  const scope = await branchScope(userId);
  if (!scope) return null;
  const row = await prisma.userActivityLog.findFirst({
    where: { AND: [scope, { id }] },
    include: { user: { select: { name: true } }, branch: { select: { name: true } } },
  });
  return row ? toRow(row) : null;
}

/** The methods a line can carry - fixed, so offering them costs no query. */
// What a line can carry: reads are not recorded (see `RECORDED_METHODS` in services/activityLog.js),
// and the sign-in lines are POSTs.
const METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const OPTIONS_WINDOW_DAYS = 30;
const OPTIONS_TTL_MS = 5 * 60 * 1000;
const optionsCache = new Map();

/**
 * The values the Utility and Method filters offer. Methods are the fixed list; utilities are the
 * distinct ones in this reader's lines over the last thirty days (a window the `(module,
 * created_at)` index serves), held for five minutes per reach so opening the screen does not scan
 * the table each time.
 */
async function options(userId, { now = Date.now() } = {}) {
  const scope = await branchScope(userId);
  if (!scope) return { modules: [], methods: METHODS };
  const key = JSON.stringify(scope);
  const held = optionsCache.get(key);
  if (held && held.at > now - OPTIONS_TTL_MS) return { modules: held.modules, methods: METHODS };
  const since = new Date(now - OPTIONS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.userActivityLog.groupBy({ by: ["module"], where: { AND: [scope, { createdAt: { gte: since } }] }, orderBy: { module: "asc" } });
  const modules = rows.map((row) => row.module);
  if (optionsCache.size > 200) optionsCache.clear();
  optionsCache.set(key, { at: now, modules });
  return { modules, methods: METHODS };
}

/**
 * Every line the reader's filters, period, sort and branch reach select - the whole of what the list
 * pages through - for an export. `null` when there are more than `limit`, so the caller can ask the
 * reader to narrow it instead of writing a file that silently stops part way.
 */
async function forExport(userId, { sortBy = "createdAt", sortOrder = "desc", ...filters } = {}, limit) {
  const scope = await branchScope(userId);
  if (!scope) return [];
  const where = whereFor(scope, filters);
  if (!where) return [];
  if (await prisma.userActivityLog.count({ where }) > limit) return null;
  const field = SORTABLE.includes(sortBy) ? sortBy : "createdAt";
  const order = sortOrder === "asc" ? "asc" : "desc";
  return prisma.userActivityLog.findMany({
    where,
    orderBy: [{ [field]: order }, { id: order }],
    take: limit,
    include: { user: { select: { name: true } }, branch: { select: { name: true } } },
  });
}

module.exports = { list, detail, forExport, options, whereFor, statusCodesFor, SORTABLE, PERMISSION, METHODS, branchScope };
