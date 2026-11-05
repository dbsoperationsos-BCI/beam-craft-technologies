import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { AUTO_SYNC_DELAY_MS, MAX_KEPT_PREVIEWS, PREVIEW_MESSAGE_TYPES, PREVIEW_STORAGE_PREFIX, acceptedPreviewMessage, newPreviewSession, previewMessage, previewWindowName, quotationPreviewPath, readQuotationPreview, readQuotationPreviewEntry, stashQuotationPreview } from "../src/lib/quotationPreview.mjs";
import { clearEditingDrafts, editingDraftScope, readEditingDraft, stashEditingDraft } from "../src/lib/quotationEditingDraft.mjs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// A stand-in for the browser's session storage.
function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
}

test("the generator's form is handed to the preview tab under a key, and read back intact", () => {
  const storage = memoryStorage();
  const payload = { enquiryId: "E1", additionalNotes: "சுவர்ண தானம்", roundOffDiscount: 100, services: [{ quantity: 2 }] };
  const key = stashQuotationPreview(payload, { storage, key: "abc" });
  assert.equal(key, "abc");
  assert.deepEqual(readQuotationPreview("abc", { storage }), payload);
  assert.equal(quotationPreviewPath("abc"), "/q/preview/abc");
});

test("a preview that is not there - another browser, or long gone - reads as nothing", () => {
  const storage = memoryStorage();
  assert.equal(readQuotationPreview("missing", { storage }), null);
  storage.setItem(`${PREVIEW_STORAGE_PREFIX}broken`, "{not json");
  assert.equal(readQuotationPreview("broken", { storage }), null);
  assert.equal(readQuotationPreview("x", { storage: null }), null);
  assert.equal(stashQuotationPreview({ a: 1 }, { storage: null }), null, "no storage, no key");
  assert.equal(stashQuotationPreview(null, { storage }), null);
});

test("only the newest few previews are kept, and nothing else in storage is touched", () => {
  const storage = memoryStorage();
  storage.setItem("dbs.quotation.generatorDraft", "{}");
  for (let index = 0; index < 6; index += 1) stashQuotationPreview({ index }, { storage, key: `k${index}`, now: 1000 + index });
  const kept = [...storage.map.keys()].filter((key) => key.startsWith(PREVIEW_STORAGE_PREFIX));
  assert.equal(kept.length, MAX_KEPT_PREVIEWS);
  assert.deepEqual(readQuotationPreview("k5", { storage }), { index: 5 }, "the newest is there");
  assert.equal(readQuotationPreview("k0", { storage }), null, "the oldest went");
  assert.ok(storage.map.has("dbs.quotation.generatorDraft"));
});

