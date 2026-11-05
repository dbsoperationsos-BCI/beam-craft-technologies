import { AI_MEDIA_UPLOAD_CONFIG, FAILED_STATUSES, TERMINAL_STATUSES, UPLOAD_STATUS as S } from "./config.mjs";
import { describeUploadError } from "./errors.mjs";

/**
 * The AI media upload engine: one session per event, two bounded queues (compression, upload),
 * every state a row can be in, and pause / resume / retry / cancel - with nothing platform-specific
 * inside. The platform arrives as an `adapter`:
 *
 *   adapter.compress(item)  → { blob, thumbnail, width, height, fingerprint, outputBytes, capturedAt } (the preview and the thumbnail, both cut from one decode of the photo, to item.compression)
 *                            | { passthrough: true, fingerprint, note }                (send as-is; the server converts - a format the browser cannot decode, never a failed compression)
 *                            throws { code: "UNDECODABLE" | "COMPRESSION_FAILED" | "FILE_UNAVAILABLE", message }
 *   adapter.upload(item, payload) → { duplicate: boolean, media }                    (the server's answer)
 *   adapter.noteBatch(eventId, uploaded)                                              (one activity row, best effort)
 *
 * The web adapter compresses in Web Workers; a desktop would hand the same interface to native
 * code. The engine is plain JavaScript so it is unit-tested with fakes and survives any dialog
 * closing: React only reads snapshots.
 *
 * Memory rule: an item holds its File until compressed, then only the optimized blobs until
 * uploaded, then nothing. Compression never runs more than `readyBuffer` files ahead of upload.
 *
 * Folder-first: a session belongs to one event and every file it takes names the folder it goes
 * into (`meta.folderId`); `addFiles` refuses a batch with none, in the server's own words. The
 * session also carries the event's compression recipe and concurrency limits (`meta.compression`,
 * `meta.limits`, from its Media Upload settings), so two events tuned differently upload as each
 * asks; without them the engine's config stands.
 */
export const FOLDER_REQUIRED = "Select or create a folder before uploading media.";

