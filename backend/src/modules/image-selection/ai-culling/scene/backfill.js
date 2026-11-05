/**
 * Scene readings for a gallery's photos that no culling run has read.
 *
 * The scene engine runs as Phase 6 of a culling session, and its reading is kept on the photo
 * (`ImageSelectionUploadScene`) - so a project that was culled carries scenes, and one whose photos
 * went straight into Photo Selection carries none, which left the client gallery's Scene filter with
 * nothing to offer. This is the People filter's answer applied to scenes (`faces/service.ensureQueued`):
 * the first time a gallery asks for its scenes, the photos it can show that have no reading at the
 * engine's current version are described in the background, in the engine's own batches, through
 * the **same engine, the same preview loader and the same cache writes** the culling run uses -
 * `scene/engine.js`, `analysis/analyzer.loadPreviewBytes`, `repository.saveSceneCache` /
 * `pruneSceneCache` - so a later culling run finds them already read, and nothing is classified
 * twice. Only the preview is ever opened; the original on the studio's drive is never touched.
 *
 * Never awaited by a request and never an error to the client: `pending` answers whether work is
 * still to come, and the gallery says "organising" and asks again. What keeps a public ask from
 * turning into work on demand:
 *
 *   - One pass per project at a time, and at most `MAX_PASSES` in the process: asked again while
 *     running, or while the process has its hands full, nothing is started and the answer is still
 *     "to come", so the gallery simply asks later.
 *   - A photo that cannot be read - its preview gone from the bucket, or the engine refusing it - is
 *     remembered for `FAILED_COOLDOWN_MS` and neither counted nor fetched again until then, so a
 *     gallery of lost previews does not say "organising" for ever, and does not pull them from
 *     storage on every poll. A pass that fails outright parks the whole project the same way.
 *   - The engine is the worker's (`worker.js` warms it at boot): a request only reads its state,
 *     and starts it at most once per `START_RETRY_MS` when it has gone down. With the culling worker
 *     in another process (`AI_CULLING_EMBEDDED_WORKER=false`) this is off, as the engine is: the
 *     API process does not host a model of its own.
 *   - The pass stops when the project is no longer live.
 *
 * `createSceneBackfill` takes its pieces so the tests can run it with fakes; the module exports the
 * real wiring.
 */
const { MAX_BATCH } = require("./engine");

// A page of photos read from the database at a time; the engine still sees MAX_BATCH per request.
const PAGE = 64;
// How many projects may be read at once in this process: the engine answers one request at a time
// anyway, so more passes only queue previews in memory ahead of the culling runs.
const MAX_PASSES = 2;
// How long a photo that could not be read, or a project whose pass failed, is left alone.
const FAILED_COOLDOWN_MS = 60 * 60 * 1000;
// How long after a failed start a request may try to start the engine again.
const START_RETRY_MS = 10 * 60 * 1000;

