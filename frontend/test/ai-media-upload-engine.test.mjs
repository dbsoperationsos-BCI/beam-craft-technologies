import assert from "node:assert/strict";
import test from "node:test";
import { FOLDER_REQUIRED, createUploadEngine } from "../src/lib/aiMediaUpload/uploadEngine.mjs";
import { AI_MEDIA_UPLOAD_CONFIG, UPLOAD_STATUS as S } from "../src/lib/aiMediaUpload/config.mjs";
import { AI_MEDIA_ACCEPT, toUploadEntries } from "../src/lib/aiMediaUpload/selectFiles.mjs";
import { describeUploadError } from "../src/lib/aiMediaUpload/errors.mjs";

/*
 * The AI media upload engine with a fake platform: every state a row passes through, one failure
 * never stopping the rest, duplicates, retries, pause/resume, cancel, and the memory bound between
 * compression and upload. Timers are a queue we flush by hand so the tests are instant and exact.
 */
function harness({ compress, upload, config = {} } = {}) {
  const timers = [];
  const events = [];
  // The engine's clock: it moves only when a timer fires, to that timer's due time, so a retry
  // delay is observed exactly rather than by waiting.
  let clock = 1000;
  const adapter = {
    compress: compress || (async (item) => ({ blob: { size: 600 }, width: 2048, height: 1365, fingerprint: `fp-${item.name}`, outputBytes: 600 })),
    upload: upload || (async () => ({ duplicate: false, media: { id: "m1", aiStatus: "QUEUED" } })),
    noteBatch: async () => {},
  };
  const engine = createUploadEngine({ adapter, config: { ...AI_MEDIA_UPLOAD_CONFIG, ...config }, onEvent: (event) => events.push(event), schedule: (fn, ms) => { timers.push({ fn, ms, at: clock + ms }); return timers.length; }, now: () => clock });
  // Promises only, no timer fired: the engine as it stands between two ticks of the clock.
  const settle = async () => { for (let i = 0; i < 20; i += 1) { await Promise.resolve(); await new Promise((r) => setImmediate(r)); } };
  const flush = async () => { for (let i = 0; i < 50; i += 1) { await Promise.resolve(); await new Promise((r) => setImmediate(r)); const due = timers.splice(0).sort((a, b) => a.at - b.at); due.forEach((t) => { clock = Math.max(clock, t.at); t.fn(); }); if (!timers.length && due.length === 0) break; } };
  const file = (name, size = 8_500_000) => ({ name, size, type: "image/jpeg" });
  const entries = (names) => toUploadEntries(names.map((name) => file(name)));
  const session = () => engine.getSnapshot().sessions[0];
  // Folder-first: every batch in these tests names the folder it goes into, as the workspace does.
  const add = (names, meta = {}) => engine.addFiles("e1", entries(names), { folderId: "f1", folderName: "Wedding", ...meta });
  return { engine, adapter, timers, events, flush, settle, entries, session, add };
}

test("a photo walks SELECTED → COMPRESSING → READY → UPLOADING → COMPLETE, and the batch reports optimized bytes", async () => {
  const h = harness();
  h.add(["a.jpg", "b.jpg"], { eventName: "Wedding" });
  await h.flush();
  const s = h.session();
  assert.equal(s.total, 2);
  assert.deepEqual(s.items.map((i) => i.status), [S.COMPLETE, S.COMPLETE]);
  assert.equal(s.counts.completed, 2);
  assert.equal(s.percent, 100);
  assert.equal(s.finished, true);
  assert.equal(s.optimizedBytes, 1200);
  assert.equal(s.sourceBytes, 17_000_000);
  assert.ok(h.events.some((e) => e.type === "finished" && e.uploaded === 2));
  assert.ok(h.events.some((e) => e.type === "landed" && e.count === 2), "the gallery is told photos landed");
});

test("one compression failure does not stop the others; its row says why", async () => {
  const h = harness({ compress: async (item) => { if (item.name === "bad.jpg") { const e = new Error("boom"); e.code = "COMPRESSION_FAILED"; throw e; } return { blob: { size: 1 }, fingerprint: "x", outputBytes: 1, width: 1, height: 1 }; } });
  h.add(["ok1.jpg", "bad.jpg", "ok2.jpg"]);
  await h.flush();
  const s = h.session();
  assert.deepEqual(s.items.map((i) => i.status), [S.COMPLETE, S.COMPRESSION_FAILED, S.COMPLETE]);
  assert.equal(s.items[1].error, "Could not be optimized - retry, or try another browser");
  assert.equal(s.counts.failed, 1);
  assert.equal(s.finished, true);
});

