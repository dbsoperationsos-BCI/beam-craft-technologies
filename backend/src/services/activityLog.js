/**
 * The user activity log: what signed-in people did, for Administration → User Activity Logs.
 *
 * Three callers write here and nothing else does:
 *
 * - `src/middleware/activityLog.js`, once per finished `/api` write (POST, PUT, PATCH, DELETE) made by
 *   somebody signed in - reads are not recorded, see `RECORDED_METHODS`;
 * - the sign-in and sign-out handlers in `src/controllers/authController.js`, for the Auth events
 *   the middleware cannot see (a sign-in has no `req.user` until it succeeds);
 * - the daily retention sweep below.
 *
 * ── Never in the way of the request ───────────────────────────────────────────────────────────────
 *
 * A line is queued after the response has gone and written in small batches a moment later. A write
 * that fails is dropped - logged outside production, never thrown - because an audit trail that can
 * break the screen it is auditing is worse than a missing line.
 *
 * ── What a line holds, and what it never holds ────────────────────────────────────────────────────
 *
 * Who (`userId`, and `username` as it was at the time - a snapshot, not a name copy, see the model),
 * their home branch, a utility name derived from the route, the handler's name as the action, the
 * method, the matched route **pattern**, the answer's status, the address, the browser and the time
 * it took - and `changes`, where the handler itself said what it changed (`describeChanges`), which
 * is the one thing here that is not derived from the request. Never a body, a query string, a token
 * or a password: the pattern is
 * `/api/sales/crm-leads/:id`, not the URL that was asked for.
 */

const http = require("node:http");
const net = require("node:net");
const prisma = require("../config/db");
const { clientIp } = require("../middleware/rateLimit");
// Lazily: `changeTracking` is composed into the Prisma client, which requires this file in turn.
const collectedChanges = () => require("./changeTracking").collectedChanges();

const LIMITS = { username: 191, module: 100, action: 150, method: 10, path: 500, clientIp: 64, userAgent: 500, changes: 4000 };
// Control characters (newlines, escapes) never reach a stored line: a user agent or a typed name is
// the caller's to write, and the log is read by people and exported.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const clip = (value, max) => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(CONTROL, "").trim();
  return text ? text.slice(0, max) : null;
};

// ─── Utility names ─────────────────────────────────────────────────────────────────────────────

/*
 * The first segment of these paths is a namespace rather than a screen, so the utility name is the
 * namespace and the segment after it: `/api/sales/crm-leads` is "Sales · CRM Leads".
 */
const NAMESPACES = new Set(["sales", "hrm", "admin", "settings", "project-management", "image-selection", "accounts", "usage", "public"]);

/** Words that title case would spell wrong. */
const WORDS = {
  ai: "AI", crm: "CRM", crd: "CRD", hrm: "HRM", qc: "QC", pdf: "PDF", otp: "OTP", sms: "SMS", id: "ID",
  whatsapp: "WhatsApp", oauth: "OAuth", api: "API",
};

/*
 * Prefixes whose name the general rule would get wrong or say badly, longest first. Matched against
 * the route pattern, so a parameter segment is written as `:param` here.
 */
const KNOWN = [
  [/^\/api\/image-selection\/projects\/:[^/]+\/([a-z-]+)/, (match) => `Image Selection · ${titleCase(match[1])}`],
  [/^\/api\/admin\/activity-logs(\/|$)/, () => "Admin · User Activity Logs"],
  [/^\/api\/auth(\/|$)/, () => "Auth"],
  [/^\/api\/user(\/|$)/, () => "My Profile"],
  [/^\/api\/client(\/|$)/, () => "Client Portal"],
  [/^\/api\/ai(\/|$)/, () => "AI Assistant"],
  [/^\/api\/schedule(\/|$)/, () => "Schedule"],
];

