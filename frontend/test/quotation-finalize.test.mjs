import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { QUOTATION_FINALIZATION, isFinalizedQuotation, isLinkActive, linkExpiryText, linkStatusLabel } from "../src/components/sales/quotationLinkStatus.js";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "sales", "QuotationPage.js");
const GENERATOR = read("components", "sales", "QuotationGeneratorPanel.js");
const VERSIONS = read("components", "sales", "QuotationVersionsDialog.js");
const SERVICE = read("services", "sales", "projects.service.js");

/*
 * Finalize Quotation and Unfinalize on the Quotation Generator.
 *
 * The backend suite (`sales-quotation-finalize.test.js`) holds the lifecycle itself - no version
 * raised either way, the link never expiring while finalized, the finalized version read-only, a
 * stale screen refused; `sales-quotation-lifecycle.test.js` the one-finalized-version rule. These
 * hold the screen to it.
 */

test("a finalized version's link reads as live with no clock; an unfinalized one has its own again", () => {
  const finalized = { status: "Generated", linkExpiresAt: null, linkNeverExpires: true, finalization: { state: "FINALIZED" } };
  assert.equal(isFinalizedQuotation(finalized), true);
  assert.equal(isLinkActive(finalized), true);
  assert.equal(linkStatusLabel(finalized), "Live (finalized)");
  assert.match(linkExpiryText(finalized), /never expires/);
  const previously = { status: "Generated", linkExpiresAt: new Date(Date.now() - 60000).toISOString(), finalization: { state: "UNFINALIZED", finalizedAt: new Date().toISOString() } };
  assert.equal(isFinalizedQuotation(previously), false, "unfinalized locks nothing");
  assert.equal(linkStatusLabel(previously), "Expired", "and a lapsed clock is not reopened by it");
  assert.equal(linkStatusLabel({ status: "Generated", linkExpiresAt: null }), "Expired", "a link from before links had a clock still reads as expired");
  // Two statuses and no others.
  assert.deepEqual(Object.values(QUOTATION_FINALIZATION), ["FINALIZED", "UNFINALIZED"]);
});

test("the footer reads Close, Preview, Save as new version, then a green Finalize Quotation", () => {
  const footer = GENERATOR.slice(GENERATOR.indexOf("const footer = <>"), GENERATOR.indexOf("</>;", GENERATOR.indexOf("const footer = <>")));
  const at = (text) => footer.indexOf(text);
  assert.ok(at(">Close</Button>") >= 0 && at(">Close</Button>") < at('aria-label="Preview"'));
  assert.ok(at('aria-label="Preview"') < at('"Save as new version"'));
  assert.ok(at('"Save as new version"') < at('aria-label="Finalize Quotation"'));
  // "Finalize" alone on a phone, so the four fit one row at 360px; its name is always the whole.
  assert.match(footer, /<span className="sm:hidden">Finalize<\/span>\s*<span className="hidden sm:inline">Finalize Quotation<\/span>/);
  assert.match(footer, /canFinalize && <Button type="button" variant="success"/);
  // Locked: the save is shown disabled, saying why, and Unfinalize beside it.
  assert.match(footer, /<Button type="submit" variant="primary" busy=\{saving && !savingDraft\} disabled=\{saving \|\| locked\} title=\{locked \? lockedReason : undefined\}/);
  assert.match(footer, /canUnfinalize && <Button type="button"[\s\S]*?>Unfinalize<\/Button>/);
});

test("Finalize is offered on any generated, unfinalized version, and each action is confirmed first", () => {
  assert.match(GENERATOR, /const canFinalize = Boolean\(onFinalize\) && Boolean\(initialQuotation\?\.id\) && !isDraft && !isFinalized;/);
  assert.match(GENERATOR, /const canUnfinalize = Boolean\(onUnfinalize\) && isFinalized;/);
  assert.match(GENERATOR, /open=\{confirmingFinalization === "finalize"\}/);
  assert.match(GENERATOR, /open=\{confirmingFinalization === "unfinalize"\}/);
  // What is on screen goes with the finalize, so the server can refuse unsaved changes.
  assert.match(GENERATOR, /onFinalize\?\.\(quotationPayload\(\)\)/);
  assert.match(GENERATOR, /if \(locked\) return;/, "Enter in a field raises nothing over a finalized quotation");
});

test("the finalized version reads only; the version picker and sharing stay usable", () => {
  // Only the finalized version itself - another version being finalized locks nothing here.
  assert.match(GENERATOR, /const locked = isFinalized;/);
  assert.equal((GENERATOR.match(/<ReadOnlyFieldset canWrite=\{!locked\}/g) || []).length, 3);
  // The editors the section draws its grips and pickers from are withheld, not just disabled.
  assert.match(GENERATOR, /\{\.\.\.\(locked \? \{\} : \{\n\s+onAddShoot:/);
  const picker = GENERATOR.indexOf('ariaLabel="Quotation version to load"');
  const share = GENERATOR.indexOf('label="Share with"');
  const fieldsets = [...GENERATOR.matchAll(/<ReadOnlyFieldset canWrite=\{!locked\}[\s\S]*?<\/ReadOnlyFieldset>/g)].map((m) => [m.index, m.index + m[0].length]);
  for (const [start, end] of fieldsets) {
    assert.ok(!(picker > start && picker < end), "the version picker is outside the lock");
    assert.ok(!(share > start && share < end), "Share with is outside the lock");
  }
});

test("the page wires both actions for a writer only, and patches the open version in place", () => {
  assert.match(SERVICE, /export function finalizeSalesQuotation\(id, payload\)[\s\S]*?\/finalize`/);
  assert.match(SERVICE, /export function unfinalizeSalesQuotation\(id\)[\s\S]*?\/unfinalize`/);
  assert.match(PAGE, /onFinalize=\{canWrite \? \(payload\) => changeFinalization\("finalize", payload\) : undefined\}/);
  assert.match(PAGE, /onUnfinalize=\{canWrite \? \(\) => changeFinalization\("unfinalize"\) : undefined\}/);
  assert.match(PAGE, /setEditingQuotation\(\(current\) => current \? patchChain\(current\) : current\);/);
  // Delete is not offered on a quotation holding a finalized version.
  assert.match(PAGE, /canWrite && !finalizedVersionOf\(quotation\) \? \[\{ label: "Delete"/);
  // The version history and the picker both say each version's state (`quotation-lifecycle`).
  assert.match(VERSIONS, /<StatusBadge tone=\{status\.tone\}>\{status\.label\}<\/StatusBadge>/);
  assert.match(GENERATOR, /\$\{currency\(Number\(version\.amount \|\| 0\)\)\} · \$\{quotationVersionStatus\(version\)\.label\}/);
});
