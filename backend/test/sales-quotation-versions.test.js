const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  quotationIdFor,
  quotationLinkExpiry,
  quotationLinkState,
  QUOTATION_LINK_VALIDITY_DAYS,
} = require("../src/modules/sales/projects/controller");

const DAY_MS = 24 * 60 * 60 * 1000;

test("a version reads as chain and version together", () => {
  assert.equal(quotationIdFor("QUT039", 1), "QUT039-01");
  assert.equal(quotationIdFor("QUT039", 2), "QUT039-02");
  // Past ninety-nine the suffix simply grows rather than wrapping, so the hundredth version of a
  // long negotiation is still a distinct reference.
  assert.equal(quotationIdFor("QUT039", 100), "QUT039-100");
});

test("a fresh link opens for five days", () => {
  const from = new Date("2026-09-03T10:00:00.000Z");
  assert.equal(QUOTATION_LINK_VALIDITY_DAYS, 5);
  assert.equal(quotationLinkExpiry(from).toISOString(), "2026-09-08T10:00:00.000Z");
});

test("a link is open until its expiry and shut afterwards", () => {
  const now = new Date("2026-09-03T10:00:00.000Z");
  assert.equal(quotationLinkState({ linkExpiresAt: new Date(now.getTime() + DAY_MS) }, now).linkActive, true);
  assert.equal(quotationLinkState({ linkExpiresAt: new Date(now.getTime() - 1) }, now).linkActive, false);
  // The boundary itself: a link is not open on the millisecond it expires.
  assert.equal(quotationLinkState({ linkExpiresAt: now }, now).linkActive, false);
});

/*
 * A quotation written before links had a clock has no expiry at all. Reading that as "open
 * forever" would leave a link the studio believes lapsed still handing out a price; reading it as
 * expired costs one click to reopen and is the safe way round.
 */
test("a version with no expiry reads as expired rather than as open forever", () => {
  const state = quotationLinkState({ linkExpiresAt: null });
  assert.equal(state.linkActive, false);
  assert.equal(state.linkExpired, true);
});

test("re-enabling restarts the five days from the moment it is re-enabled", () => {
  const lapsed = new Date("2026-09-01T10:00:00.000Z");
  const renewedAt = new Date("2026-09-10T09:00:00.000Z");
  assert.equal(quotationLinkState({ linkExpiresAt: lapsed }, renewedAt).linkActive, false);
  const reopened = { linkExpiresAt: quotationLinkExpiry(renewedAt) };
  assert.equal(quotationLinkState(reopened, renewedAt).linkActive, true);
  assert.equal(reopened.linkExpiresAt.toISOString(), "2026-09-15T09:00:00.000Z");
});

/*
 * The rule the whole feature rests on: raising a new version does not shorten the links already
 * sent. A client holding v1 keeps reading it until its own five days run out, which is what lets
 * two versions be compared.
 */
test("an older version's link is unaffected by a newer version being raised", () => {
  const sentOn = new Date("2026-09-03T10:00:00.000Z");
  const v1 = { linkExpiresAt: quotationLinkExpiry(sentOn) };
  const twoDaysLater = new Date(sentOn.getTime() + 2 * DAY_MS);
  const v2 = { linkExpiresAt: quotationLinkExpiry(twoDaysLater) };
  assert.equal(quotationLinkState(v1, twoDaysLater).linkActive, true);
  assert.equal(quotationLinkState(v2, twoDaysLater).linkActive, true);
  // Six days in, v1 has lapsed on its own clock and v2 is still open on its.
  const sixDaysLater = new Date(sentOn.getTime() + 6 * DAY_MS);
  assert.equal(quotationLinkState(v1, sixDaysLater).linkActive, false);
  assert.equal(quotationLinkState(v2, sixDaysLater).linkActive, true);
});

/*
 * ── What a chain is ───────────────────────────────────────────────────────────────────────────
 *
 * A chain is one quotation's own edit history. It used to be the enquiry's: a quotation raised for
 * an enquiry that already had one joined it as the next version, so a Corp quotation could become
 * version 2 of a wedding one - two packages the studio was quoting side by side, filed as though
 * one replaced the other, with the register showing only the newer.
 *
 * Asserted against the source rather than through a request, for the same reason the identifier
 * module's counting rule is: the write path mints from the studio's real counter, and a test that
 * exercised it would spend quotation numbers to prove something that is one decision in one line.
 * The failure mode is silence - the wrong chain is a row that quietly does not appear - so the
 * line is worth holding onto.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");

test("a new quotation starts its own chain, whatever the enquiry has already been quoted", () => {
  // The lookup that used to find "the chain already quoting for this enquiry" is gone, not merely
  // unused: while it exists, joining an enquiry's chain is one call away from being reintroduced.
  assert.equal(CONTROLLER.includes("chainForEnquiry"), false, "the create path can still find a chain by enquiry");
  // And the create path mints a number rather than resolving one from anywhere.
  assert.match(CONTROLLER, /async function createQuotation[\s\S]*?insertQuotationVersion\(\s*(?:\/\*[\s\S]*?\*\/\s*)?async \(\) => nextQuotationChainNumber\(parsed\)/);
});

test("a duplicate is a new quotation too, not a version of what the target enquiry had", () => {
  assert.match(CONTROLLER, /async function duplicateQuotation[\s\S]*?async \(\) => nextQuotationChainNumber\(parsed\.data\)/);
});

test("a duplicate onto the quotation's own enquiry is allowed, and is a new quotation like any other", () => {
  /*
   * It was refused while an enquiry could hold only one chain: the copy could only have landed as
   * the next version of its own chain, which is Edit's job. Now that each quotation is its own
   * chain it is a second quotation for that enquiry - the Dum Dum package as the start of the Corp
   * one - and refusing it would be refusing the case the whole change was made for.
   */
  assert.equal(CONTROLLER.includes("already belongs to that enquiry"), false, "duplicating onto its own enquiry is still refused");
});

test("editing is still the one thing that adds to a chain", () => {
  // The source's own chain, carried across unchanged - which is what makes an edit a version of
  // this quotation rather than of whatever else the enquiry holds.
  assert.match(CONTROLLER, /async function createQuotationVersion[\s\S]*?insertQuotationVersion\(async \(\) => source\.quotationNumber/);
});