function titleCase(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => WORDS[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * The "utility name" a route belongs to, from its pattern.
 *
 * `/api/sales/crm-leads/:id` → "Sales · CRM Leads", `/api/hrm/attendance` → "HRM · Attendance",
 * `/api/admin/users/:id` → "Admin · Users", `/api/assets/:id` → "Assets". An unknown shape still
 * gets a readable name from its first segments rather than "Unknown".
 */
function moduleNameFor(path) {
  const pattern = String(path || "");
  for (const [test, name] of KNOWN) {
    const match = pattern.match(test);
    if (match) return name(match);
  }
  const segments = pattern.split("/").filter(Boolean);
  if (segments[0] === "api") segments.shift();
  const [first, second] = segments;
  if (!first) return "Application";
  if (NAMESPACES.has(first) && second && !second.startsWith(":")) return `${titleCase(first)} · ${titleCase(second)}`;
  return titleCase(first);
}

// ─── Route pattern and action ──────────────────────────────────────────────────────────────────

/**
 * A segment of a real URL that is a value rather than a word: anything with a digit in it (an id, a
 * code such as `ENQ-0042`, a token), or a long run that looks like a key. Written as `:param`, so a
 * path that reaches the log through the fallback below still carries nobody's id.
 */
const isValueSegment = (segment) => /\d/.test(segment) || segment.length > 40;

/** The mount part of a matched route: its words kept, its values (`/projects/42/...`) as `:param`. */
function normalisePath(urlPath) {
  return "/" + String(urlPath || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => (isValueSegment(segment) ? ":param" : segment))
    .join("/");
}

/*
 * Where no route matched there is no pattern to say which segments are words and which are values,
 * so nothing past the mount is kept at all: `/api`, its first segment, and the second only under a
 * namespace (`/api/sales/crm-leads`, `/api/assets`) - the depth every router is mounted at. The rest
 * is dropped, so a slug, a name or a token further along cannot reach the log, whatever it looks
 * like.
 */
function unmatchedPath(urlPath) {
  const [api, first, second] = String(urlPath || "").split("?")[0].split("/").filter(Boolean);
  const kept = [api, /^[a-z][a-z-]{0,39}$/.test(first || "") ? first : null];
  // Mount names are lower-case words and hyphens; anything else in that place is not one.
  if (NAMESPACES.has(first) && /^[a-z][a-z-]{0,39}$/.test(second || "")) kept.push(second);
  return "/" + kept.filter(Boolean).join("/");
}

/**
 * The matched route pattern for a finished request - `/api/sales/crm-leads/:id` - or, where no
 * route matched (a 404, or a guard on a router that refused before any route was reached), the URL
 * path with its values written as `:param`.
 *
 * Worked out from the URL's own segments rather than from `req.baseUrl`: Express restores
 * `baseUrl` when a request leaves a router through `next(error)`, so by the time the response
 * finishes it may already be gone. A route's own segments line up one to one with the URL's tail,
 * so the mount is whatever comes before them. Unmatched, only the mount survives (`unmatchedPath`).
 */
function routePatternFor(req) {
  const urlPath = String(req.originalUrl || req.url || "").split("?")[0];
  const routePath = req.route?.path;
  if (typeof routePath !== "string") return unmatchedPath(urlPath).slice(0, LIMITS.path);

  const urlSegments = urlPath.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  const exact = routeSegments.every((segment) => !/[*?(){}]/.test(segment));
  if (!exact || routeSegments.length > urlSegments.length) {
    return unmatchedPath(urlPath).slice(0, LIMITS.path);
  }
  const mount = normalisePath(urlSegments.slice(0, urlSegments.length - routeSegments.length).join("/"));
  const joined = routeSegments.length ? `${mount === "/" ? "" : mount}/${routeSegments.join("/")}` : mount;
  return joined.slice(0, LIMITS.path);
}

/**
 * What was done: the name of the route's last handler (`listReferrals`, `createLead`), or the
 * method and pattern where the handler is anonymous or no route was reached.
 */
function actionFor(req, path) {
  const stack = req.route?.stack;
  const handler = Array.isArray(stack) && stack.length ? stack[stack.length - 1]?.handle : null;
  const name = String(handler?.name || "").replace(/^bound /, "").trim();
  const usable = name && name !== "anonymous" && !/^(handler|handle|middleware|<anonymous>)$/i.test(name);
  return clip(usable ? name : `${req.method} ${path}`, LIMITS.action);
}

/** The HTTP reason phrase for a status: 200 → "OK", 307 → "Temporary Redirect". */
const statusTextFor = (code) => http.STATUS_CODES[Number(code)] || "";

// ─── What is not recorded ──────────────────────────────────────────────────────────────────────

/*
 * Only what somebody **did**: a request that creates, changes or deletes something. Reading is not
 * recorded at all - opening a screen fires several reads, the app shell re-reads the person's profile
 * and permissions on every page load, and screens poll on timers, so a log of reads grew by a dozen
 * lines every time somebody moved between two screens and buried every real action. Sign-in and
 * sign-out are written by the auth controller, so who came in, and when, is still there.
 */
const RECORDED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/*
 * Writes that are still background noise rather than somebody doing something, matched against
 * `METHOD /route/pattern`. A new timer that writes belongs here.
 */
const SKIPPED = [
  // The deploy's health checks, and the monitoring screen's.
  new RegExp("^[A-Z]+ /api/health(/|$)"),
  // The usage heartbeat - every minute from every open tab (`useUsageHeartbeat`).
  new RegExp("^POST /api/usage/heartbeat$"),
];

const isSkipped = (method, path) => {
  const key = `${String(method || "").toUpperCase()} ${path}`;
  return SKIPPED.some((pattern) => pattern.test(key));
};

// ─── Writing ───────────────────────────────────────────────────────────────────────────────────

const FLUSH_AFTER_MS = 1000;
const FLUSH_AT = 100;
/** A ceiling on what waits in memory if the database is down, so an outage cannot grow the heap. */
const MAX_QUEUED = 5000;
let queue = [];
let flushTimer = null;
/** One write at a time: a slow database must not pile up batches, each holding a connection. */
let inFlight = null;

const warn = (message, error) => {
  if (process.env.NODE_ENV !== "production") console.warn(`[activity-log] ${message}:`, error?.message || error);
};

/*
 * Who the person is now: their login and home branch, read once and held for a few minutes. The
 * token carries neither the branch nor a username that is guaranteed current, and reading the user
 * on every request would put a query in front of every line.
 */
const PEOPLE_TTL_MS = 5 * 60 * 1000;
const people = new Map();

async function personFor(userId) {
  const held = people.get(userId);
  if (held && held.at > Date.now() - PEOPLE_TTL_MS) return held;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true, name: true, branchId: true } });
  const person = { at: Date.now(), username: user ? user.username || user.email || user.name : null, branchId: user?.branchId ?? null, exists: Boolean(user) };
  if (people.size > 2000) people.clear();
  people.set(userId, person);
  return person;
}