// `purpose`: the words the log uses for what the readings are for.
function createSceneBackfill({ prisma, repository, engine, loadBytes, enabled, eligible, failedCooldownMs = FAILED_COOLDOWN_MS, startRetryMs = START_RETRY_MS, maxPasses = MAX_PASSES, now = Date.now, log = console, purpose = "for the Scene filter" }) {
  const running = new Set();
  // projectId -> { until, photos: Map<uploadId, until> }: what is left alone, and until when.
  const parked = new Map();
  let lastStart = 0;

  function parkedPhotos(projectId) {
    const entry = parked.get(projectId);
    if (!entry) return [];
    const at = now();
    for (const [id, until] of entry.photos) if (until <= at) entry.photos.delete(id);
    return [...entry.photos.keys()];
  }
  function park(projectId, ids, until) {
    const entry = parked.get(projectId) || { until: 0, photos: new Map() };
    for (const id of ids) entry.photos.set(id, until);
    parked.set(projectId, entry);
  }
  const projectParked = (projectId) => (parked.get(projectId)?.until || 0) > now();

  // The photos the gallery can show, without a reading at this engine version and not parked, in id order.
  const unreadWhere = (projectId, version) => {
    const skip = parkedPhotos(projectId);
    return { projectId, status: "READY", ...eligible, sceneCache: { none: { engineVersion: version } }, ...(skip.length ? { id: { notIn: skip } } : {}) };
  };
  const unread = (projectId, version, cursor) => {
    const where = unreadWhere(projectId, version);
    if (cursor) where.id = { ...(where.id || {}), gt: cursor };
    return prisma.imageSelectionUpload.findMany({ where, select: { id: true, previewKey: true, processedName: true }, orderBy: { id: "asc" }, take: PAGE });
  };
  const countUnread = (projectId, version) => prisma.imageSelectionUpload.count({ where: unreadWhere(projectId, version) });
  const live = async (projectId) => Boolean(await prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } }));

  // One retry when the shared engine was stopped under another caller (its timeout restarts it) - the run's own rule.
  const describe = async (buffers) => {
    try { return await engine.describeBatch(buffers); } catch (error) {
      if (!/stopped/i.test(error.message || "")) throw error;
      return engine.describeBatch(buffers);
    }
  };

  /** Describes every unread photo of the project; answers how many were read and how many failed. */
  async function describeProject(projectId, version) {
    let cursor; let described = 0; let failed = 0;
    for (;;) {
      if (!(await live(projectId))) break;
      const page = await unread(projectId, version, cursor);
      if (!page.length) break;
      cursor = page[page.length - 1].id;
      for (let index = 0; index < page.length; index += MAX_BATCH) {
        const slice = page.slice(index, index + MAX_BATCH);
        const bad = [];
        const loaded = (await Promise.all(slice.map(async (upload) => {
          try { return { upload, bytes: await loadBytes(upload) }; } catch { bad.push(upload.id); return null; }
        }))).filter(Boolean);
        if (loaded.length) {
          const answers = await describe(loaded.map((entry) => entry.bytes));
          const fresh = [];
          loaded.forEach((entry, position) => {
            const answer = answers[position];
            if (!answer || answer.error) { bad.push(entry.upload.id); return; }
            fresh.push({ uploadId: entry.upload.id, engineVersion: version, sceneLabel: answer.scene, sceneConfidence: answer.confidence, accidental: Boolean(answer.accidental), aestheticRaw: answer.aesthetic, embedding: answer.embedding || null });
          });
          if (fresh.length) {
            await repository.saveSceneCache(fresh);
            await repository.pruneSceneCache(fresh.map((row) => row.uploadId), version);
            described += fresh.length;
          }
        }
        // A photo that could not be read is left alone for a while: the cursor is already past it,
        // and parking it keeps the next ask from counting or fetching it again straight away.
        if (bad.length) { park(projectId, bad, now() + failedCooldownMs); failed += bad.length; }
      }
      if (page.length < PAGE) break;
    }
    return { described, failed };
  }

  /**
   * Whether the project still has photos to read - and, when it does and nothing is already
   * reading them, starts that in the background. `false` with the engine off, parked after a
   * failure, or unable to start, so a gallery never says "organising" about work that will not come.
   */
  async function pending(projectId) {
    if (!enabled()) return false;
    if (projectParked(projectId)) return false;
    let status = engine.health().status;
    if (status === "offline" && now() - lastStart >= startRetryMs) {
      // Down since the worker warmed it: one start per cooldown, never waited for here.
      lastStart = now();
      Promise.resolve(engine.isReady()).catch(() => {});
      status = engine.health().status;
    }
    if (status === "starting") return true;
    if (status !== "ready") return false;
    const version = engine.version();
    if (!version) return false;
    const count = await countUnread(projectId, version);
    if (!count) return false;
    if (!running.has(projectId) && running.size < maxPasses) {
      running.add(projectId);
      describeProject(projectId, version)
        .then(({ described, failed }) => log.log(`[image-selection scenes] read ${described} photo${described === 1 ? "" : "s"} of project ${projectId} ${purpose}${failed ? ` (${failed} could not be read; tried again in ${Math.round(failedCooldownMs / 60000)} min)` : ""}`))
        .catch((error) => {
          // The pass itself failed (the engine down for good, storage unreachable): the project
          // is left alone for the cooldown rather than restarted by the next poll.
          park(projectId, [], 0);
          parked.get(projectId).until = now() + failedCooldownMs;
          log.warn(`[image-selection scenes] could not read project ${projectId}: ${error.message}`);
        })
        .finally(() => running.delete(projectId));
    }
    return true;
  }

  return { pending, describeProject, countUnread, isRunning: (projectId) => running.has(projectId), parkedPhotos };
}

const engineModule = require("./engine");
const realDeps = {
  prisma: require("../../../../config/db"),
  repository: require("../repository"),
  engine: engineModule.sceneEngine,
  loadBytes: (upload) => require("../analysis/analyzer").loadPreviewBytes(upload),
  // The engine lives with the culling worker; in this process only when that worker rides here.
  enabled: () => engineModule.sceneEnabled(process.env) && process.env.AI_CULLING_EMBEDDED_WORKER !== "false",
};
const real = createSceneBackfill({ ...realDeps, eligible: require("../../gallery/repository").cullEligible });
// The import's own reader: photos held for AI Culling are described as they land, while the rest
// of the shoot is still uploading, so the run's scene stage finds every reading already in the
// cache (it is cache-first) and the wait after the last photo is the grouping and ranking alone.
// Same engine, same batches, same cache writes; asked by the service each time photos land for a
// run that began with an import (`uploadsLanded`), never awaited by the upload.
const heldForCulling = createSceneBackfill({ ...realDeps, eligible: { cullingHoldAt: { not: null } }, purpose: "ahead of their culling run" });

module.exports = { ...real, heldForCulling, createSceneBackfill, PAGE, MAX_PASSES, FAILED_COOLDOWN_MS, START_RETRY_MS };