test("a server 200 is Already uploaded: counted as complete, not sent again, never a new row", async () => {
  const h = harness({ upload: async (item) => ({ duplicate: item.name === "dup.jpg", media: { id: "m", aiStatus: "QUEUED" } }) });
  h.add(["dup.jpg", "new.jpg"]);
  await h.flush();
  const s = h.session();
  assert.equal(s.items[0].status, S.DUPLICATE);
  assert.equal(s.items[1].status, S.COMPLETE);
  assert.equal(s.counts.completed, 2);
  assert.equal(s.counts.duplicates, 1);
  assert.equal(s.uploaded, 0, "the finished batch reset its uploaded count after reporting");
  assert.ok(h.events.find((e) => e.type === "finished").uploaded === 1, "only the new photo counts as uploaded");
});

test("a retryable upload error is retried up to the limit, then the row fails in plain words; Retry Failed sends it again", async () => {
  let calls = 0;
  const h = harness({ upload: async () => { calls += 1; if (calls <= 3) { const e = new Error("x"); e.status = 503; throw e; } return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; } });
  h.add(["a.jpg"]);
  await h.flush();
  assert.equal(calls, 3);
  assert.equal(h.session().items[0].status, S.UPLOAD_FAILED);
  assert.equal(h.session().items[0].error, "The server could not take it - retry in a moment");
  h.engine.retryFailed("e1");
  await h.flush();
  assert.equal(h.session().items[0].status, S.COMPLETE);
});

test("a retry waits out its delay: the failed photo is not sent again until the timer is due", async () => {
  let calls = 0;
  const h = harness({ upload: async () => { calls += 1; if (calls === 1) { const e = new Error("x"); e.status = 503; throw e; } return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; } });
  h.add(["a.jpg"]);
  await h.settle();
  assert.equal(calls, 1, "one attempt, then a wait - never an immediate second try with free slots");
  assert.equal(h.engine.countsOf("e1").ready, 1, "the photo is back in the ready line, held until it is due");
  assert.ok(h.timers.some((t) => t.ms === AI_MEDIA_UPLOAD_CONFIG.retryDelaysMs[0]), "the first delay is scheduled");
  await h.flush();
  assert.equal(calls, 2, "sent again once the delay has passed");
  assert.equal(h.session().items[0].status, S.COMPLETE);
});

test("Retry failed uploads leaves a cancelled photo cancelled: it let go of its bytes on purpose", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let uploads = 0;
  const h = harness({ upload: async () => { uploads += 1; if (uploads === 1) { await gate; const e = new Error("Files larger than 60 MB are not accepted for this event."); e.status = 413; throw e; } return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; }, config: { uploadConcurrency: 1, compressionConcurrency: 1 } });
  h.add(["a.jpg", "b.jpg", "c.jpg"]);
  await h.flush();
  h.engine.cancelRemaining("e1");
  release();
  await h.flush();
  assert.deepEqual(h.session().items.map((i) => i.status), [S.UPLOAD_FAILED, S.CANCELLED, S.CANCELLED]);
  h.engine.retryFailed("e1");
  await h.flush();
  const s = h.session();
  assert.deepEqual(s.items.map((i) => i.status), [S.COMPLETE, S.CANCELLED, S.CANCELLED], "only the failed photo was sent again");
  assert.equal(s.counts.failed, 0, "a cancelled photo is never recounted as a failure");
  assert.ok(s.items.every((i) => i.error !== "File unavailable"));
});

test("sessionCount answers at once, so the last dismiss can release the workers before the snapshot catches up", async () => {
  const h = harness();
  assert.equal(h.engine.sessionCount(), 0);
  h.add(["a.jpg"]);
  assert.equal(h.engine.sessionCount(), 1);
  await h.flush();
  h.engine.dismiss("e1");
  assert.equal(h.engine.sessionCount(), 0, "counted on the engine, not on the published snapshot");
  assert.equal(h.engine.getSnapshot().sessions.length, 1, "the snapshot still holds the session until its timer fires");
  await h.flush();
  assert.equal(h.engine.getSnapshot().sessions.length, 0);
});