async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (inFlight) { await inFlight; return flush(); }
  if (!queue.length) return;
  inFlight = writeBatch(queue.splice(0, FLUSH_AT));
  try {
    await inFlight;
  } finally {
    inFlight = null;
    if (queue.length) scheduleFlush();
  }
}

async function writeBatch(batch) {
  try {
    const rows = [];
    for (const entry of batch) {
      let { userId, username, branchId } = entry;
      if (userId) {
        const person = await personFor(userId);
        // A line for a login deleted since the token was issued keeps the name and loses the link.
        if (!person.exists) userId = null;
        username = username || person.username;
        if (branchId === undefined) branchId = person.branchId;
      }
      rows.push({ ...entry, userId: userId || null, username: clip(username, LIMITS.username), branchId: branchId ?? null });
    }
    await prisma.userActivityLog.createMany({ data: rows });
  } catch (error) {
    warn(`dropped ${batch.length} line(s)`, error);
  }
}

function scheduleFlush() {
  if (inFlight || flushTimer) return;
  if (queue.length >= FLUSH_AT) { void flush(); return; }
  flushTimer = setTimeout(() => { void flush(); }, FLUSH_AFTER_MS);
  flushTimer.unref?.();
}

/**
 * Queue one line. Never throws and never awaits the database: the caller has already answered.
 *
 * `entry`: `{ userId?, username?, branchId?, module?, action, method, path, statusCode, clientIp?,
 * userAgent?, durationMs?, changes? }`. A missing `module` is derived from `path`; a missing `branchId` for a
 * known `userId` is that person's home branch.
 */
