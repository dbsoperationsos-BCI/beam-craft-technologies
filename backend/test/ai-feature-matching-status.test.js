const test = require("node:test");
const assert = require("node:assert/strict");
const { statusFor } = require("../src/modules/ai-feature/matches/matching");
const { DEFAULTS } = require("../src/modules/ai-feature/shared/settingsDefaults");

test("a high band matches, a medium band goes to review and a low band is hidden by default", () => {
  assert.equal(statusFor("HIGH", DEFAULTS.ai), "MATCHED");
  assert.equal(statusFor("MEDIUM", DEFAULTS.ai), "REVIEW_REQUIRED");
  assert.equal(statusFor("LOW", DEFAULTS.ai), null);
});

test("the event can change what a medium or low band means", () => {
  assert.equal(statusFor("MEDIUM", { ...DEFAULTS.ai, mediumConfidenceHandling: "AUTO" }), "MATCHED");
  assert.equal(statusFor("MEDIUM", { ...DEFAULTS.ai, mediumConfidenceHandling: "HIDE" }), null);
  assert.equal(statusFor("LOW", { ...DEFAULTS.ai, lowConfidenceHandling: "REVIEW" }), "REVIEW_REQUIRED");
});
