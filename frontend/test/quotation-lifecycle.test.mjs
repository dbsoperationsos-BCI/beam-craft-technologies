import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUOTATION_FINALIZATION, isFinalizedQuotation, quotationVersionStatus } from "../src/components/sales/quotationLinkStatus.js";

/*
 * Two statuses on screen, each version on its own: FINALIZED (green, read-only) or UNFINALIZED (grey,
 * editable). At most one version is finalized: while another is, Finalize is shown disabled saying
 * which. Nothing unfinalizes a version by itself. The server holds the same rules
 * (`backend/test/sales-quotation-lifecycle.test.js`).
 */
const GENERATOR = readFileSync(new URL("../src/components/sales/QuotationGeneratorPanel.js", import.meta.url), "utf8");
const VERSIONS = readFileSync(new URL("../src/components/sales/QuotationVersionsDialog.js", import.meta.url), "utf8");
const STATUS = readFileSync(new URL("../src/components/sales/quotationLinkStatus.js", import.meta.url), "utf8");

test("only two statuses exist, read off the version's own finalization", () => {
  assert.deepEqual(Object.values(QUOTATION_FINALIZATION), ["FINALIZED", "UNFINALIZED"]);
  assert.equal(isFinalizedQuotation({ version: 1, finalization: { state: "FINALIZED" } }), true, "an older version can be the finalized one");
  assert.equal(quotationVersionStatus({ version: 4, finalization: { state: "UNFINALIZED" } }).label, "Unfinalized");
  assert.doesNotMatch(STATUS, /SUPERSEDED|PREVIOUSLY_FINALIZED|lifecycle/);
});

test("only the finalized version reads only; any unfinalized version edits", () => {
  assert.match(GENERATOR, /const locked = isFinalized;/);
  assert.match(GENERATOR, /"This version is finalized\. Unfinalize it before editing it or creating a new version from it\."/);
  assert.match(GENERATOR, /disabled=\{saving \|\| locked\} title=\{locked \? lockedReason : undefined\}/);
  assert.match(GENERATOR, /if \(locked\) return;/, "Enter in a field saves nothing either");
  assert.doesNotMatch(GENERATOR, /isSuperseded|lifecycle/);
});

test("Finalize is disabled, saying which, while another version is finalized - and never unfinalizes it", () => {
  assert.match(GENERATOR, /const otherFinalized = versions\.find\(\(version\) => version\.id !== initialQuotation\?\.id && isFinalizedQuotation\(version\)\) \|\| null;/);
  assert.match(GENERATOR, /Another quotation version \(\$\{otherFinalized\.quotationId\}\) is already finalized\. Please unfinalize that version before finalizing this one\./);
  assert.match(GENERATOR, /disabled=\{saving \|\| Boolean\(finalizing\) \|\| Boolean\(otherFinalized\)\}/);
  assert.match(GENERATOR, /title=\{finalizeBlocked \|\| undefined\}/);
});

test("the version history shows each version's status, and View on the finalized one", () => {
  assert.match(VERSIONS, /<StatusBadge tone=\{status\.tone\}>\{status\.label\}<\/StatusBadge>/);
  assert.match(VERSIONS, /Finalized \{raisedOn\.format\(new Date\(finalization\.finalizedAt\)\)\}/);
  assert.match(VERSIONS, /\{finalized \? "View" : "Edit"\}/);
  assert.doesNotMatch(VERSIONS, /Superseded|lifecycle/);
});