function recordActivity(entry) {
  try {
    if (!entry || !entry.path || !entry.method) return;
    if (queue.length >= MAX_QUEUED) return;
    const path = clip(entry.path, LIMITS.path);
    queue.push({
      createdAt: entry.createdAt || new Date(),
      userId: Number.isInteger(entry.userId) && entry.userId > 0 ? entry.userId : null,
      username: entry.username ?? null,
      branchId: entry.branchId,
      module: clip(entry.module || moduleNameFor(path), LIMITS.module) || "Application",
      action: clip(entry.action, LIMITS.action) || clip(`${entry.method} ${path}`, LIMITS.action),
      method: clip(String(entry.method).toUpperCase(), LIMITS.method),
      path,
      statusCode: Number.isInteger(entry.statusCode) ? entry.statusCode : 0,
      clientIp: clip(entry.clientIp, LIMITS.clientIp),
      userAgent: clip(entry.userAgent, LIMITS.userAgent),
      durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : null,
      changes: clip(entry.changes, LIMITS.changes) || null,
    });
    scheduleFlush();
  } catch (error) {
    warn("could not queue a line", error);
  }
}

/**
 * The caller's address as stored: an IPv4 address that arrived IPv6-mapped (`::ffff:10.0.0.4`) is
 * written as itself, and anything that is not an address at all - a forged or garbled
 * `X-Forwarded-For` - is not written.
 */
function storedIp(req) {
  let address = String(clientIp(req) || "").trim();
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) address = mapped[1];
  return net.isIP(address) ? address : null;
}

/** The line a finished request makes, or null when it is not one to record. */
function entryForRequest(req, res, startedAt) {
  const userId = Number(req.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!String(req.originalUrl || "").startsWith("/api/")) return null;
  if (!RECORDED_METHODS.has(String(req.method || "").toUpperCase())) return null;
  const path = routePatternFor(req);
  if (isSkipped(req.method, path)) return null;
  return {
    userId,
    username: null,
    module: moduleNameFor(path),
    action: actionFor(req, path),
    method: req.method,
    path,
    statusCode: res.statusCode,
    clientIp: storedIp(req),
    userAgent: req.headers?.["user-agent"] || null,
    durationMs: startedAt ? Date.now() - startedAt : null,
    /*
     * What the handler says it changed, if it says anything (`describeChanges`).
     *
     * Read off the request rather than from the body, which is the whole point: this module records a
     * route pattern and never what was sent, so a handler that wants its change written down hands
     * over the words it wants written. An endpoint carrying a password or a bank account says nothing
     * because it never opted in - not because somebody remembered to exclude it.
     *
     * Only on a write that succeeded. A refused save changed nothing, and a line saying it did would
     * be worse than no line at all.
     */
    changes: res.statusCode < 400 ? changesOn(req) : null,
  };
}

/**
 * **How a handler says what it changed.** Call it any time before answering:
 *
 *     describeChanges(req, ["Main Event Date: 20 Nov 2026 → 22 Nov 2026", "Production Manager: — → Karthik"]);
 *
 * A list of lines, or one string. Called twice, the lists join - a save that writes a record and its
 * rows can describe each part where it does it. Nothing is validated beyond length: these are the
 * studio's own words about its own records, and the handler is the only thing that knows them.
 */
function describeChanges(req, changes) {
  if (!req) return;
  const lines = (Array.isArray(changes) ? changes : [changes])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
  if (!lines.length) return;
  req.activityChanges = [...(req.activityChanges || []), ...lines];
}

/**
 * What this request changed, as one string - or null where nothing described itself.
 *
 * Two sources, in this order: what a **handler** said (`describeChanges`), which is written in the
 * studio's own words, and then what the **writes themselves** said
 * (`changeTracking.collectedChanges`), which needs nobody to wire it up and so covers the screens
 * a handler never got round to. A handler's own wording first, because "Advance of ₹5,000 recorded"
 * reads better than the four columns that recorded it.
 */
const changesOn = (req) => {
  const said = req?.activityChanges || [];
  const watched = collectedChanges() || [];
  return clip([...said, ...watched].join(" · "), LIMITS.changes) || null;
};

/**
 * A sign-in, a failed sign-in or a sign-out, from the auth controller - one line there, the rest
 * here. `user` is the account when it is known; what was typed is never kept (`accountName`). A failed sign-in carries no `userId`, but it
 * does carry the branch of the account it named, so a branch's administrator sees attempts on it.
 */
/*
 * What a sign-in line names. An account that matched is named by its own login. The text typed is
 * **never** stored: when it matched no account it is, as often as not, a password typed into the
 * wrong box, and it must not sit readable in an audit table for six months - so it is a fixed
 * placeholder instead.
 */
