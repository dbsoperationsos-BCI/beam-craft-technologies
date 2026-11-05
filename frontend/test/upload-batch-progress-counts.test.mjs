import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

/*
 * The upload progress panel's Failed and Queue figures. The server's batch only knows the photos
 * that reached it; a photo this browser could not send - a refused derivative, a dropped request -
 * is a failure the batch never hears of, and a photo still waiting to be sent is queue the batch
 * cannot see. The Photo Selection store folds both into the batch it publishes, so the figures and
 * the "Retry N failed" button never disagree. The panel itself stays a plain reader of the batch:
 * the Signature Album's queue builds its batch from those same local counters and must not be
 * summed a second time.
 */
test("the Photo Selection store folds the browser's own failures and pending photos into the batch", () => {
  const store = read("lib", "imageSelectionUploadStore.js");
  assert.match(store, /batch: batchWithLocalCounts\(session\.batch, remaining, failedLocal\)/, "the published batch carries the local counts");
  assert.match(store, /failedFiles: \(batch\.failedFiles \|\| 0\) \+ failed, remainingQueue: \(batch\.remainingQueue \|\| 0\) \+ pending/, "Failed adds the browser's failures, Queue the photos still waiting");
  const panel = read("components", "image-selection", "UploadBatchProgress.js");
  assert.match(panel, /\{batch\.failedFiles\}/, "the panel reads the batch as published");
  assert.match(panel, /\{batch\.remainingQueue\}/);
  assert.doesNotMatch(panel, /batch\.failedFiles \+ session\.failedLocalFiles/, "never summed again in the panel, where the album queue would double-count");
});
