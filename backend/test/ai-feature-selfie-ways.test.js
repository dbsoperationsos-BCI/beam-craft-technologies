const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, mergeGroup, snapshotForEvent } = require("../src/modules/ai-feature/shared/settingsDefaults");
const { defaultsBodySchema, eventSettingsBodySchema } = require("../src/modules/ai-feature/default-settings/validation");

test("an event stored before the two selfie ways existed keeps both buttons", () => {
  const merged = mergeGroup("guestAccess", { enableSelfie: true, enableGuestUploads: true });
  assert.equal(merged.allowTakeSelfie, true);
  assert.equal(merged.allowUploadSelfie, true);
  assert.equal(merged.enableGuestUploads, true, "guest uploads is a different setting and is not touched");
  assert.equal(DEFAULTS.guestAccess.allowTakeSelfie, true);
  assert.equal(DEFAULTS.guestAccess.allowUploadSelfie, true);
});

test("a new event copies the studio's answer for each way and keeps it when the defaults move on", () => {
  const snapshot = snapshotForEvent({ guestAccess: { allowTakeSelfie: true, allowUploadSelfie: false } });
  assert.equal(snapshot.guestAccess.allowTakeSelfie, true);
  assert.equal(snapshot.guestAccess.allowUploadSelfie, false);
  const later = snapshotForEvent({ guestAccess: { allowTakeSelfie: true, allowUploadSelfie: true } });
  assert.equal(later.guestAccess.allowUploadSelfie, true, "only an event created after the change sees it");
});

test("both ways may not be off while the guest selfie is on", () => {
  const refused = defaultsBodySchema.safeParse({ guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false } });
  assert.equal(refused.success, false);
  assert.match(refused.error.issues[0].message, /at least one selfie option/);
  assert.deepEqual(refused.error.issues[0].path, ["guestAccess", "allowTakeSelfie"]);
  assert.equal(eventSettingsBodySchema.safeParse({ guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false } }).success, false, "an event's own settings follow the same rule");
  assert.equal(defaultsBodySchema.safeParse({ guestAccess: { enableSelfie: false, allowTakeSelfie: false, allowUploadSelfie: false } }).success, true, "with the selfie off the ways are inert and may both be off");
  assert.equal(defaultsBodySchema.safeParse({ guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: true } }).success, true);
  assert.equal(defaultsBodySchema.safeParse({ guestAccess: { allowUploadSelfie: false } }).success, true, "a patch naming one way alone is not judged");
});

test("the selfie endpoint refuses only the way the event turned off", () => {
  const { selfieSourceAllowed } = require("../src/modules/ai-feature/public/service");
  const both = { allowTakeSelfie: true, allowUploadSelfie: true };
  assert.equal(selfieSourceAllowed(both, "camera"), true);
  assert.equal(selfieSourceAllowed(both, "upload"), true);
  assert.equal(selfieSourceAllowed(both, undefined), true, "a caller that does not say is let through while a way is open");
  const cameraOnly = { allowTakeSelfie: true, allowUploadSelfie: false };
  assert.equal(selfieSourceAllowed(cameraOnly, "upload"), false);
  assert.equal(selfieSourceAllowed(cameraOnly, "camera"), true);
  assert.equal(selfieSourceAllowed(cameraOnly, undefined), true);
  assert.equal(selfieSourceAllowed({ allowTakeSelfie: false, allowUploadSelfie: false }, undefined), false);
  assert.equal(selfieSourceAllowed({}, "upload"), true, "an event from before the switches allows both");
});