test("a non-retryable answer fails at once", async () => {
  const h = harness({ upload: async () => { const e = new Error("Files larger than 60 MB are not accepted for this event."); e.status = 413; throw e; } });
  h.add(["a.jpg"]);
  await h.flush();
  assert.equal(h.session().items[0].status, S.UPLOAD_FAILED);
  assert.equal(h.session().items[0].error, "Files larger than 60 MB are not accepted for this event.", "the server's own limit is shown");
});

test("pause stops new work, resume continues it, and nothing completed is touched", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let uploads = 0;
  const h = harness({ upload: async () => { uploads += 1; if (uploads === 1) await gate; return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; }, config: { uploadConcurrency: 1, compressionConcurrency: 1 } });
  h.add(["a.jpg", "b.jpg", "c.jpg"]);
  await h.flush();
  h.engine.pause("e1");
  release();
  await h.flush();
  let s = h.session();
  assert.equal(s.paused, true);
  assert.equal(s.items[0].status, S.COMPLETE, "the one in flight finished");
  assert.ok([S.READY, S.QUEUED].includes(s.items[1].status), "the next did not start");
  h.engine.resume("e1");
  await h.flush();
  s = h.session();
  assert.deepEqual(s.items.map((i) => i.status), [S.COMPLETE, S.COMPLETE, S.COMPLETE]);
});

test("cancel remaining drops what has not started, keeps what is in flight, and finishes the batch", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let uploads = 0;
  const h = harness({ upload: async () => { uploads += 1; if (uploads === 1) await gate; return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; }, config: { uploadConcurrency: 1, compressionConcurrency: 1 } });
  h.add(["a.jpg", "b.jpg", "c.jpg"]);
  await h.flush();
  h.engine.cancelRemaining("e1");
  release();
  await h.flush();
  const s = h.session();
  assert.equal(s.items[0].status, S.COMPLETE);
  assert.equal(s.items[2].status, S.CANCELLED);
  assert.equal(s.finished, true);
  assert.equal(s.counts.cancelled >= 1, true);
});

test("compression never runs more than the ready buffer ahead of uploads", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let compressions = 0;
  const h = harness({
    compress: async (item) => { compressions += 1; return { blob: { size: 1 }, fingerprint: item.name, outputBytes: 1, width: 1, height: 1 }; },
    upload: async () => { await gate; return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; },
    config: { readyBuffer: 4, uploadConcurrency: 1, compressionConcurrency: 2 },
  });
  h.add(Array.from({ length: 40 }, (_, i) => `p${i}.jpg`));
  await h.flush();
  assert.ok(compressions <= 4 + 1, `compressed ${compressions} while uploads were blocked`);
  release();
  await h.flush();
  assert.equal(h.session().counts.completed, 40);
});

test("unsupported files and videos are listed as skipped and never sent, folder paths are kept", () => {
  const entries = toUploadEntries([
    { name: "IMG_1.HEIC", size: 5, type: "", webkitRelativePath: "Wedding/Bride/IMG_1.HEIC" },
    { name: "clip.mov", size: 9, type: "video/quicktime" },
    { name: "notes.txt", size: 1, type: "text/plain" },
    { name: ".DS_Store", size: 1, type: "" },
  ]);
  assert.deepEqual(entries.map((e) => [e.kind, e.decodable, e.relativePath]), [["photo", false, "Wedding/Bride/IMG_1.HEIC"], ["video", false, "clip.mov"], ["unsupported", false, "notes.txt"]]);
  const sent = [];
  const h = harness({ compress: async () => ({ passthrough: true, fingerprint: "f", note: "Sent as-is" }), upload: async (item) => { sent.push(item.name); return { duplicate: false, media: { id: "m" } }; } });
  h.engine.addFiles("e1", entries, { folderId: "f1" });
  return h.flush().then(() => {
    const s = h.session();
    assert.equal(s.items[0].status, S.COMPLETE);
    assert.equal(s.items[0].note, "Sent as-is");
    assert.equal(s.items[1].status, S.SKIPPED);
    assert.equal(s.items[1].error, "Videos are not uploaded - photos only");
    assert.equal(s.items[2].status, S.SKIPPED);
    assert.equal(s.counts.skipped, 2);
    assert.deepEqual(sent, ["IMG_1.HEIC"], "the video never left the browser");
    assert.equal(AI_MEDIA_ACCEPT.includes("video"), false);
    assert.equal(AI_MEDIA_ACCEPT.includes(".mov"), false);
  });
});

