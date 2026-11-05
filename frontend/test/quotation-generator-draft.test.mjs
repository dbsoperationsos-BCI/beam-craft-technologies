import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { stashQuotationGeneratorDraft, takeQuotationGeneratorDraft } from "../src/lib/quotationGeneratorDraft.js";

/*
 * The calculator's draft waits in session storage for the Quotations screen, and is taken - read
 * once and removed - so a later visit does not reopen a form already dealt with.
 */
function withSessionStorage(run) {
  const store = new Map();
  globalThis.window = { sessionStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) } };
  try { run(store); } finally { delete globalThis.window; }
}

test("a stashed draft is taken once", () => {
  withSessionStorage((store) => {
    stashQuotationGeneratorDraft({ shoots: [], services: [{ id: "a" }] });
    assert.equal(store.size, 1);
    assert.deepEqual(takeQuotationGeneratorDraft(), { shoots: [], services: [{ id: "a" }] });
    assert.equal(store.size, 0);
    assert.equal(takeQuotationGeneratorDraft(), null);
  });
});

test("nothing, or something unreadable, is nothing", () => {
  withSessionStorage((store) => {
    stashQuotationGeneratorDraft(null);
    assert.equal(store.size, 0);
    store.set("dbs.quotation.generatorDraft", "{not json");
    assert.equal(takeQuotationGeneratorDraft(), null);
    assert.equal(store.size, 0);
  });
  // Outside a browser there is no storage, and no error either.
  assert.equal(takeQuotationGeneratorDraft(), null);
});

test("the calculator hands over and the Quotations screen picks up, and nothing is saved between", () => {
  const crm = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationPage.js"), "utf8");
  const generator = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  assert.match(crm, /"Apply to Quotation"/);
  // The calculator's old write onto the lead is gone. ("Apply to Lead" still exists elsewhere on the
  // CRM page, for a call transcript - a different thing, untouched.)
  assert.doesNotMatch(crm, /saveLeadQuote|applyToLead\(\)|Signed Quotation when the lead is converted/);
  assert.match(crm, /stashQuotationGeneratorDraft\(draft\);\s*onClose\?\.\(\);\s*router\.push\("\/sales\/quotation"\);/);
  // A choice the generator cannot carry stops the handoff with its name, not a silent drop.
  assert.match(crm, /if \(handoff\.skipped\.length\) \{\s*setApplyError\(`Not applied\. \$\{handoff\.skipped\.join\(" "\)\}`\);/);
  assert.match(page, /takeQuotationGeneratorDraft\(\)/);
  assert.match(page, /initialDraft=\{editingQuotation \? null : generatorDraft\}/);
  // The generator opens on the draft as a new quotation: nothing is locked, and only editing locks.
  assert.match(generator, /const initialPayload = initialQuotation\?\.payload \|\| initialDraft \|\| \{\};/);
  assert.match(generator, /const verticalLocked = Boolean\(initialQuotation\);/);
});
