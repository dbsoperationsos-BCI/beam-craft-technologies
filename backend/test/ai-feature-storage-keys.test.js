const test = require("node:test");
const assert = require("node:assert/strict");
const keys = require("../src/modules/ai-feature/shared/storageKeys");

test("every key sits under the AI Feature's own namespace and the event's folder", () => {
  const key = keys.buildKey("evt123", "previews", "jpg");
  assert.match(key, /^ai-feature\/event-evt123\/previews\/[0-9a-f-]{36}\.jpg$/);
  assert.ok(keys.isEventKey(key, "evt123"));
  assert.equal(keys.isEventKey(key, "other"), false);
});

test("no folder the module writes is under the Image Selection or Album Proofing namespaces", () => {
  for (const folder of Object.keys(keys.FOLDERS)) {
    const key = keys.buildKey("e", folder, "bin");
    assert.equal(key.startsWith("image-selection/"), false);
    assert.equal(key.startsWith("album-proofing/"), false);
    assert.ok(key.startsWith("ai-feature/"));
  }
});