const UNKNOWN_ACCOUNT = "(unknown account)";
const accountName = (user) => (user ? user.username || user.email || user.name || UNKNOWN_ACCOUNT : UNKNOWN_ACCOUNT);

function recordAuthEvent(req, { action, statusCode, user = null, succeeded = true }) {
  const path = action === "Logout" ? "/api/auth/logout" : "/api/auth/login";
  recordActivity({
    userId: succeeded && user ? user.id : null,
    username: accountName(user),
    // A failed sign-in on a Super Admin carries no branch, so it is shown to Super Admins alone - the
    // same rule the list applies to every line a Super Admin made (`activity-logs/service.js`).
    branchId: user && !(user.role === "SUPER_ADMIN" && !succeeded) ? user.branchId ?? null : null,
    module: "Auth",
    action,
    method: "POST",
    path,
    statusCode,
    clientIp: storedIp(req),
    userAgent: req.headers?.["user-agent"] || null,
  });
}

// ─── Retention ─────────────────────────────────────────────────────────────────────────────────

// Six calendar months at their longest (184 days) and two to spare, so the screen's "Last 6 months"
// always has the whole of its span to read.
const DEFAULT_RETENTION_DAYS = 186;
const PURGE_BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionDays() {
  const days = Number(process.env.ACTIVITY_LOG_RETENTION_DAYS);
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : DEFAULT_RETENTION_DAYS;
}

/**
 * Deletes the lines older than the retention window, a batch at a time so a large first sweep
 * never holds a long lock on a table every request is writing to.
 */
async function purgeExpiredActivityLogs({ now = new Date(), days = retentionDays() } = {}) {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return { removed: await deleteActivityLogsBefore(cutoff), cutoff };
}

/**
 * Deletes every line written before `cutoff`, a batch at a time so a large delete never holds the
 * table locked for long. Shared by the daily sweep and Settings → Activity Log Purge.
 */
async function deleteActivityLogsBefore(cutoff) {
  let removed = 0;
  for (;;) {
    const count = await prisma.$executeRaw`DELETE FROM \`user_activity_log\` WHERE \`created_at\` < ${cutoff} ORDER BY \`id\` LIMIT ${PURGE_BATCH}`;
    removed += Number(count) || 0;
    if (Number(count) < PURGE_BATCH) break;
  }
  return removed;
}

/** Deletes every line written from `from` up to and including `to`, a batch at a time. */
async function deleteActivityLogsBetween(from, to) {
  let removed = 0;
  for (;;) {
    const count = await prisma.$executeRaw`DELETE FROM \`user_activity_log\` WHERE \`created_at\` >= ${from} AND \`created_at\` <= ${to} ORDER BY \`id\` LIMIT ${PURGE_BATCH}`;
    removed += Number(count) || 0;
    if (Number(count) < PURGE_BATCH) break;
  }
  return removed;
}

let retentionTimer = null;

/** Daily, and once a minute after boot. Off in the test environment. */
function startActivityLogRetention() {
  if (retentionTimer || process.env.NODE_ENV === "test") return null;
  const run = () => purgeExpiredActivityLogs()
    .then(({ removed }) => { if (removed) console.log(`[activity-log] removed ${removed} line(s) older than ${retentionDays()} days`); })
    .catch((error) => console.error("[activity-log] retention sweep failed:", error?.message || error));
  const first = setTimeout(run, 60 * 1000);
  first.unref?.();
  retentionTimer = setInterval(run, DAY_MS);
  retentionTimer.unref?.();
  return retentionTimer;
}

function stopActivityLogRetention() {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
}

module.exports = {
  describeChanges,
  recordActivity,
  recordAuthEvent,
  entryForRequest,
  flushActivityLog: flush,
  moduleNameFor,
  routePatternFor,
  actionFor,
  statusTextFor,
  isSkipped,
  RECORDED_METHODS,
  retentionDays,
  purgeExpiredActivityLogs,
  deleteActivityLogsBefore,
  deleteActivityLogsBetween,
  startActivityLogRetention,
  stopActivityLogRetention,
  SKIPPED,
  UNKNOWN_ACCOUNT,
  storedIp,
};
