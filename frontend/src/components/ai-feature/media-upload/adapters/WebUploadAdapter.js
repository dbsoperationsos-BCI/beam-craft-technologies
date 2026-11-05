import { AI_MEDIA_COMPRESSION_CONFIG, AI_MEDIA_UPLOAD_CONFIG } from "@/lib/aiMediaUpload/config.mjs";
import { noteAiMediaUploadBatch, uploadOptimizedAiMedia } from "@/services/ai-feature/ai-media-upload.service";

/**
 * The browser's side of the AI media upload engine: files and blobs, a pool of Web Workers for
 * compression, `fetch` for the upload. The engine (lib/aiMediaUpload/uploadEngine.mjs) knows none
 * of this; the desktop app answers the same three calls with native code.
 *
 * Each item carries its event's recipe (`item.compression`, from the event's Media Upload
 * settings: a preview preset and a thumbnail preset); the worker is handed that and answers both
 * derivatives, so two events tuned differently compress as each asks.
 * The pool never grows past `maxCompressionWorkers`; how many run at once for a given event is the
 * engine's per-session limit.
 *
 * `uploadItem` and `noteBatch` let another module reuse the same on-device optimiser with an upload
 * of its own - Photo Selling sends to its galleries. Without them it is the AI Feature's upload.
 */
const aiUpload = async (item, payload) => {
  const response = await uploadOptimizedAiMedia(item.eventId, { payload, thumbnail: item.thumbnail, fileName: item.name, folderId: item.folderId, fingerprint: item.fingerprint, sourceSizeBytes: item.size, relativePath: item.relativePath, optimized: item.optimized, capturedAt: item.capturedAt });
  return { duplicate: Boolean(response?.data?.duplicate), media: response?.data?.media || null };
};

export function createWebUploadAdapter({ uploadConfig = AI_MEDIA_UPLOAD_CONFIG, compressionConfig = AI_MEDIA_COMPRESSION_CONFIG, uploadItem = aiUpload, noteBatch = noteAiMediaUploadBatch } = {}) {
  const workers = [];
  const idle = [];
  const waiting = [];
  const pending = new Map();
  let nextId = 1;

  const supported = () => typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function";

  function spawn() {
    const worker = new Worker(new URL("../workers/compress.worker.js", import.meta.url));
    worker.onmessage = (event) => {
      const { id, ok, ...rest } = event.data || {};
      const job = pending.get(id);
      pending.delete(id);
      release(worker);
      if (!job) return;
      if (ok) job.resolve(rest);
      else { const error = new Error(rest.message || "Compression failed"); error.code = rest.code; error.fingerprint = rest.fingerprint; job.reject(error); }
    };
    worker.onerror = (event) => {
      // A worker that dies takes its job with it: fail that one file, replace the worker.
      for (const [id, job] of pending) { if (job.worker === worker) { pending.delete(id); const error = new Error(event.message || "Compression worker stopped"); error.code = "COMPRESSION_FAILED"; job.reject(error); } }
      const index = workers.indexOf(worker); if (index >= 0) workers.splice(index, 1);
      // A worker that died while idle must leave the idle pool too, or the next job is posted to it and never answered.
      const idleAt = idle.indexOf(worker); if (idleAt >= 0) idle.splice(idleAt, 1);
      try { worker.terminate(); } catch { /* already gone */ }
      drain();
    };
    workers.push(worker);
    return worker;
  }

  function acquire() {
    if (idle.length) return idle.pop();
    if (workers.length < (uploadConfig.maxCompressionWorkers || uploadConfig.compressionConcurrency)) return spawn();
    return null;
  }
  function release(worker) { if (workers.includes(worker)) idle.push(worker); drain(); }
  function drain() {
    while (waiting.length) {
      const worker = acquire();
      if (!worker) return;
      const job = waiting.shift();
      job.worker = worker;
      pending.set(job.id, job);
      worker.postMessage({ id: job.id, file: job.file, config: job.config });
    }
  }

  return {
    async compress(item) {
      if (!item.file) { const error = new Error("File unavailable"); error.code = "FILE_UNAVAILABLE"; throw error; }
      if (!supported()) { const error = new Error("This browser cannot optimize photos. Use Chrome or Edge."); error.code = "COMPRESSION_FAILED"; throw error; }
      if (!item.decodable) {
        // HEIC/TIFF: the browser has no decoder. The server converts them, so the file goes as-is
        // when the policy allows; the fingerprint still comes from the original bytes.
        if (!uploadConfig.uploadOriginalWhenUndecodable) { const error = new Error("Unsupported image"); error.code = "UNDECODABLE"; throw error; }
        const fingerprint = await hashFile(item.file);
        return { passthrough: true, fingerprint, note: "Sent as-is (the server optimizes this format)" };
      }
      const config = item.compression || compressionConfig;
      return new Promise((resolve, reject) => { waiting.push({ id: nextId++, file: item.file, config, resolve, reject, worker: null }); drain(); });
    },
    upload(item, payload) { return uploadItem(item, payload); },
    noteBatch(eventId, uploaded) { return noteBatch ? noteBatch(eventId, uploaded) : undefined; },
    /** Stops every worker; called when the last session is dismissed. */
    dispose() { for (const worker of workers.splice(0)) { try { worker.terminate(); } catch { /* gone */ } } idle.length = 0; },
  };
}

async function hashFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
