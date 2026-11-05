import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const ALBUM_DIR = ["components", "image-selection", "signature-album"];
const WORKSPACE = read(...ALBUM_DIR, "SignatureAlbumWorkspace.js");
const HOOK = read(...ALBUM_DIR, "useSignatureAlbum.js");
const RAIL = read(...ALBUM_DIR, "SignatureAlbumRightPanel.js");
const DESIGN = read(...ALBUM_DIR, "DesignPanel.js");
const PERMISSIONS = read(...ALBUM_DIR, "ClientPermissions.js");
const UPLOADER = read(...ALBUM_DIR, "AlbumUploader.js");
const CLIENT = read(...ALBUM_DIR, "client", "ClientSignatureAlbum.js");
const PROGRESS = read("components", "image-selection", "UploadBatchProgress.js");
const PROJECT = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");

test("a first load that fails says so with a Retry, instead of a loader that never ends", () => {
  assert.ok(WORKSPACE.indexOf("if (error && !album)") < WORKSPACE.indexOf("if (album === undefined)"), "the failure is drawn before the loader");
  assert.match(WORKSPACE, /onClick=\{\(\) => reload\(\{ reset: true \}\)\}>Retry<\/Button>/);
  assert.match(HOOK, /if \(reset && alive\.current\) \{ setAlbum\(undefined\);[^}]*setError\(""\); \}/, "a retry starts from the loader, not the old error");
});

test("the empty album says what the album is now: its own uploads, not the project's photos", () => {
  assert.doesNotMatch(WORKSPACE, /chapters, highlights|Nothing is copied or moved/);
  assert.match(WORKSPACE, /upload its photos, choose a cover and a theme/);
});

test("an album upload that finished with failures can still retry them; Photo Selection's card is unchanged", () => {
  assert.match(UPLOADER, /onRetryFailed=\{uploads\.retryFailed\}\s+retryAfterFinish/);
  assert.match(PROGRESS, /const failedAtEnd = finished && retryAfterFinish && session\.failedLocalFiles > 0;/);
  assert.match(PROGRESS, /\{failedAtEnd && retry\}/);
  assert.match(PROGRESS, /could not be uploaded\. Retry them, or add them again\./);
  for (const file of ["UploadManager.js", "UploadDock.js"]) assert.doesNotMatch(read("components", "image-selection", file), /retryAfterFinish/, `${file} keeps its card as it was`);
});

test("on a phone the album header shows its status chip only, so the pane does not scroll sideways", () => {
  assert.match(PROJECT, /<span className="hidden shrink-0 sm:inline">Updated: \{albumUpdatedLabel\}<\/span>/);
});

test("a design change is never lost: sent on the way out, and kept when a save fails", () => {
  assert.match(DESIGN, /pending\.current = \{ \.\.\.body, \.\.\.pending\.current \};/, "a failed save is laid back under newer changes");
  assert.match(DESIGN, /useEffect\(\(\) => \(\) => \{\s+window\.clearTimeout\(timer\.current\);\s+const body = pending\.current;/, "the unmount sends what is still waiting");
  assert.match(DESIGN, /updateSignatureAlbumDesign\(albumId, body\)\.then/);
});

test("read-only people can copy the link and PIN; only what writes sits in a read-only fieldset", () => {
  const clientAccess = RAIL.slice(RAIL.indexOf('<Section title="Client Access">'), RAIL.indexOf('<Section title="Permissions"'));
  assert.ok(clientAccess.indexOf('<CopyField label="Client URL"') < clientAccess.indexOf("<ReadOnlyFieldset"), "the copy fields are outside it");
  assert.match(clientAccess, /<ReadOnlyFieldset canWrite=\{canWrite\} reason=\{readOnlyTitle\}>\s+<DateField label="Expiry"/);
  assert.equal((RAIL.match(/<ReadOnlyFieldset /g) || []).length, 3, "publish switch, expiry and permissions");
});

test("unpublishing a live link is asked first, from the switch and from Review & Share", () => {
  assert.match(RAIL, /onCheckedChange=\{\(value\) => \(value \? onPublish\(\) : askUnpublish\(\)\)\}/);
  assert.match(RAIL, /<ReviewShareDialog [^>]*onUnpublish=\{askUnpublish\}/);
  assert.match(RAIL, /confirm === "unpublish" && <ConfirmDialog layer="confirmOverDialog" title="Unpublish the album\?"[^\n]*?onConfirm=\{async \(\) => \{ await onUnpublish\(\); setConfirm\(null\); \}\}/);
});

test("every client permission switch waits for the save in flight", () => {
  assert.equal((PERMISSIONS.match(/disabled=\{!canWrite \|\| busy\}/g) || []).length, 3);
});

test("a lapsed session during a download lets the download go, so the button is usable again after the PIN", () => {
  assert.match(CLIENT, /if \(failure\.status === 401\) \{ window\.clearTimeout\(pollTimer\.current\); setDownloadState\("idle"\);/);
});

// Batch B.
const GALLERY = read(...ALBUM_DIR, "AlbumGallery.js");
const QUEUE = read(...ALBUM_DIR, "useAlbumUploadQueue.js");
const DEFAULTS = read("components", "image-selection", "SignatureAlbumSettingsField.js");
const SETTINGS_FORM = read("components", "image-selection", "ImageSelectionSettingsForm.js");
const CHAPTER = read(...ALBUM_DIR, "client", "AlbumChapterSection.js");
const PRINT = read(...ALBUM_DIR, "client", "SignatureAlbumPrint.js");
const FRAME = read(...ALBUM_DIR, "client", "AlbumFrame.js");
const QUOTATION = read("components", "sales", "PublicQuotationPage.js");

test("on a phone the album's rail comes before the Gallery, which loads without end", () => {
  assert.match(PROJECT, /<div ref=\{setAlbumRailNode\} className="order-first [^"]*md:order-none/);
});

test("photos landing during an upload are laid in, not a reset to the first page; a delete still resets", () => {
  assert.match(WORKSPACE, /void reload\(\)\.then\(\(\) => \{ setUploadKey\(\(value\) => value \+ 1\); onAlbumChanged\?\.\(\); \}\)/);
  assert.match(WORKSPACE, /refreshKey=\{contentKey\} growKey=\{uploadKey\}/);
  assert.match(GALLERY, /pageRef\.current > 1 \? grow\(\) : load\(1\)/, "at the top it is the first page again");
  assert.match(GALLERY, /\[\.\.\.current, \.\.\.unseen\(response\.data\.items, current\)\]/, "a later page never repeats a photo");
  assert.match(GALLERY, /\}, \[load, refreshKey\]\);/, "refreshKey still starts again from the first page");
});