test("storage that refuses (full, or blocked) gives no key rather than throwing", () => {
  const storage = { ...memoryStorage(), length: 0, key: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(stashQuotationPreview({ a: 1 }, { storage }), null);
});

test("the generator's Preview sits before Generate, sends the save's own payload and saves nothing", () => {
  const panel = read("components/sales/QuotationGeneratorPanel.js");
  const saveDraft = panel.indexOf(">Save Draft</Button>");
  const previewButton = panel.indexOf("onClick={preview}");
  const generate = panel.indexOf('type="submit"');
  assert.ok(saveDraft > 0 && previewButton > saveDraft && generate > previewButton, "Close, Save Draft, Preview, Generate");
  const body = panel.slice(panel.indexOf("  function preview()"), panel.indexOf("  function preview()") + 1600);
  assert.match(body, /const payload = quotationPayload\(\);/, "the very payload a save sends, read once at the press");
  assert.match(body, /blocked the preview tab/, "a blocked tab is said");
  assert.doesNotMatch(body, /onSaveDraft|onSubmit|createSalesQuotation|updateSalesQuotationDraft/, "Preview saves nothing");
  assert.match(panel, /aria-label="Preview"/, "named even when only the eye shows");
});

test("one tab per generator session: opened on the first press, updated in place after, opened again only once closed", () => {
  const panel = read("components/sales/QuotationGeneratorPanel.js");
  const body = panel.slice(panel.indexOf("  function preview()"), panel.indexOf("  function preview()") + 2200);
  assert.match(body, /if \(!previewSession\.current\) previewSession\.current = newPreviewSession\(\);/, "a session of its own, made once");
  assert.match(body, /previewTab\.current && !previewTab\.current\.closed/, "an open tab is reused");
  assert.match(body, /sendToPreview\(payload\);\s*open\.focus\(\);/, "a press updates the open tab and brings it forward");
  assert.match(body, /window\.open\(quotationPreviewPath\(session\), previewWindowName\(session\)\)/, "named for the session, not a global name");
  const send = panel.slice(panel.indexOf("  function sendToPreview("), panel.indexOf("  function sendToPreview(") + 600);
  assert.match(send, /previewSeq\.current \+= 1;/, "every form numbered");
  assert.match(send, /tab\.postMessage\(previewMessage\(PREVIEW_MESSAGE_TYPES\.UPDATE, previewSession\.current, previewSeq\.current, payload\), window\.location\.origin\);/, "to this origin only");
  // The tab's answers are taken only from this session's own tab, and the close is announced.
  assert.match(panel, /acceptedPreviewMessage\(event, \{ session: previewSession\.current, origin, source: previewTab\.current \}\)/);
  assert.match(panel, /window\.addEventListener\("pagehide", tellPreviewClosed\)/);
});

test("the open preview is brought up to date by itself a moment after editing stops - and nothing is saved to do it", () => {
  const panel = read("components/sales/QuotationGeneratorPanel.js");
  const watch = panel.slice(panel.indexOf("  // Every render: has the form changed since it was last sent?"), panel.indexOf("  // Every render: has the form changed since it was last sent?") + 900);
  assert.match(watch, /const payload = quotationPayload\(\);/, "one whole form, as a save reads it");
  assert.match(watch, /if \(text === state\.last\) return;/, "nothing is sent while nothing has changed");
  assert.match(watch, /window\.setTimeout\(\(\) => flushRef\.current\(\), AUTO_SYNC_DELAY_MS\)/, "debounced, not per keystroke");
  assert.match(watch, /if \(state\.timer\) window\.clearTimeout\(state\.timer\);/, "a newer edit restarts the wait");
  assert.equal(AUTO_SYNC_DELAY_MS >= 500 && AUTO_SYNC_DELAY_MS <= 1000, true);
  const flush = panel.slice(panel.indexOf("  function flushAutoSync()"), panel.indexOf("  function flushAutoSync()") + 1100);
  assert.match(flush, /stashEditingDraft\(editingDraftScope, pending\.payload\)/, "auto-saved to this tab");
  assert.match(flush, /setPreviewStatus\(\{ kind: "blocked", message: pending\.problem \}\)/, "a refused discount is said, not previewed");
  assert.doesNotMatch(flush + watch, /onSaveDraft|onSubmit|onGenerate|createSalesQuotation|updateSalesQuotationDraft|createSalesQuotationVersion/, "auto-save never reaches the server");
  // "Up to date" only once the tab has drawn the newest form; an older answer changes nothing.
  assert.match(panel, /if \(message\.seq !== previewSeq\.current\) return;/);
  assert.match(panel, /PREVIEW_MESSAGE_TYPES\.RENDERED\) setPreviewStatus\(\{ kind: "current" \}\)/);
  assert.match(panel, /Preview up to date/);
  assert.match(panel, /Preview not updated/);
  assert.match(panel, /onClick=\{retryPreview\}/);
  // Whatever was waiting is sent before the generator or the page goes.
  assert.match(panel, /function tellPreviewClosed\(\) \{\s*flushRef\.current\(\);/);
});

test("the preview tab reports each form back once the server has drawn it, or failed to", () => {
  const tab = read("components/sales/QuotationPreviewPage.js");
  assert.match(tab, /report\(PREVIEW_MESSAGE_TYPES\.RENDERED, seq\);/);
  assert.match(tab, /report\(PREVIEW_MESSAGE_TYPES\.FAILED, seq, message\);/);
  assert.match(tab, /generator\.postMessage\(previewMessage\(type, session, seq, null, message\), window\.location\.origin\)/, "to its own generator, this origin only");
});

test("a generator's closing message is taken even as its page unloads - and nothing that carries a quotation is", () => {
  const origin = "https://os.example";
  const session = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const opener = {};
  // As a page unloads, its message arrives with no window to come from.
  const closing = { origin, source: null, data: previewMessage(PREVIEW_MESSAGE_TYPES.CLOSED, session, 4) };
  assert.ok(acceptedPreviewMessage(closing, { session, origin, source: opener }));
  assert.equal(acceptedPreviewMessage({ ...closing, data: previewMessage(PREVIEW_MESSAGE_TYPES.UPDATE, session, 5, { amount: 1 }) }, { session, origin, source: opener }), null, "an update must come from the generator itself");
  assert.equal(acceptedPreviewMessage({ ...closing, origin: "https://evil.example" }, { session, origin, source: opener }), null);
  assert.equal(acceptedPreviewMessage({ ...closing, data: previewMessage(PREVIEW_MESSAGE_TYPES.CLOSED, "1b4e28ba-2fa1-11d2-883f-0016d3cca427", 4) }, { session, origin, source: opener }), null, "and only for its own session");
  // RENDERED and FAILED come back from the tab, with a bounded reason.
  const fromTab = (data) => ({ origin, source: opener, data });
  assert.ok(acceptedPreviewMessage(fromTab(previewMessage(PREVIEW_MESSAGE_TYPES.RENDERED, session, 6)), { session, origin, source: opener }));
  assert.equal(acceptedPreviewMessage(fromTab(previewMessage(PREVIEW_MESSAGE_TYPES.FAILED, session, 6, null, "Network down")), { session, origin, source: opener }).message, "Network down");
  assert.equal(acceptedPreviewMessage(fromTab({ ...previewMessage(PREVIEW_MESSAGE_TYPES.FAILED, session, 6), message: 42 }), { session, origin, source: opener }), null);
  assert.equal(previewMessage(PREVIEW_MESSAGE_TYPES.FAILED, session, 6, null, "x".repeat(500)).message.length, 300);
});

test("the editing draft is kept per quotation in this tab, read back intact, and forgotten when done", () => {
  const storage = memoryStorage();
  storage.setItem("dbs.quotation.preview.k", "{}");
  const scope = editingDraftScope({ editingId: "cmv1" });
  assert.equal(scope, "edit:cmv1");
  assert.equal(editingDraftScope({ duplicateId: "src9" }), "duplicate:src9");
  assert.equal(editingDraftScope({}), null, "a brand-new quotation keeps nothing here; it has Save Draft");
  const payload = { discountAmount: 2300, additionalNotes: "தானாக", services: [{ quantity: 2 }] };
  assert.equal(stashEditingDraft(scope, payload, { storage }), true);
  assert.deepEqual(readEditingDraft(scope, { storage }), payload);
  assert.equal(readEditingDraft("edit:other", { storage }), null, "another quotation's edits are not this one's");
  clearEditingDrafts({ storage });
  assert.equal(readEditingDraft(scope, { storage }), null);
  assert.ok(storage.map.has("dbs.quotation.preview.k"), "nothing else in the tab is touched");
  assert.equal(stashEditingDraft(scope, payload, { storage: { setItem: () => { throw new Error("QuotaExceededError"); } } }), false);
});

test("Quotations reopens an edited quotation after a reload, with its edits, and forgets them on close or save", () => {
  const page = read("components/sales/QuotationPage.js");
  assert.match(page, /const EDIT_PARAM = "edit";/);
  assert.match(page, /const edits = readEditingDraft\(editingDraftScope\(\{ editingId: version\.id \}\)\);/);
  assert.match(page, /setEditingQuotation\(edits \? \{ \.\.\.version, payload: edits \} : version\);/);
  assert.match(page, /void openDuplicate\(duplicateId, \{ restore: true \}\);/);
  assert.match(page, /function closeGenerator\(\) \{[\s\S]*?setEditParam\(null\);[\s\S]*?clearEditingDrafts\(\);/);
  assert.match(page, /editingDraftScope=\{editingDraftScope\(\{ editingId: editingQuotation\?\.id, duplicateId: duplicateSource\?\.id \}\)\}/);
});

test("messages are taken only from this origin, the expected window and the tab's own session", () => {
  const source = {};
  const origin = "https://os.example";
  const session = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const good = { origin, source, data: previewMessage(PREVIEW_MESSAGE_TYPES.UPDATE, session, 3, { amount: 1 }) };
  assert.ok(acceptedPreviewMessage(good, { session, origin, source }));
  assert.equal(acceptedPreviewMessage({ ...good, origin: "https://evil.example" }, { session, origin, source }), null, "another origin");
  assert.equal(acceptedPreviewMessage({ ...good, source: {} }, { session, origin, source }), null, "another window");
  assert.equal(acceptedPreviewMessage(good, { session: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", origin, source }), null, "another quotation's session");
  assert.equal(acceptedPreviewMessage({ ...good, data: { ...good.data, channel: "x" } }, { session, origin, source }), null);
  assert.equal(acceptedPreviewMessage({ ...good, data: { ...good.data, type: "delete" } }, { session, origin, source }), null);
  assert.equal(acceptedPreviewMessage({ ...good, data: { ...good.data, seq: "3" } }, { session, origin, source }), null);
  assert.equal(acceptedPreviewMessage({ ...good, data: { ...good.data, payload: undefined } }, { session, origin, source }), null, "an update must carry a quotation");
  assert.equal(acceptedPreviewMessage({ ...good, data: { ...good.data, payload: [1] } }, { session, origin, source }), null);
  assert.ok(acceptedPreviewMessage({ origin, source, data: previewMessage(PREVIEW_MESSAGE_TYPES.READY, session, 0) }, { session, origin, source }));
  assert.equal(acceptedPreviewMessage(good, { session, origin, source: null }), null, "no generator, nothing accepted");
  assert.notEqual(previewWindowName(session), previewWindowName("1b4e28ba-2fa1-11d2-883f-0016d3cca427"));
  assert.match(newPreviewSession(), /^[0-9a-f-]{32,36}$/);
});

test("the tab keeps the newest form it was sent, with its press number and whether its generator closed", () => {
  const storage = memoryStorage();
  stashQuotationPreview({ amount: 100 }, { storage, key: "s", seq: 1 });
  stashQuotationPreview({ amount: 300 }, { storage, key: "s", seq: 2 });
  assert.deepEqual(readQuotationPreviewEntry("s", { storage }), { payload: { amount: 300 }, seq: 2, closed: false }, "the same session's entry is replaced, not pruned");
  stashQuotationPreview({ amount: 300 }, { storage, key: "s", seq: 2, closed: true });
  assert.equal(readQuotationPreviewEntry("s", { storage }).closed, true);
});

test("the preview tab shows only the newest form, keeps it for a reload, and says when it is updating, failed or orphaned", () => {
  const tab = read("components/sales/QuotationPreviewPage.js");
  assert.match(tab, /message\.seq <= latest\.current\.seq\) return;/, "an older form is refused");
  assert.match(tab, /if \(latest\.current\.seq !== seq\) return; \/\/ a newer form has arrived since/, "a late answer for an older form is dropped");
  assert.match(tab, /stashQuotationPreview\(message\.payload, \{ key: session, seq: message\.seq \}\);/, "kept for a reload");
  assert.match(tab, /acceptedPreviewMessage\(event, \{ session, origin, source: window\.opener \}\)/, "only from its own generator");
  assert.match(tab, /PREVIEW_MESSAGE_TYPES\.READY/, "asks for anything newer on load");
  assert.match(tab, /Updating preview…/);
  assert.match(tab, /The last preview is still shown\./);
  assert.match(tab, /Quotation Generator was closed, so this preview will not update again/);
  assert.match(tab, /previewSalesQuotation\(payload\)/);
  assert.match(tab, /<PublicQuotationPage token=\{null\} previewQuotation=\{quotation\} \/>/);
  assert.match(read("services/sales/projects.service.js"), /"\/api\/sales\/quotations\/preview"/);
  assert.match(read("app/q/preview/[key]/page.js"), /robots: \{ index: false, follow: false \}/);
  // The client's page draws whatever it is last handed in preview, not only its first.
  assert.match(read("components/sales/PublicQuotationPage.js"), /const quotation = preview \? previewQuotation : fetchedQuotation;/);
});

test("preview mode drops Download, expiry and the links to pages a preview does not have - and only in preview", () => {
  const page = read("components/sales/PublicQuotationPage.js");
  // The client's app (`#embed=app`) leaves them out too: it shows the quotation inside itself.
  assert.match(page, /\{!printMode && !preview && !embed\.app && quotation\.allowClientDownload === true/);
  assert.match(page, /\{!printMode && !preview && !embed\.app && <FloatingExpiry/);
  assert.match(page, /const termsHref = preview \? undefined :/);
  assert.match(page, /const paymentHref = preview \? undefined :/);
  // A client's link never passes a preview, so it fetches by token as before - with the pass the
  // client's app hands over when it shows the quotation (none on a link opened on its own).
  assert.match(page, /if \(preview\) return undefined;\s*let active = true;\s*setLoading\(true\);\s*getPublicQuotation\(token, embed\.pass\)/);
  assert.match(read("app/q/[token]/page.js"), /<PublicQuotationPage token=\{token\} \/>/);
});

test("Tamil is carried with the sheet, after each design face, for the page and the PDF alike", () => {
  const fonts = read("app/q/quotationFonts.js");
  assert.match(fonts, /Noto_Serif_Tamil\(\{ subsets: \["tamil"\]/);
  assert.match(fonts, /Noto_Sans_Tamil\(\{ subsets: \["tamil"\]/);
  assert.match(fonts, /tamilSerif, tamilSans\]\.map/);
  for (const layout of ["app/q/[token]/layout.js", "app/q/preview/layout.js"]) assert.match(read(layout), /className=\{quotationFontVariables\}/, layout);
  const page = read("components/sales/PublicQuotationPage.js");
  assert.match(page, /\.q-display \{ font-family: var\(--q-font-display\), var\(--q-font-tamil-serif\),/);
  assert.match(page, /\.q-footer \{ font-family: var\(--q-font-footer\), var\(--q-font-tamil-sans\),/);
  assert.match(page, /QUOTATION_BODY_FONT = "var\(--q-font-body\), var\(--q-font-tamil-sans\),/);
  for (const sheet of ["components/sales/PublicQuotationTermsPage.js", "components/sales/PublicQuotationPaymentPage.js", "components/sales/PublicQuotationPage.js"]) {
    assert.match(read(sheet), /fontFamily: QUOTATION_BODY_FONT/, sheet);
  }
});