export function createUploadEngine({ adapter, config = AI_MEDIA_UPLOAD_CONFIG, onEvent = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), now = () => Date.now() } = {}) {
  const sessions = new Map();
  const listeners = new Set();
  let nextId = 1;
  let snapshot = { sessions: [] };
  let publishTimer = null;

  function emit() {
    if (publishTimer) return;
    publishTimer = schedule(() => { publishTimer = null; snapshot = { sessions: Array.from(sessions.values()).map(publicSession) }; listeners.forEach((listener) => listener()); }, 100);
  }

  function publicSession(session) {
    const counts = countsOf(session);
    const finished = session.items.length > 0 && session.items.every((item) => TERMINAL_STATUSES.has(item.status));
    return {
      eventId: session.eventId, eventName: session.eventName, folderId: session.folderId, folderName: session.folderName, href: session.href,
      startedAt: session.startedAt, finishedAt: finished ? session.finishedAt : null, paused: session.paused, pausedReason: session.pausedReason, cancelled: session.cancelled,
      total: session.items.length, counts, percent: session.items.length ? Math.round(((counts.completed + counts.failed + counts.cancelled + counts.skipped) / session.items.length) * 100) : 0,
      sourceBytes: session.sourceBytes, optimizedBytes: session.optimizedBytes, uploaded: session.uploaded, finished, running: !finished && !session.paused,
      items: session.items.map((item) => ({ id: item.id, name: item.name, relativePath: item.relativePath, size: item.size, kind: item.kind, status: item.status, error: item.error, outputBytes: item.outputBytes, note: item.note, attempts: item.attempts, mediaId: item.mediaId })),
    };
  }

  function countsOf(session) {
    const counts = { preparing: 0, compressing: 0, ready: 0, uploading: 0, completed: 0, duplicates: 0, failed: 0, cancelled: 0, skipped: 0 };
    for (const item of session.items) {
      if (item.status === S.SELECTED || item.status === S.QUEUED) counts.preparing += 1;
      else if (item.status === S.COMPRESSING) counts.compressing += 1;
      else if (item.status === S.READY) counts.ready += 1;
      else if (item.status === S.UPLOADING || item.status === S.UPLOADED || item.status === S.FACE_PROCESSING_QUEUED) counts.uploading += 1;
      else if (item.status === S.COMPLETE) counts.completed += 1;
      else if (item.status === S.DUPLICATE) { counts.completed += 1; counts.duplicates += 1; }
      else if (FAILED_STATUSES.has(item.status)) counts.failed += 1;
      else if (item.status === S.CANCELLED) counts.cancelled += 1;
      else if (item.status === S.SKIPPED) counts.skipped += 1;
    }
    return counts;
  }

  function sessionFor(eventId, meta = {}) {
    let session = sessions.get(eventId);
    if (!session) {
      session = { eventId, eventName: meta.eventName || "", folderId: meta.folderId || null, folderName: meta.folderName || "", href: meta.href || "", compression: meta.compression || null, limits: meta.limits || null, items: [], paused: false, pausedReason: "", cancelled: false, startedAt: now(), finishedAt: null, sourceBytes: 0, optimizedBytes: 0, uploaded: 0, activeCompress: 0, activeUpload: 0, landedSinceRefresh: 0, refreshTimer: null, networkStrikes: 0 };
      sessions.set(eventId, session);
    } else {
      if (meta.folderId !== undefined) session.folderId = meta.folderId;
      if (meta.folderName !== undefined) session.folderName = meta.folderName;
      if (meta.eventName) session.eventName = meta.eventName;
      if (meta.href) session.href = meta.href;
      if (meta.compression) session.compression = meta.compression;
      if (meta.limits) session.limits = meta.limits;
      // Adding to a finished session starts a new run of it.
      session.cancelled = false; session.finishedAt = null;
    }
    return session;
  }

  /**
   * Adds entries (see selectFiles.toUploadEntries) to the event's session and starts the queues.
   * Throws `FOLDER_REQUIRED` when neither the batch nor the session names a folder: nothing is
   * added, so no file can ever be sent without one.
   */
  function addFiles(eventId, entries, meta = {}) {
    const folderId = meta.folderId ?? sessions.get(eventId)?.folderId ?? null;
    if (!folderId) throw new Error(FOLDER_REQUIRED);
    const session = sessionFor(eventId, { ...meta, folderId });
    for (const entry of entries) {
      const item = { id: nextId++, eventId: session.eventId, name: entry.name, relativePath: entry.relativePath || entry.name, size: entry.size || 0, kind: entry.kind, decodable: entry.decodable !== false, file: entry.file, payload: null, thumbnail: null, optimized: false, fingerprint: null, width: 0, height: 0, outputBytes: 0, capturedAt: null, compression: session.compression, status: S.SELECTED, error: "", note: "", attempts: 0, notBefore: 0, mediaId: null, folderId };
      // Photos only: a video is listed, so the count matches what was dropped, and never sent.
      if (entry.kind === "unsupported") { item.status = S.SKIPPED; item.error = "Not a photo"; item.file = null; }
      else if (entry.kind === "video") { item.status = S.SKIPPED; item.error = "Videos are not uploaded - photos only"; item.file = null; }
      else { item.status = S.QUEUED; session.sourceBytes += item.size; }
      session.items.push(item);
    }
    pump(session);
    emit();
    return session.items.length;
  }

  /** The session's own limits where its event set them, the engine's config where not. */
  const limitsOf = (session) => ({
    compressionConcurrency: session.limits?.compressionConcurrency || config.compressionConcurrency,
    uploadConcurrency: session.limits?.uploadConcurrency || config.uploadConcurrency,
  });

  function pump(session) {
    if (session.paused || session.cancelled) { settle(session); return; }
    const counts = countsOf(session);
    const limits = limitsOf(session);
    // Compression: bounded by the pool and by how many optimized files already wait to be sent.
    while (session.activeCompress < limits.compressionConcurrency && counts.ready + session.activeCompress < config.readyBuffer) {
      const next = session.items.find((item) => item.status === S.QUEUED);
      if (!next) break;
      startCompress(session, next);
    }
    // Upload: bounded by its own pool, in the order files were picked. A file waiting out its
    // retry delay is passed over until it is due; the timer set with the delay brings it back.
    const at = now();
    while (session.activeUpload < limits.uploadConcurrency) {
      const next = session.items.find((item) => item.status === S.READY && !(item.notBefore > at));
      if (!next) break;
      startUpload(session, next);
    }
    settle(session);
  }

  function settle(session) {
    const allDone = session.items.length > 0 && session.items.every((item) => TERMINAL_STATUSES.has(item.status));
    if (allDone && !session.finishedAt) {
      session.finishedAt = now();
      flushRefresh(session);
      if (session.uploaded > 0) Promise.resolve().then(() => adapter.noteBatch?.(session.eventId, session.uploaded)).catch(() => {});
      onEvent({ type: "finished", eventId: session.eventId, uploaded: session.uploaded, failed: countsOf(session).failed, total: session.items.length });
      session.uploaded = 0;
    }
    emit();
  }

  function startCompress(session, item) {
    item.status = S.COMPRESSING; item.error = "";
    session.activeCompress += 1;
    emit();
    Promise.resolve()
      .then(() => adapter.compress(item))
      .then((result) => {
        if (result?.passthrough) {
          item.payload = item.file; item.optimized = false; item.outputBytes = item.size; item.note = result.note || "Sent as-is";
        } else {
          item.payload = result.blob; item.thumbnail = result.thumbnail || null; item.optimized = true; item.width = result.width || 0; item.height = result.height || 0; item.outputBytes = result.outputBytes ?? result.blob?.size ?? 0;
          item.capturedAt = result.capturedAt || null;
          session.optimizedBytes += item.outputBytes;
        }
        item.fingerprint = result.fingerprint || null;
        item.file = null;
        item.status = S.READY;
      })
      .catch((error) => {
        const described = describeUploadError(error);
        item.status = S.COMPRESSION_FAILED; item.error = described.message; item.fingerprint = error?.fingerprint || item.fingerprint;
      })
      .finally(() => { session.activeCompress -= 1; pump(session); });
  }

  function startUpload(session, item) {
    item.status = S.UPLOADING; item.error = ""; item.attempts += 1; item.notBefore = 0;
    session.activeUpload += 1;
    emit();
    Promise.resolve()
      .then(() => adapter.upload(item, item.payload))
      .then((result) => {
        session.networkStrikes = 0;
        item.mediaId = result?.media?.id || null;
        if (result?.duplicate) { item.status = S.DUPLICATE; item.payload = null; item.thumbnail = null; return; }
        // UPLOADED → FACE_PROCESSING_QUEUED → COMPLETE happen in one answer: the server queues the
        // face pass as it creates the row, so the row's own state is what tells them apart.
        item.status = S.UPLOADED;
        session.uploaded += 1;
        session.landedSinceRefresh += 1;
        item.payload = null; item.thumbnail = null;
        if (result?.media?.aiStatus === "QUEUED") { item.status = S.FACE_PROCESSING_QUEUED; item.note = item.note || "Face recognition queued"; }
        item.status = S.COMPLETE;
        scheduleRefresh(session);
      })
      .catch((error) => {
        const described = describeUploadError(error);
        if (described.network) session.networkStrikes += 1;
        const canRetry = described.retryable && item.attempts < config.maxAttempts;
        if (canRetry && !session.cancelled) {
          const delay = config.retryDelaysMs[Math.min(item.attempts - 1, config.retryDelaysMs.length - 1)] || 0;
          // Back to READY but not due until the delay has passed: `pump` passes it over until then,
          // so a dead network is not hammered, and the other files keep the slots busy meanwhile.
          item.status = S.READY; item.error = `${described.message} · retrying`; item.notBefore = now() + delay;
          // The timer lifts the hold itself: a timer can fire a hair before the clock reaches it,
          // and a photo passed over then with nothing left to reschedule it would wait forever.
          schedule(() => { if (item.status === S.READY) { item.notBefore = 0; pump(session); } }, delay);
        } else {
          item.status = S.UPLOAD_FAILED; item.error = described.message;
        }
        // Three network failures in a row: stop starting new uploads; everything sent stays sent.
        if (session.networkStrikes >= 3 && !session.paused) { session.paused = true; session.pausedReason = "Network interrupted. Resume when you are back online."; session.networkStrikes = 0; }
      })
      .finally(() => { session.activeUpload -= 1; pump(session); });
  }

  function scheduleRefresh(session) {
    if (session.refreshTimer) return;
    session.refreshTimer = schedule(() => { session.refreshTimer = null; flushRefresh(session); }, config.galleryRefreshMs);
  }
  function flushRefresh(session) {
    if (session.refreshTimer) { clearTimeout(session.refreshTimer); session.refreshTimer = null; }
    if (!session.landedSinceRefresh) return;
    const count = session.landedSinceRefresh; session.landedSinceRefresh = 0;
    onEvent({ type: "landed", eventId: session.eventId, count });
  }

  function pause(eventId, reason = "") { const s = sessions.get(eventId); if (!s) return; s.paused = true; s.pausedReason = reason; emit(); }
  function resume(eventId) { const s = sessions.get(eventId); if (!s) return; s.paused = false; s.pausedReason = ""; s.networkStrikes = 0; pump(s); }
  function retryFailed(eventId) {
    const s = sessions.get(eventId); if (!s) return;
    for (const item of s.items) {
      // Only what failed: a cancelled file let go of its bytes on purpose and stays cancelled.
      if (!FAILED_STATUSES.has(item.status)) continue;
      item.error = ""; item.attempts = 0; item.notBefore = 0;
      // A file whose optimized copy is gone is compressed again; one that failed to compress needs its File.
      if (item.payload) item.status = S.READY;
      else if (item.file) item.status = S.QUEUED;
      else { item.status = S.UPLOAD_FAILED; item.error = "File unavailable"; }
    }
    s.cancelled = false; s.paused = false; s.pausedReason = ""; s.finishedAt = null;
    pump(s);
  }
  /** Nothing more starts; what is compressing or uploading finishes and counts. */
  function cancelRemaining(eventId) {
    const s = sessions.get(eventId); if (!s) return;
    s.cancelled = true;
    for (const item of s.items) if (item.status === S.QUEUED || item.status === S.READY || item.status === S.SELECTED) { item.status = S.CANCELLED; item.file = null; item.payload = null; item.thumbnail = null; }
    s.paused = false; s.pausedReason = "";
    settle(s);
  }
  function dismiss(eventId) { const s = sessions.get(eventId); if (!s || !publicSession(s).finished) return; sessions.delete(eventId); emit(); }
  function setFolder(eventId, folderId, folderName) { const s = sessions.get(eventId); if (!s) return; s.folderId = folderId; s.folderName = folderName || ""; for (const item of s.items) if (!TERMINAL_STATUSES.has(item.status) && item.status !== S.UPLOADING) item.folderId = folderId; emit(); }

  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const getSnapshot = () => snapshot;
  const isRunning = () => Array.from(sessions.values()).some((s) => !publicSession(s).finished && !s.paused);
  /** How many sessions exist right now - read synchronously, unlike the snapshot, which is published on a short timer. */
  const sessionCount = () => sessions.size;

  return { addFiles, pause, resume, retryFailed, cancelRemaining, dismiss, setFolder, subscribe, getSnapshot, isRunning, sessionCount, countsOf: (eventId) => (sessions.get(eventId) ? countsOf(sessions.get(eventId)) : null) };
}