test("leaving the album mid-upload stops what has not been sent, as the prompt says", () => {
  assert.match(QUEUE, /useEffect\(\(\) => \(\) => \{ paused\.current = true; queue\.current = \[\]; \}, \[\]\);/);
});

test("the album defaults check their fields, keep Enter from submitting the Settings form, and closing asks first", () => {
  assert.match(DEFAULTS, /Enter a whole number from \$\{BATCH_MIN\} to \$\{BATCH_MAX\}\./);
  assert.match(DEFAULTS, /set\(key, event\.target\.value === "" \? "" : Number\(event\.target\.value\)\)/, "a cleared number is not sent as 0");
  assert.match(DEFAULTS, /disabled=\{!changedKeys\.length \|\| invalid\}/);
  assert.equal((DEFAULTS.match(/onKeyDown=\{keepEnter\}/g) || []).length, 2, "number and text fields; the textarea keeps its newline");
  assert.match(DEFAULTS, /maxLength=\{TEXT_MAX\}/);
  assert.match(DEFAULTS, /maxLength=\{ENDING_MAX\}/);
  assert.match(SETTINGS_FORM, /const leave = useUnsavedGuard\(\(\) => albumDefaultsDirty\.current/);
  assert.match(SETTINGS_FORM, /onClose=\{close\}/);
  assert.match(SETTINGS_FORM, /onSaved\?\.\(response\?\.data\);\s+close\(\);/, "Save Settings asks too before it closes the panel");
  assert.match(SETTINGS_FORM, /<ConfirmDialog \{\.\.\.leave\.confirmProps\} layer="confirmOverDialog" \/>/);
});

test("a download the server refused comes back to the client's page and is said there", () => {
  assert.match(CLIENT, /new URLSearchParams\(window\.location\.search\)\.get\("download"\) === "failed"/);
  assert.match(CLIENT, /The album download could not be completed\. Please try again\./);
  assert.match(QUOTATION, /const downloadFailed = searchParams\.get\("download"\) === "failed";/);
  assert.match(QUOTATION, /\{!printMode && <FloatingNotice notice=\{notice\} onClose=\{clearNotice\} \/>\}/, "never in the printed PDF");
});

test("a chapter whose next batch failed can still be asked for, by its count", () => {
  assert.match(CHAPTER, /<Button type="button" variant="plain" size="md" [^>]*onClick=\{\(\) => onLoadMore\(chapter\)\}>/);
});

test("an album without a PIN never shows PIN boxes - a lapsed session is reopened, twice at most", () => {
  assert.match(CLIENT, /if \(!meta \|\| meta\.requiresPin \|\| sessionToken\) return undefined;/);
  assert.match(CLIENT, /if \(autoOpens\.current >= 2\) throw/);
  assert.match(CLIENT, /if \(!sessionToken\) return meta\.requiresPin\s+\? <AlbumPinGate/);
});

test("the album PDF waits for the design's font sheet, and does not wait for one that failed", () => {
  assert.match(FRAME, /link\.dataset\.fontState = event\.type === "load" \? "loaded" : "failed"/);
  assert.match(PRINT, /every\(\(link\) => link\.dataset\.fontState\)/);
});

test("the quotation's error screens are laid out for the phone; its loading screen is left in the sheet's viewport", () => {
  for (const file of ["PublicQuotationPage.js", "PublicQuotationTermsPage.js", "PublicQuotationPaymentPage.js"]) {
    const page = read("components", "sales", file);
    assert.match(page, /if \(error\) return <DeviceViewport><main data-quotation-state="error"/, file);
    assert.doesNotMatch(page, /if \(loading\) return <DeviceViewport>/, `${file}: going back to the sheet could leave a phone zoomed in`);
  }
  assert.match(read("components", "shared", "ExpiredClientLink.js"), /import \{ useDeviceViewport \} from "@\/components\/shared\/DeviceViewport";/);
});
