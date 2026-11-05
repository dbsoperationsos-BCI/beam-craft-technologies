import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CULLING_FAILED_ASSURANCE, cullingHeldLine } from "../src/lib/imageSelectionCulling.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// The desktop app is the only way into AI Culling and AI Editing: it imports from the originals
// where they live and uploads compressed derivatives. The web reviews what arrives. So the
// browser's uploader is Photo Selection's alone - it never asks the server to hold a photo for
// either module - and neither AI tab mounts it or any other upload control.
test("the browser's uploader belongs to Photo Selection and never asks for a culling or editing hold", () => {
  const manager = read("components", "image-selection", "UploadManager.js");
  assert.doesNotMatch(manager, /destination/, "no destination: there is only one place a browser upload goes");
  const hook = read("components", "image-selection", "useUploadManager.js");
  assert.doesNotMatch(hook, /destination/);
  const store = read("lib", "imageSelectionUploadStore.js");
  assert.doesNotMatch(store, /holdForCulling|holdForEditing|CULLING|EDITING/, "the store never names the AI modules");
  const service = read("services", "image-selection", "image-selection.service.js");
  assert.doesNotMatch(service, /holdForCulling|holdForEditing/, "the upload request carries no hold");
  // Photo Selection still mounts it, under a subfolder, as it always has.
  const workspace = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
  assert.match(workspace, /activeTab === "photos" \? \(\s*isSubfolder \? \(\s*<>\s*<UploadManager/);
});

test("the AI Culling and AI Editing tabs offer no browser upload, and say the desktop app imports for them", () => {
  for (const file of [["culling", "CullingWorkspace.js"], ["culling", "CullingStateCard.js"], ["editing", "AiEditingWorkspace.js"]]) {
    const source = read("components", "image-selection", ...file);
    assert.doesNotMatch(source, /UploadManager|PhotoDropZone|type="file"|webkitdirectory|onDrop=|Add photos|Choose Photos|Choose Folder|Upload Photos|Upload Folder|uploadHere|uploaderOpen/, `${file.join("/")} offers no upload`);
  }
  const card = read("components", "image-selection", "culling", "CullingStateCard.js");
  assert.match(card, /No photos have been imported yet/);
  assert.match(card, /Import them with the DBS Desktop application/);
  assert.match(card, /Import photos with the DBS Desktop app/, "the non-upload way in is explained");
  assert.match(card, /The originals stay on that computer; only compressed previews reach the server/);
  const editing = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.match(editing, /No photos are available for AI Editing/);
  assert.match(editing, /imported and processed through the DBS Desktop application/);
  assert.match(editing, /sent here from AI Culling/, "AI Culling's send is the web's own way in, and stays");
  // The workspace no longer tells either tab about uploads.
  const workspace = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
  assert.doesNotMatch(workspace, /uploadHere/);
});

// AI Culling is a stage no photo skips. Photos imported for culling are counted and explained,
// and the only way on is the cull itself: Finalize moves the Keeps into AI Editing. No "without
// culling", no send to Photo Selection from the culling tab, no release call in the service.
test("photos imported for culling are counted and explained, and there is no way past the cull", () => {
  assert.equal(cullingHeldLine(0), null);
  assert.match(cullingHeldLine(1), /^1 photo imported here waits for culling\. Finalizing a run sends the photos it kept on to AI Editing\./);
  assert.match(cullingHeldLine(12), /^12 photos imported here wait for culling/);
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /cullingHeldLine\(counts\.held\)/);
  assert.match(workspace, /\{heldLine && \(/);
  for (const file of [["culling", "CullingWorkspace.js"], ["culling", "CullingReviewGallery.js"], ["culling", "CullingKeepsActions.js"], ["culling", "CullingStateCard.js"], ["SendPhotosActions.js"], ["ImageSelectionProjectWorkspace.js"]]) {
    const source = read("components", "image-selection", ...file);
    assert.doesNotMatch(source, /without culling|skip culling|bypass|releaseCullingHeld|confirmRelease|Continue to Photo Selection/i, `${file.join("/")} offers no way past the cull`);
  }
  assert.doesNotMatch(workspace, /canSendToPhotos/, "the culling review has no send to Photo Selection");
  assert.doesNotMatch(read("components", "image-selection", "culling", "CullingReviewGallery.js"), /canSendToPhotos/);
  const send = read("components", "image-selection", "SendPhotosActions.js");
  // No surface sends a ticked selection into Photo Selection - not the culling review, not AI
  // Editing: a finalized run's Keeps are what fill it.
  assert.doesNotMatch(send, /Send to Photo Selection|sendAiEditingToPhotoSelection|canSendToPhotos/, "no send into Photo Selection from either bay");
  assert.doesNotMatch(read("services", "image-selection", "image-selection.service.js"), /release-held|releaseCullingHeld/);
  assert.match(workspace, /Finalizing sends only the Keeps on to AI Editing/);
});

test("a failed run no longer claims every photo is in Photo Selection", () => {
  assert.match(CULLING_FAILED_ASSURANCE, /^This run changed nothing\./);
  assert.doesNotMatch(CULLING_FAILED_ASSURANCE, /every photo is still in Photo Selection/);
});

test("Photo Selection says how many photos wait in AI Culling", () => {
  const gallery = read("components", "image-selection", "Gallery.js");
  assert.match(gallery, /heldForCulling: response\.data\.heldForCulling \|\| 0/);
  assert.match(gallery, /waiting in AI Culling/);
});

// AI Culling → anywhere: only a finalized run's photos are sent on. The web holds every send with
// the reason until then (the server refuses it all the same), names the run so the server can check,
// refuses a double press, and says the album gets its existing previews from the web.
test("the web sends a culling run's photos only once it is finalized, naming the run, once per press", () => {
  const keeps = read("components", "image-selection", "culling", "CullingKeepsActions.js");
  assert.match(keeps, /const finalized = session\.status === "FINALIZED";/);
  assert.match(keeps, /if \(sending\.current \|\| !finalized\) return;\n\s+sending\.current = true;/);
  assert.match(keeps, /disabled=\{disabled \|\| !finalized \|\| Boolean\(busy\)\}[^\n]*Send kept to AI Editing/);
  assert.match(keeps, /disabled=\{disabled \|\| !finalized \|\| Boolean\(busy\)\}[^\n]*Send kept to AI Editing \+ Signature Album/);
  // The combined destination: enrolled in the bay for automatic album sync, then placed in the album - every Keep, no count.
  assert.match(keeps, /addPhotosToAiEditing\(projectId, \{ cullingSessionId: session\.id, decision: "KEEP", albumSync: true \}\)/);
  assert.match(keeps, /importUploadsToSignatureAlbum\(projectId, \{ cullingSessionId: session\.id, decision: "KEEP" \}\)/);
  assert.match(keeps, /const canSendToEditingAlbum = canSendToEditing && canSendToAlbum && canSyncEditsToAlbum;/);
  assert.ok(!/\blimit\b/.test(keeps), "no count anywhere");
  assert.match(keeps, /\{!finalized && <span id=\{reasonId\} className="text-amber-700">\{CULLING_NOT_FINALIZED\}<\/span>\}/, "the reason is said beside the held buttons");
  assert.equal((keeps.match(/aria-describedby=\{finalized \? undefined : reasonId\}/g) || []).length, 2, "and a screen reader hears it on both");
  assert.match(keeps, /data\.added \? "success" : "info"/, "nothing new is information, not success");
  assert.match(keeps, /Until a photo is edited the album shows its existing preview \(the web cannot read the originals\)/, "the web's limitation is said, not hidden");
  const send = read("components", "image-selection", "SendPhotosActions.js");
  assert.match(send, /export const CULLING_NOT_FINALIZED = "Finalize the run first - only a finalized run's Keeps are sent on\.";/);
  assert.match(send, /if \(from === "culling" && !finalized\) return <span role="status"/);
  assert.match(send, /Nothing new for the Signature Album/);
  assert.match(send, /const selection = cullingSessionId \? \{ cullingSessionId, \.\.\.\(destination === "editing" \? \{ uploadIds: slice \} : \{ imageIds: slice \}\) \} : slice;/);
  assert.match(send, /if \(sending\.current\) return;\n\s+sending\.current = true;/);
  assert.match(send, /finally \{ sending\.current = false; setBusy\(null\); \}/);
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(gallery, /from="culling"\n\s+cullingSessionId=\{session\.id\}\n\s+finalized=\{session\.status === "FINALIZED"\}/);
});

test("the AI Culling header stays in view inside the pane's own scroll, the AI Editing header's pattern", () => {
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /<div className="sticky -top-5 z-20 -mx-5 -mt-5 mb-4 border-b border-slate-200 bg-white px-5 pb-3 pt-5">/);
  const sticky = workspace.slice(workspace.indexOf('className="sticky -top-5'), workspace.indexOf("{state === \"failed\" && ("));
  for (const part of ['<h2 className="text-sm font-semibold text-slate-800">AI Culling</h2>', "Folder: {scopeLabel}", "cullingModeSummary(session)", "AI culling: {status.label}"]) assert.ok(sticky.includes(part), `${part} is in the sticky header`);
  const editing = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.match(editing, /sticky -top-5 z-20 -mx-5 -mt-5 mb-3 border-b border-slate-200 bg-white px-5 pb-3 pt-5/, "the same pattern as AI Editing");
});

