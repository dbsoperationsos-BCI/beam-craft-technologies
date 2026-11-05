const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { keepsWorkingOriginal } = require("../src/modules/image-selection/processing/service");

// Originals live only in the studio's Original Storage. A browser upload through the old chunked
// route leaves its bytes on this server just long enough to render the thumbnail and preview; a
// registered photo is the studio's master and is never touched.
test("a browser upload's working copy is removed once its derivatives exist, unless the studio asks to keep it", () => {
  assert.equal(keepsWorkingOriginal({ registered: false, env: {} }), false, "the default keeps nothing");
  assert.equal(keepsWorkingOriginal({ registered: false, env: { STORE_ORIGINAL_IMAGES: "" } }), false);
  assert.equal(keepsWorkingOriginal({ registered: false, env: { STORE_ORIGINAL_IMAGES: "false" } }), false);
  assert.equal(keepsWorkingOriginal({ registered: false, env: { STORE_ORIGINAL_IMAGES: "true" } }), true, "only an explicit opt-in keeps it");
  assert.equal(keepsWorkingOriginal({ registered: true, env: {} }), true, "a registered original is the studio's master: never removed");
});

test("processing removes the working copy through that rule, after the photo is ready", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "processing", "service.js"), "utf8");
  assert.match(source, /if \(!keepsWorkingOriginal\(\{ registered, env: process\.env \}\)\) await fs\.rm\(sourcePath, \{ force: true \}\)/);
  assert.ok(source.indexOf("if (!keepsWorkingOriginal(") > source.indexOf("finalized = true;"), "only once the derivatives are stored");
});
