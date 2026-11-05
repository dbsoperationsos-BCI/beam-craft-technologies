"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildDerivatives } from "@/lib/imageDerivatives.mjs";
import { derivativeOptionsFor } from "@/lib/visualCurationCompression.mjs";
import { studioCompressionFor } from "@/services/image-selection/compression.service";
import { uploadAlbumPhoto } from "@/services/image-selection/signature-album.service";

// Photos prepared and sent at once. Each is decoded in full in the browser first, so a few at a
// time keeps a folder of hundreds from holding hundreds of decoded frames in memory together.
const PARALLEL = 3;
// A send that fails is tried again, with a pause that grows, before the photo is counted failed.
// Preparing is not retried: a file this browser cannot decode will not decode on a second try.
const SEND_ATTEMPTS = 3;
const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

const emptyCounts = () => ({ total: 0, prepared: 0, sent: 0, failed: 0 });

/**
 * The Signature Album's own upload queue.
 *
 * The same job as Photo Selection's upload - each photo prepared in this browser (the thumbnail and
 * web preview `buildDerivatives` makes to the studio's Signature Album preset pair, Visual Curation
 * Settings → Processing / Compression; the original never leaves the computer) and only those two
 * sent - but into the album's own library, through its own endpoint, never as a project photo. It
 * hands back `session` in the shape `UploadBatchProgress` draws, so the album shows the very panel
 * Photo Selection does: total, uploaded, compressed, failed, queue, time left, Pause, Retry failed,
 * Cancel. Nothing is dropped silently: a photo that fails stays in the failed count with its reason
 * until it is retried or the batch is dismissed.
 *
 * Held by the album workspace rather than the upload area, so moving between Album and Design does
 * not lose the batch; the page asks before closing while photos are still being sent.
 */
export default function useAlbumUploadQueue(albumId, { onUploaded } = {}) {
  const [session, setSession] = useState(null);
  const queue = useRef([]);
  const failed = useRef([]);
  const counts = useRef(emptyCounts());
  const running = useRef(0);
  const paused = useRef(false);
  const startedAt = useRef(0);
  const lastError = useRef("");
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => { onUploadedRef.current = onUploaded; });
  // The studio's Signature Album preset pair, asked for once per batch and awaited by every photo
  // of it; the service caches the answer and falls back to the recommended pair, so a batch never
  // waits long on it and never fails for want of it.
  const recipe = useRef(null);

  // The counters live in refs, read by the workers; this copies them into what the panel draws.
  const publish = useCallback(() => {
    const { total, prepared, sent, failed: failedCount } = counts.current;
    const done = sent + failedCount;
    const finished = total > 0 && done === total && running.current === 0;
    const elapsed = (Date.now() - startedAt.current) / 1000;
    const remaining = total - done;
    const rate = sent > 0 ? elapsed / sent : null;
    setSession({
      paused: paused.current,
      finished,
      pendingLocalFiles: queue.current.length + running.current,
      failedLocalFiles: failed.current.length,
      streamError: lastError.current,
      batch: {
        status: finished ? (failedCount ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "UPLOADING",
        overallProgress: total ? Math.round((done / total) * 100) : 0,
        totalFiles: total,
        uploadedFiles: sent,
        compressedFiles: prepared,
        failedFiles: failedCount,
        remainingQueue: remaining,
        etaSeconds: rate && remaining ? Math.round(rate * remaining / PARALLEL) : null,
      },
    });
  }, []);

  const send = useCallback(async (file) => {
    const options = await recipe.current;
    const prepared = await buildDerivatives(file, options || derivativeOptionsFor("signatureAlbum"));
    counts.current.prepared += 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await uploadAlbumPhoto(albumId, { ...prepared, fileName: file.name, mimeType: file.type || "image/jpeg", sizeBytes: file.size });
      } catch (error) {
        // A refusal the server gave a reason for (4xx) will not change on a second try.
        if (attempt >= SEND_ATTEMPTS || (error?.status >= 400 && error?.status < 500)) throw error;
        await wait(1000 * attempt);
      }
    }
  }, [albumId]);

  const work = useCallback(async () => {
    running.current += 1;
    try {
      while (!paused.current && queue.current.length) {
        const file = queue.current.shift();
        publish();
        try {
          await send(file);
          counts.current.sent += 1;
          onUploadedRef.current?.();
        } catch (error) {
          counts.current.failed += 1;
          failed.current.push(file);
          lastError.current = `${file.name}: ${error?.message || "could not be uploaded."}`;
        }
        publish();
      }
    } finally {
      running.current -= 1;
      publish();
    }
  }, [publish, send]);

  const start = useCallback(() => {
    for (let slot = running.current; slot < PARALLEL && queue.current.length; slot += 1) void work();
  }, [work]);

  const addFiles = useCallback((files) => {
    if (!files.length) return 0;
    const idle = !session || session.finished;
    if (idle) { counts.current = emptyCounts(); failed.current = []; lastError.current = ""; startedAt.current = Date.now(); }
    if (idle || !recipe.current) recipe.current = studioCompressionFor("signatureAlbum").then((presets) => derivativeOptionsFor("signatureAlbum", presets)).catch(() => derivativeOptionsFor("signatureAlbum"));
    queue.current.push(...files);
    counts.current.total += files.length;
    paused.current = false;
    publish();
    start();
    return files.length;
  }, [publish, session, start]);

  const pause = useCallback(() => { paused.current = true; publish(); }, [publish]);
  const resume = useCallback(() => { paused.current = false; publish(); start(); }, [publish, start]);
  const retryFailed = useCallback(() => {
    const again = failed.current;
    failed.current = [];
    counts.current.failed -= again.length;
    lastError.current = "";
    queue.current.push(...again);
    paused.current = false;
    publish();
    start();
  }, [publish, start]);
  // What is still waiting is dropped; photos already sent stay in the album.
  const cancel = useCallback(() => {
    counts.current.total -= queue.current.length;
    queue.current = [];
    paused.current = false;
    publish();
  }, [publish]);
  const dismiss = useCallback(() => { if (!queue.current.length && !running.current) setSession(null); }, []);

  // Leaving the tab drops what has not been sent, as the leave prompt says: without this the workers
  // kept emptying the queue out of sight, and the page no longer asked before closing. The photo
  // already on its way finishes; nothing after it starts.
  useEffect(() => () => { paused.current = true; queue.current = []; }, []);

  // Closing the page drops whatever has not been sent yet, so the browser is asked to confirm.
  const sending = Boolean(session && session.pendingLocalFiles > 0);
  useEffect(() => {
    if (!sending) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);

  return { session, addFiles, pause, resume, retryFailed, cancel, dismiss, sending };
}
