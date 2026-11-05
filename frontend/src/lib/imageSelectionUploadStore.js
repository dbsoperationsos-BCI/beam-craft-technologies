"use client";

// Module-scope upload engine. It deliberately lives outside the React tree so that
// registration and the progress stream keep running when the user navigates to
// another route (which unmounts the workspace) or when a route is hidden.
//
// Nothing here sends a photo. The studio's masters stay on its own drive or NAS, and what this
// posts is each file's path relative to the folder that was picked — the server joins it onto the
// configured Original Storage Path, reads the master in place to build the thumbnail and preview,
// and uploads only those to R2. The chunked byte upload it replaced is still on the server for
// galleries filled before this existed.
import {
  cancelImageUpload,
  createImageUploadBatch,
  getImageUpload,
  subscribeImageUploadBatch,
  uploadPreparedImage,
} from "@/services/image-selection/image-selection.service";
import { fileIdentity, fileRelativePath, isUploadableImage, resolveImageMimeType } from "@/lib/imageUploadValidation.mjs";
import { buildDerivatives } from "@/lib/imageDerivatives.mjs";
import { QUALITY_PRESETS, readProcessingSettings } from "@/lib/imageSelectionProcessingSettings.mjs";
// How many times a photo is re-sent before it is reported as failed, and how long to wait
// between attempts. Three attempts covers the dropped request or brief server stall that used
// to strand a whole batch on its last photo.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 3000];
/** Worth another attempt: no response at all, a server error, or a chunk-state disagreement. */
function isRetryable(error) {
  if (error?.code === "NETWORK_ERROR") return true;
  const status = Number(error?.status);
  return !status || status === 409 || status >= 500;
}
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const FINISHED_STATUSES = ["COMPLETED", "COMPLETED_WITH_ERRORS"];
const EMPTY_SNAPSHOT = { sessions: [] };

export const uploadSessionKey = (projectId, folderId) => `${projectId}:${folderId || "root"}`;
export const uploadFileKey = (file) => fileIdentity(file);
const storageKey = (projectId, folderId) => `image-selection-upload-resume:${uploadSessionKey(projectId, folderId)}`;

const sessions = new Map();
const inlineClaims = new Map();
const completedBatches = new Set();
const listeners = new Set();
const completionListeners = new Set();
let queue = [];
let activeCount = 0;
let snapshot = EMPTY_SNAPSHOT;
let unloadBound = false;

export function readSavedUpload(projectId, folderId) {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(projectId, folderId)) || "null");
  } catch {
    return null;
  }
}
function writeSavedUpload(projectId, folderId, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(projectId, folderId), JSON.stringify(value));
  } catch {
    /* Storage quota or private mode — resume support is best-effort. */
  }
}
export function clearSavedUpload(projectId, folderId) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(projectId, folderId));
}

function localWorkRemaining(session) {
  if (session.cancelled) return 0;
  let remaining = 0;
  session.runtimes.forEach((runtime) => {
    if (!["done", "cancelled"].includes(runtime.state)) remaining += 1;
  });
  return remaining;
}
function isFinished(session) {
  return Boolean(session.batch) && FINISHED_STATUSES.includes(session.batch.status);
}
function toPublicSession(session) {
  const remaining = localWorkRemaining(session);
  return {
    key: session.key,
    projectId: session.projectId,
    // Which module mounted the dock this upload was started from. The floating dock reads it to
    // hand the reader back to that section rather than to the Projects page.
    uploadsBase: session.uploadsBase || null,
    folderId: session.folderId,
    folderName: session.folderName,
    projectName: session.projectName,
    batchId: session.batchId,
    batch: session.batch,
    paused: session.paused,
    streamError: session.streamError,
    finished: isFinished(session),
    transferring: remaining > 0 && !session.paused,
    pendingLocalFiles: remaining,
    failedLocalFiles: [...session.runtimes.values()].filter((runtime) => runtime.state === "error").length,
    inline: (inlineClaims.get(session.key) || 0) > 0,
  };
}

