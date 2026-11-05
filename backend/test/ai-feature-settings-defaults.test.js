const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, EVENT_GROUPS, mergeGroup, resolveAll, snapshotForEvent } = require("../src/modules/ai-feature/shared/settingsDefaults");

test("a null group answers the code's defaults", () => {
  assert.deepEqual(mergeGroup("ai", null), DEFAULTS.ai);
  assert.deepEqual(resolveAll(null).gallery, DEFAULTS.gallery);
});

test("stored keys win over defaults, unknown keys are dropped", () => {
  const merged = mergeGroup("ai", { similarityHigh: 0.7, bogus: true });
  assert.equal(merged.similarityHigh, 0.7);
  assert.equal(merged.similarityMedium, DEFAULTS.ai.similarityMedium);
  assert.equal("bogus" in merged, false);
});

test("a new event snapshots the studio defaults and layers the wizard's own answers on top", () => {
  const defaultsRow = { ai: { faceRecognition: false }, gallery: { allowDownloads: false } };
  const snapshot = snapshotForEvent(defaultsRow, { ai: { faceRecognition: true }, guestAccess: { enableRsvp: false } });
  assert.deepEqual(Object.keys(snapshot).sort(), [...EVENT_GROUPS].sort());
  assert.equal(snapshot.ai.faceRecognition, true, "the event's own answer wins");
  assert.equal(snapshot.gallery.allowDownloads, false, "the studio default is copied");
  assert.equal(snapshot.guestAccess.enableRsvp, false);
  assert.equal("general" in snapshot, false, "general only shapes new events and is never copied");
});

test("every event group and every key in it is a plain JSON value", () => {
  for (const group of EVENT_GROUPS) assert.doesNotThrow(() => JSON.parse(JSON.stringify(DEFAULTS[group])));
});