test("errors are described in the studio's words", () => {
  assert.equal(describeUploadError({ code: "NETWORK_ERROR" }).message, "Network interrupted - check the connection, then retry");
  assert.equal(describeUploadError({ status: 413 }).message, "Too large for this event's file limit");
  assert.equal(describeUploadError({ status: 415 }).message, "Unsupported image");
  assert.equal(describeUploadError({ status: 413 }).retryable, false);
  assert.equal(describeUploadError({ status: 500 }).retryable, true);
});

test("a batch that names no folder is refused in the server's words and nothing is added", () => {
  const h = harness();
  assert.throws(() => h.engine.addFiles("e1", h.entries(["a.jpg"])), { message: FOLDER_REQUIRED });
  assert.throws(() => h.engine.addFiles("e1", h.entries(["a.jpg"]), { folderId: "" }), { message: FOLDER_REQUIRED });
  assert.equal(h.engine.getSnapshot().sessions.length, 0);
  assert.equal(FOLDER_REQUIRED, "Select or create a folder before uploading media.");
});

test("every file carries its folder; a later batch into another folder does not move the first", async () => {
  const seen = [];
  const h = harness({ upload: async (item) => { seen.push([item.name, item.folderId]); return { duplicate: false, media: { id: "m", aiStatus: "QUEUED" } }; } });
  h.add(["a.jpg"], { folderId: "f1", folderName: "Wedding" });
  h.add(["b.jpg"], { folderId: "f2", folderName: "Reception" });
  await h.flush();
  assert.deepEqual(seen.sort(), [["a.jpg", "f1"], ["b.jpg", "f2"]]);
  assert.equal(h.session().folderName, "Reception", "the session reports where the latest batch went");
});

test("compression has no off switch: a recipe from an older event row that says `enabled: false` still compresses", async () => {
  let compressed = 0;
  const h = harness({ compress: async () => { compressed += 1; return { blob: { size: 1 }, fingerprint: "x", outputBytes: 1, width: 1, height: 1 }; }, upload: async () => ({ duplicate: false, media: { id: "m" } }) });
  h.add(["a.jpg"], { compression: { enabled: false } });
  await h.flush();
  assert.equal(compressed, 1);
  assert.equal(h.session().items[0].status, S.COMPLETE);
});

test("the event's own limits bound how many photos compress and upload at once, and its recipe reaches the adapter", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let inFlight = 0; let peak = 0; let recipe = null;
  const h = harness({
    compress: async (item) => { recipe = item.compression; inFlight += 1; peak = Math.max(peak, inFlight); await gate; inFlight -= 1; return { blob: { size: 1 }, fingerprint: item.name, outputBytes: 1, width: 1, height: 1, capturedAt: "2026-09-12T10:15:30.000Z" }; },
    upload: async (item) => ({ duplicate: false, media: { id: item.capturedAt } }),
    config: { compressionConcurrency: 4, uploadConcurrency: 4 },
  });
  h.add(["a.jpg", "b.jpg", "c.jpg", "d.jpg"], { compression: { enabled: true, maxDimension: 2560, quality: 0.8 }, limits: { compressionConcurrency: 1, uploadConcurrency: 1 } });
  await h.flush();
  assert.equal(peak, 1, "the event asked for one at a time, whatever the engine's default");
  assert.deepEqual(recipe, { enabled: true, maxDimension: 2560, quality: 0.8 });
  release();
  await h.flush();
  assert.equal(h.session().counts.completed, 4);
  assert.equal(h.session().items[0].mediaId, "2026-09-12T10:15:30.000Z", "the capture time read off the original travelled with the upload");
});

test("the thumbnail cut beside the preview rides with it to the upload and is dropped once the photo has landed", async () => {
  const seen = [];
  const h = harness({
    compress: async () => ({ blob: { size: 600 }, thumbnail: { size: 40, type: "image/webp" }, width: 2048, height: 1365, fingerprint: "fp", outputBytes: 640 }),
    upload: async (item, payload) => { seen.push({ payload, thumbnail: item.thumbnail, optimized: item.optimized }); return { duplicate: false, media: { id: "m1", aiStatus: "QUEUED" } }; },
  });
  h.add(["a.jpg"]);
  await h.flush();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].thumbnail, { size: 40, type: "image/webp" });
  assert.equal(seen[0].optimized, true);
  assert.equal(h.session().optimizedBytes, 640, "both files count as what was optimized");
  assert.equal(h.session().items[0].status, S.COMPLETE);
});