function onBeforeUnload(event) {
  event.preventDefault();
  // Legacy browsers need returnValue set; the string itself is never shown.
  event.returnValue = "";
  return "";
}
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const busy = Array.from(sessions.values()).some((session) => localWorkRemaining(session) > 0 && !session.paused);
  if (busy && !unloadBound) {
    window.addEventListener("beforeunload", onBeforeUnload);
    unloadBound = true;
  } else if (!busy && unloadBound) {
    window.removeEventListener("beforeunload", onBeforeUnload);
    unloadBound = false;
  }
}

function emit() {
  snapshot = { sessions: Array.from(sessions.values()).map(toPublicSession) };
  syncUnloadGuard();
  listeners.forEach((listener) => listener());
}

export function subscribeUploadStore(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getUploadStoreSnapshot() {
  return snapshot;
}
export function getUploadStoreServerSnapshot() {
  return EMPTY_SNAPSHOT;
}
export function subscribeUploadCompletion(listener) {
  completionListeners.add(listener);
  return () => completionListeners.delete(listener);
}

// An inline progress card claims its session so the floating dock does not render a
// duplicate. Claims release on unmount, which is exactly when the dock should take over.
export function claimInlineSession(key) {
  inlineClaims.set(key, (inlineClaims.get(key) || 0) + 1);
  emit();
  return () => {
    const next = (inlineClaims.get(key) || 1) - 1;
    if (next > 0) inlineClaims.set(key, next);
    else inlineClaims.delete(key);
    emit();
  };
}

// What the API calls take: the project id alone, or the id with the base another module mounted
// the dock under (Album Proofing's pages upload under its own routes).
const uploadScope = (session) => (session.uploadsBase ? { projectId: session.projectId, uploadsBase: session.uploadsBase } : session.projectId);

function persistUploadId(session, runtime) {
  const saved = readSavedUpload(session.projectId, session.folderId);
  if (!saved?.files) return;
  saved.files = saved.files.map((item) => (item.key === runtime.key ? { ...item, uploadId: runtime.uploadId } : item));
  writeSavedUpload(session.projectId, session.folderId, saved);
}

function connect(session) {
  session.unsubscribe?.();
  session.unsubscribe = subscribeImageUploadBatch(
    uploadScope(session),
    session.batchId,
    (event) => {
      if (!event.batch) return;
      // An event arriving proves the stream is alive again, so a previous drop is no longer true.
      // A photo that genuinely failed still has something to report, so its message stands.
      if (![...session.runtimes.values()].some((item) => item.state === "error")) session.streamError = null;
      session.batch = event.batch;
      if (FINISHED_STATUSES.includes(event.batch.status)) {
        clearSavedUpload(session.projectId, session.folderId);
        session.unsubscribe?.();
        session.unsubscribe = null;
        if (!completedBatches.has(session.batchId)) {
          completedBatches.add(session.batchId);
          const detail = { projectId: session.projectId, folderId: session.folderId, batchId: session.batchId };
          completionListeners.forEach((listener) => listener(detail));
        }
      }
      emit();
    },
    (error) => {
      session.streamError = error.message || "Lost the upload progress stream.";
      emit();
    },
  );
}

function createRuntime(session, file, upload) {
  return {
    key: uploadFileKey(file),
    sessionKey: session.key,
    file,
    // `webkitRelativePath` — "Wedding/Day 1/IMG_0001.CR3" — is the only location a browser will
    // give, and it is all the server needs: it joins the trail onto the Original Storage Path.
    // A file dropped on its own has no trail, so its name stands in.
    relativePath: fileRelativePath(file) || file.name,
    uploadId: upload?.id || null,
    chunkSize: upload?.chunkSize || DEFAULT_CHUNK_SIZE,
    nextChunk: upload?.uploadedChunks || 0,
    state: "idle",
    attempts: 0,
    error: null,
    xhr: null,
  };
}
function enqueue(session, runtimes) {
  runtimes.forEach((runtime) => {
    if (["queued", "running", "done"].includes(runtime.state)) return;
    session.runtimes.set(runtime.key, runtime);
    runtime.state = "queued";
    queue.push(runtime);
  });
}

function pump() {
  // Read on every pump rather than held in a constant: the concurrency is derived from this
  // machine's cores and memory, and a quality change made in ⋮ → Project Settings → Processing
  // applies to the very next photo, mid-run included.
  const { concurrency } = readProcessingSettings();
  while (activeCount < concurrency && queue.length) {
    const runtime = queue.shift();
    const session = sessions.get(runtime.sessionKey);
    if (!session || session.cancelled) continue;
    if (session.paused) {
      runtime.state = "paused";
      continue;
    }
    runtime.state = "running";
    activeCount += 1;
    runFile(session, runtime);
  }
}

async function runFile(session, runtime) {
  try {
    if (session.paused || session.cancelled) {
      const aborted = new Error("Upload paused.");
      aborted.code = "ABORTED";
      throw aborted;
    }
    if (!runtime.uploadId) {
      // The photo is decoded and re-encoded here, on this computer, and only the two small
      // derivatives are sent. The original is read and dropped — it is never uploaded, never
      // written anywhere, and never leaves the machine it is sitting on. The preview follows
      // this machine's Processing quality preset.
      const preset = QUALITY_PRESETS[readProcessingSettings().quality];
      const { thumbnail, preview, width, height } = await buildDerivatives(runtime.file, {
        previewLongEdge: preset.previewLongEdge,
        previewMaxBytes: preset.previewTargetKb * 1024,
      });
      const response = await uploadPreparedImage(uploadScope(session), {
        thumbnail,
        preview,
        fileName: runtime.file.name,
        relativePath: runtime.relativePath,
        mimeType: resolveImageMimeType(runtime.file),
        sizeBytes: runtime.file.size,
        width,
        height,
        folderId: session.folderId,
        batchId: session.batchId,
        // A revision is the same spread done again: it must write over the row it corrects rather
        // than be waved through as a duplicate, which silently threw the corrected pixels away.
        replaceExisting: session.replaceExisting === true,
      });
      // A photo already in this project is not a failure: re-picking a folder to add the few new
      // frames in it is an ordinary thing to do, and the rest of the batch carries on. Its id is
      // recorded either way, so a resume after this point can ask the server what became of it
      // instead of sending the photo a third time.
      runtime.uploadId = response.data?.id || null;
      if (runtime.uploadId) {
        session.uploadIds.add(runtime.uploadId);
        persistUploadId(session, runtime);
      }
    }
    runtime.state = "done";
    runtime.error = null;
    // A photo getting through clears a failure reported by an earlier one, as long as no other
    // photo is still sitting in an error state — otherwise the notice would vanish while a
    // genuine failure is unresolved.
    if (![...session.runtimes.values()].some((item) => item.state === "error")) session.streamError = null;
  } catch (error) {
    runtime.xhr = null;
    if (error?.code === "ABORTED" || session.paused || session.cancelled) {
      runtime.state = session.cancelled ? "cancelled" : "paused";
      // The user can hit Resume while this abort is still in flight, in which case
      // resumePausedUpload() has already skipped this runtime — requeue it here.
      if (!session.paused && !session.cancelled) enqueue(session, [runtime]);
    } else if (runtime.attempts < MAX_ATTEMPTS && isRetryable(error)) {
      // A dropped request or a server hiccup used to end the photo for good: it sat in "error"
      // forever, counted as still pending, and the batch could never finish. Transient failures
      // are retried a couple of times, backing off in between, before it is called a failure.
      runtime.attempts += 1;
      runtime.state = "idle";
      runtime.error = error?.message || "Retrying...";
      // A 409 means the server and this browser disagree about which chunks it holds, so the
      // photo restarts from the first chunk rather than resuming into the gap.
      if (error?.status === 409) runtime.nextChunk = 0;
      window.setTimeout(() => {
        const current = sessions.get(runtime.sessionKey);
        if (!current || current.cancelled || current.paused) return;
        enqueue(current, [runtime]);
        emit();
        pump();
      }, RETRY_DELAYS[Math.min(runtime.attempts - 1, RETRY_DELAYS.length - 1)]);
    } else {
      runtime.state = "error";
      runtime.error = error?.message || "Unable to upload a photo.";
      session.streamError = runtime.error;
    }
  } finally {
    activeCount -= 1;
    emit();
    pump();
  }
}

function createSession({ projectId, folderId, folderName, projectName, batchId, uploadsBase, replaceExisting = false }) {
  const key = uploadSessionKey(projectId, folderId);
  const session = {
    key,
    projectId,
    uploadsBase: uploadsBase || null,
    folderId: folderId || null,
    folderName: folderName || "",
    projectName: projectName || "",
    batchId,
    // Every photo of this session is a corrected one: see the call to uploadPreparedImage.
    replaceExisting: replaceExisting === true,
    batch: null,
    paused: false,
    cancelled: false,
    streamError: null,
    runtimes: new Map(),
    uploadIds: new Set(),
    unsubscribe: null,
  };
  sessions.set(key, session);
  return session;
}
function dropSession(session) {
  session.unsubscribe?.();
  session.unsubscribe = null;
  queue = queue.filter((runtime) => runtime.sessionKey !== session.key);
  sessions.delete(session.key);
}

export async function startUpload({ projectId, folderId, folderName, projectName, files, uploadsBase, replaceExisting = false }) {
  // Callers normally pre-validate, but this guard keeps system files and non-photos out of the
  // queue no matter who calls in. Same single-pass rules the picker uses — no second scan.
  const accepted = Array.from(files || []).filter(isUploadableImage);
  if (!accepted.length) return 0;
  const key = uploadSessionKey(projectId, folderId);
  const existing = sessions.get(key);
  if (existing && localWorkRemaining(existing) > 0) {
    throw new Error("An upload is already running for this folder. Wait for it to finish, or cancel it first.");
  }
  if (existing) dropSession(existing);

  const response = await createImageUploadBatch(uploadsBase ? { projectId, uploadsBase } : projectId, { totalFiles: accepted.length, folderId: folderId || null });
  const batchId = response.data.id;
  const session = createSession({ projectId, folderId, folderName, projectName, batchId, uploadsBase, replaceExisting });
  session.batch = response.data;
  writeSavedUpload(projectId, folderId, {
    batchId,
    // Kept with the batch so an upload resumed after a reload is still posted to — and handed
    // back to — the section it was started in.
    uploadsBase: uploadsBase || null,
    folderName: folderName || "",
    projectName: projectName || "",
    totalFiles: accepted.length,
    savedAt: new Date().toISOString(),
    files: accepted.map((file) => ({ key: uploadFileKey(file), uploadId: null })),
  });
  connect(session);
  enqueue(session, accepted.map((file) => createRuntime(session, file)));
  emit();
  pump();
  return accepted.length;
}

export async function resumeUpload({ projectId, folderId, folderName, projectName, files, uploadsBase, replaceExisting = false }) {
  const saved = readSavedUpload(projectId, folderId);
  if (!saved?.files?.length) return { resumed: 0, message: "There is no interrupted upload to resume." };
  const byKey = new Map(Array.from(files || []).map((file) => [uploadFileKey(file), file]));
  const missing = saved.files.filter((item) => !byKey.has(item.key));
  if (missing.length) {
    return {
      resumed: 0,
      message: `That is not the same folder. ${missing.length} photo${missing.length === 1 ? " is" : "s are"} missing from your selection.`,
    };
  }
  const key = uploadSessionKey(projectId, folderId);
  const existing = sessions.get(key);
  if (existing && localWorkRemaining(existing) > 0) {
    return { resumed: 0, message: "This folder is already uploading." };
  }
  if (existing) dropSession(existing);

  const session = createSession({
    projectId,
    folderId,
    folderName: folderName || saved.folderName,
    projectName: projectName || saved.projectName,
    batchId: saved.batchId,
    uploadsBase: uploadsBase || saved.uploadsBase || null,
    replaceExisting,
  });
  connect(session);
  // Ask the server which uploads are already finished so we only re-send unfinished files.
  const work = await Promise.all(
    saved.files.map(async (item) => {
      const file = byKey.get(item.key);
      if (!item.uploadId) return createRuntime(session, file);
      try {
        const upload = (await getImageUpload(uploadScope(session), item.uploadId)).data;
        session.uploadIds.add(item.uploadId);
        // Only READY means finished. A photo sitting in PROCESSING is one whose registration got
        // as far as the row and no further — nothing on the server will ever move it, because the
        // original never left this machine. Treating it as done was what left a batch one photo
        // short with no way to finish it; re-sending it completes the row it already has.
        return upload.status === "READY" ? null : createRuntime(session, file, upload);
      } catch {
        return createRuntime(session, file);
      }
    }),
  );
  const pending = work.filter(Boolean);
  enqueue(session, pending);
  emit();
  pump();
  return {
    resumed: pending.length,
    message: pending.length
      ? `Resuming ${pending.length} unfinished photo${pending.length === 1 ? "" : "s"}.`
      : "Every photo was already uploaded. Finishing up.",
  };
}

export function pauseUpload(key) {
  const session = sessions.get(key);
  if (!session) return;
  session.paused = true;
  queue = queue.filter((runtime) => {
    if (runtime.sessionKey !== key) return true;
    runtime.state = "paused";
    return false;
  });
  session.runtimes.forEach((runtime) => runtime.xhr?.abort());
  emit();
}

export function resumePausedUpload(key) {
  const session = sessions.get(key);
  if (!session || session.cancelled) return;
  session.paused = false;
  session.streamError = null;
  const retryable = Array.from(session.runtimes.values()).filter((runtime) => ["paused", "error", "idle"].includes(runtime.state));
  enqueue(session, retryable);
  emit();
  pump();
}

/**
 * Send the photos that gave up again. Once the automatic attempts are spent a photo sits in
 * "error" and still counts as pending, so without this the batch can never reach the end and the
 * only ways out are Pause-then-Resume, which nobody would guess, or throwing the batch away.
 */
export function retryFailedUploads(key) {
  const session = sessions.get(key);
  if (!session || session.cancelled) return;
  const failed = Array.from(session.runtimes.values()).filter((runtime) => runtime.state === "error");
  if (!failed.length) return;
  failed.forEach((runtime) => {
    runtime.attempts = 0;
    runtime.error = null;
    // The server may hold a partial or stale set of chunks for this photo, so it starts over.
    runtime.nextChunk = 0;
  });
  session.streamError = null;
  enqueue(session, failed);
  emit();
  pump();
}

export async function cancelUpload(key) {
  const session = sessions.get(key);
  if (!session) return;
  session.cancelled = true;
  session.runtimes.forEach((runtime) => runtime.xhr?.abort());
  const abandoned = Array.from(session.runtimes.values())
    .filter((runtime) => runtime.uploadId && runtime.state !== "done")
    .map((runtime) => runtime.uploadId);
  dropSession(session);
  clearSavedUpload(session.projectId, session.folderId);
  emit();
  await Promise.all(abandoned.map((uploadId) => cancelImageUpload(uploadScope(session), uploadId).catch(() => {})));
}

// "Done" — the user acknowledged a finished batch, so remove its card.
export function dismissUpload(key) {
  const session = sessions.get(key);
  if (!session) return;
  dropSession(session);
  clearSavedUpload(session.projectId, session.folderId);
  emit();
}
