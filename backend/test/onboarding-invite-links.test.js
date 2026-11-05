const test = require("node:test");
const assert = require("node:assert/strict");
const { onboardingLinkCode } = require("../src/modules/hrm/onboarding-invites/controller");
const { SHORT_CODE_PATTERN } = require("../src/services/shortCode");

/*
 * Which identifier a shared onboarding link carries.
 *
 * The rule used to be written out at each place that emailed a link, and when short codes arrived
 * only one of them was updated: the invite mail sent /onboarding/apply/A7K9C2M4 while Send Back
 * went on emailing a 64-character URL to the same candidate about the same form. That is the shape
 * of bug this covers - not that either link works, but that they agree.
 */

const TOKEN = "a".repeat(64);
const CODE = "A7K9C2M4";

test("the short code is what a link carries whenever the invite has one", () => {
  assert.equal(onboardingLinkCode({ shortCode: CODE, token: TOKEN }), CODE);
  // Send Back and the invite mail must reach the same answer for the same invite.
  assert.equal(onboardingLinkCode({ shortCode: CODE, token: TOKEN }, TOKEN), CODE);
});

test("an invite from before short codes falls back to its long token", () => {
  assert.equal(onboardingLinkCode({ shortCode: null, token: TOKEN }), TOKEN);
});

test("an invite with neither has no link, which is what the Send Back guard refuses on", () => {
  assert.equal(onboardingLinkCode({ shortCode: null, token: null }), null);
  assert.equal(onboardingLinkCode({}), null);
  assert.equal(onboardingLinkCode(null), null);
  assert.equal(onboardingLinkCode(undefined), null);
});

/*
 * The token a caller presented wins over the one on the row.
 *
 * Only for an invite with no short code - otherwise the code answers first. It matters because
 * resending is allowed to whoever proves they hold the link: preferring the stored token would let
 * a caller who presented an old identifier be handed the current one.
 */
test("a token the caller proved they hold is preferred over the invite's stored one", () => {
  const held = "b".repeat(64);
  assert.equal(onboardingLinkCode({ shortCode: null, token: TOKEN }, held), held);
  // But never over a short code, which is the better link for the candidate either way.
  assert.equal(onboardingLinkCode({ shortCode: CODE, token: TOKEN }, held), CODE);
});

test("the code a link carries is one the public route can actually classify", () => {
  // A short code has to match the pattern the apply route accepts, or the shortened URL 404s.
  assert.match(onboardingLinkCode({ shortCode: CODE }), SHORT_CODE_PATTERN);
});

test("an empty string is treated as absent rather than emailed as a link to nowhere", () => {
  assert.equal(onboardingLinkCode({ shortCode: "", token: TOKEN }), TOKEN);
  assert.equal(onboardingLinkCode({ shortCode: "", token: "" }), null);
});
