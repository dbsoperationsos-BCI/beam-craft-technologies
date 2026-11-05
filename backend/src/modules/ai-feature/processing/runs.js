const prisma = require("../../../config/db");
const { mergeGroup } = require("../shared/settingsDefaults");
const notificationConfig = require("../notifications/config");

/**
 * Processing runs: when an event's AI work has settled, so a summary can say what was found without
 * speaking too early. The per-photo status (`AiEventMedia.aiStatus`) stays exactly as it was; a run
 * is the container over it.
 *
 * - An event has at most one OPEN run, held by the unique `openKey` (the event id while open, null
 *   after), so two uploads arriving together cannot open two.
 * - `touch` is called wherever work arrives or matches change: a photo queued (upload, retry), a
 *   match confirmed or a person linked by staff, and a photo finishing. It opens a run if none is
 *   open, notes the activity, and makes sure a check is scheduled. It never throws: a run that
 *   cannot be noted must not fail an upload or a confirmation.
 * - `check` (the queue's `settle-run` job) settles a run once nothing in it is QUEUED or PROCESSING
 *   and nothing has happened for `QUIET_MS` - so a run does not settle in a gap between files of
 *   one upload - or gives up waiting after `MAX_RUN_MS`, as STALLED (the face engine down, say).
 *   Settling is one conditional UPDATE from OPEN, which also requires that no activity arrived since
 *   the check read the run: exactly one worker can settle a run, and never over fresh work.
 *
 * Runs exist for the guest summary alone, so they are kept only where it can be sent: with the
 * server switch off (production until it is turned on) nothing here reads or writes anything, and an
 * event whose own switch is off opens no run. What an upload does is then exactly what it did before.
 *
 * A photo that joins a run just as it settles, or one left waiting by a STALLED run, is not lost:
 * finishing touches the event again, which opens the next run. And nothing a run reports is decided
 * by membership - a summary claims the guest's unreported matches (notifications/service.js) - so a
 * photo counted under the "wrong" run still reaches the guest exactly once.
 */
const QUIET_MS = Number.parseInt(process.env.AI_FEATURE_RUN_QUIET_MS || "", 10) || 2 * 60 * 1000;
const MAX_RUN_MS = Number.parseInt(process.env.AI_FEATURE_RUN_MAX_MS || "", 10) || 6 * 60 * 60 * 1000;
/** How often an open run with work still pending is looked at again. */
const RECHECK_MS = 2 * 60 * 1000;
const PENDING = ["QUEUED", "PROCESSING"];

const lazyQueue = () => require("./queue");
const lazyNotifications = () => require("../notifications/service");

/** The event's open run, opened if there is none. Two callers at once meet on the unique key. */
async function openRun(eventId, { db = prisma } = {}) {
  const found = await db.aiEventProcessingRun.findUnique({ where: { openKey: eventId } });
  if (found) return found;
  try {
    return await db.aiEventProcessingRun.create({ data: { eventId, openKey: eventId } });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    return db.aiEventProcessingRun.findUnique({ where: { openKey: eventId } });
  }
}

/** Whether this event's work is tracked at all: the server switch first (no query when it is off), then the event's own. */
async function tracked(eventId, db) {
  if (!notificationConfig.enabled()) return false;
  const setting = await db.aiEventSetting.findUnique({ where: { eventId }, select: { notifications: true } });
  return mergeGroup("notifications", setting?.notifications).guestWhatsAppSummary === true;
}

/** The open run's id for a photo about to be queued, or null - never a reason to refuse the photo. */
async function runIdFor(eventId, { db = prisma } = {}) {
  try { return (await tracked(eventId, db)) ? (await openRun(eventId, { db })).id : null; } catch (error) { console.warn(`[ai-feature] processing run not opened: ${error.message}`); return null; }
}

/** Notes work on the event's open run (opening one if needed) and makes sure a check is due. */
async function touch(eventId, { db = prisma, schedule = null, now = Date.now() } = {}) {
  try {
    if (!(await tracked(eventId, db))) return null;
    const run = await openRun(eventId, { db });
    if (!run) return null;
    await db.aiEventProcessingRun.updateMany({ where: { id: run.id, status: "OPEN" }, data: { lastActivityAt: new Date(now) } });
    await (schedule || lazyQueue().enqueueRunCheck)(run.id, QUIET_MS);
    return run.id;
  } catch (error) {
    console.warn(`[ai-feature] processing run not noted: ${error.message}`);
    return null;
  }
}

