const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A revised upload is the same spread done again.
 *
 * The dock registers a photo once per folder, matched on its path inside that folder, so re-picking
 * a folder to add the few new frames in it does not register everything a second time. That is
 * right for a first import and for a gallery, and exactly wrong for a correction round: the
 * corrected spread has the same name and the same path *because* it is the same spread, so every
 * one of them was answered "already registered" and its pixels dropped. The batch still counted the
 * slot and reported itself complete in a couple of seconds, which is why it looked like a fast
 * upload that changed nothing rather than like a file being thrown away.
 */
const backend = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");
const front = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", ...parts), "utf8");

test("a corrected spread overwrites the row it corrects instead of being dropped as a duplicate", () => {
  const controller = backend("uploads", "derivativeController.js");
  assert.match(controller, /const unfinished = Boolean\(existing\) && \(existing\.status !== "READY" \|\| body\.replaceExisting\);/);
  // Opt-in, so a first import and a gallery keep skipping photos the project already holds.
  assert.match(backend("uploads", "validation.js"), /replaceExisting: z\.coerce\.boolean\(\)\.optional\(\)\.default\(false\)/);
});

test("only the album's revised upload asks for that, and it reaches the request", () => {
  assert.match(front("components", "image-selection", "album-proofing", "AlbumPagesPane.js"), /replaceExisting=\{revisedUploadOpen\}/);
  assert.match(front("components", "image-selection", "UploadManager.js"), /replaceExisting, compressionModule(, destination)?\s*\}\);/);
  assert.match(front("lib", "imageSelectionUploadStore.js"), /replaceExisting: session\.replaceExisting === true,/);
  assert.match(front("services", "image-selection", "image-selection.service.js"), /if \(replaceExisting\) form\.append\("replaceExisting", "true"\);/);
});

test("the album stops waiting on a message the progress stream can lose", () => {
  /*
   * `finished` is the server's word, carried on the progress stream. Fourteen photos the browser
   * has already prepared settle in about two seconds, which that stream can lose the end of — and
   * the album then waited for ever on a message that never came again. The browser's own work is
   * knowable without asking anyone, so it counts too.
   */
  const workspace = front("components", "image-selection", "album-proofing", "AlbumProofWorkspace.js");
  assert.match(workspace, /const revisedUploadLanded = Boolean\(revisedBatch && \(revisedBatch\.finished \|\| postedEverything\)\);/);
  assert.match(workspace, /seenTransferring === revisedBatch\.batchId/);
  assert.match(workspace, /revisedBatch\.pendingLocalFiles === 0/);
  assert.match(workspace, /revisedBatch\.failedLocalFiles === 0/);
});
