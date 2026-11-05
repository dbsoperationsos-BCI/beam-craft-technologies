const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * The analyzer's one network call — fetching a preview from the bucket — is bounded. A read that
 * hangs used to hold an analysis slot until BullMQ's lock stalled the whole job; now it fails
 * this one photo inside the per-photo retry, like any other transient error.
 */
test("a preview fetch carries an abort signal so a hung read fails the photo, not the run", async () => {
  const { loadPreviewBytes, PREVIEW_FETCH_TIMEOUT_MS } = require("../src/modules/image-selection/ai-culling/analysis/analyzer");
  const original = global.fetch;
  let received = null;
  global.fetch = async (_url, options) => { received = options; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
  try {
    const bytes = await loadPreviewBytes({ previewKey: "image-selection/x/preview/a.jpg" });
    assert.equal(bytes.length, 3);
    assert.ok(received?.signal instanceof AbortSignal, "fetch is given an AbortSignal");
    assert.ok(PREVIEW_FETCH_TIMEOUT_MS >= 10000 && PREVIEW_FETCH_TIMEOUT_MS <= 60000, "a bounded, generous timeout");
  } finally { global.fetch = original; }
});