/** A run's final word from its photos' outcomes. */
function outcome({ completed = 0, failed = 0, skipped = 0, pending = 0 }) {
  if (pending) return "STALLED";
  if (!failed) return "COMPLETED";
  return completed + skipped ? "PARTIAL" : "FAILED";
}

async function countsFor(db, runId) {
  const rows = await db.aiEventMedia.groupBy({ by: ["aiStatus"], where: { runId, deletedAt: null }, _count: { _all: true } });
  const by = Object.fromEntries(rows.map((row) => [row.aiStatus, row._count._all]));
  const pending = PENDING.reduce((sum, status) => sum + (by[status] || 0), 0);
  return { completed: by.COMPLETED || 0, failed: by.FAILED || 0, skipped: by.SKIPPED || 0, pending, total: rows.reduce((sum, row) => sum + row._count._all, 0) };
}

/** How long after settling a run's own check may write its summaries again, after a failure the first time. */
const RESUMMARIZE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Looks at one run. Returns `{ retryAt }` when it is not time yet, or `{ done: true, status }`.
 * `summarize` stands in for the notification service in tests.
 *
 * Writing the summaries after settling may fail (the database for a moment); the error is thrown so
 * the queue tries the job again, and a run settled within the hour has its summaries written again.
 * That is safe to repeat: each guest's row is unique per run and the matches are claimed once, so a
 * second pass writes only what the first did not.
 */
async function check(runId, { db = prisma, now = Date.now(), summarize = null } = {}) {
  const run = await db.aiEventProcessingRun.findUnique({ where: { id: runId } });
  if (!run) return { done: true, status: "GONE" };
  if (run.status !== "OPEN") {
    const settledAt = run.settledAt ? new Date(run.settledAt).getTime() : 0;
    if (now - settledAt < RESUMMARIZE_WINDOW_MS) await (summarize || lazyNotifications().summarizeRun)(run);
    return { done: true, status: run.status };
  }
  const counts = await countsFor(db, run.id);
  const age = now - new Date(run.openedAt).getTime();
  const quietFor = now - new Date(run.lastActivityAt).getTime();
  if (counts.pending && age < MAX_RUN_MS) return { retryAt: now + RECHECK_MS };
  if (!counts.pending && quietFor < QUIET_MS) return { retryAt: new Date(run.lastActivityAt).getTime() + QUIET_MS };

  const status = outcome(counts);
  const { count } = await db.aiEventProcessingRun.updateMany({
    where: { id: run.id, status: "OPEN", lastActivityAt: run.lastActivityAt },
    data: { status, openKey: null, settledAt: new Date(now), mediaTotal: counts.total, mediaCompleted: counts.completed, mediaFailed: counts.failed, mediaSkipped: counts.skipped, mediaPending: counts.pending },
  });
  if (!count) {
    // Settled by someone else, or work arrived while this looked: look again after a quiet spell.
    const fresh = await db.aiEventProcessingRun.findUnique({ where: { id: run.id }, select: { status: true } });
    return fresh?.status === "OPEN" ? { retryAt: now + QUIET_MS } : { done: true, status: fresh?.status || "GONE" };
  }
  try {
    await (summarize || lazyNotifications().summarizeRun)({ ...run, status, settledAt: new Date(now) });
  } catch (error) {
    // The run stays settled; the queue's next attempt writes what this one could not (see above).
    console.error(`[ai-feature] guest summaries for run ${run.id} not written yet: ${error.message}`);
    throw error;
  }
  return { done: true, status };
}

/** The sweep: every open run gets a check scheduled, in case its job was lost with Redis. */
async function recoverOpen({ db = prisma, schedule = null } = {}) {
  const open = await db.aiEventProcessingRun.findMany({ where: { status: "OPEN" }, select: { id: true }, take: 1000 });
  const add = schedule || lazyQueue().enqueueRunCheck;
  for (const run of open) await add(run.id, 0).catch(() => {});
  return open.length;
}

module.exports = { QUIET_MS, MAX_RUN_MS, RECHECK_MS, tracked, openRun, runIdFor, touch, outcome, check, recoverOpen };
