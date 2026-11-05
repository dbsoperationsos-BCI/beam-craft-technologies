import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ADJUSTMENTS, CROP_ASPECT_IDS, EMPTY_RECIPE, RETOUCH_TOOL_IDS, STYLE_IDS, TOOL_IDS, TOOLS, approximateCssFilter, defaultToolSettings, normalizeRecipe, recipeIsEmpty, recipeMatchesApplied, summarizeRecipe } from "../src/lib/aiEditingRecipe.mjs";
import { EDITING_VIEWER_FALLBACK_HEIGHT, EDITING_VIEWER_MAX_HEIGHT, EDITING_VIEWER_RESERVE_REM, LOCAL_SOURCE_CODES, adjustmentSectionState, sectionToolIds, setAdjustmentSection, setToolSection, toolSectionState, autoValuesOf, editingCountsLine, editingEngineStatus, editingLocalSourceLine, editingNavigationKey, editingNavigationTarget, editingNeedsPolling, editingPhotoStatus, editingPositionLine, editingSentLine, editingSourceLine, editingTileImage, editingViewerFrame, editingViewerRoom, editingWaitingLine, toolAvailability } from "../src/lib/imageSelectionEditing.mjs";
import { PROGRESS_COLORS } from "../src/lib/progressStatus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => fs.readFileSync(path.join(here, "..", "src", ...segments), "utf8");
const require = createRequire(import.meta.url);

/*
 * The AI Editing tab: its recipe is the backend's recipe word for word, its tiles say where a photo
 * stands, and its uploads are held in the bay the way AI Culling's are held for culling.
 */
test("the recipe contract is the backend's: the same styles, tools, aspects and normalization", () => {
  const backend = require("../../backend/src/modules/image-selection/ai-editing/recipe.js");
  assert.deepEqual(STYLE_IDS, backend.STYLE_IDS);
  assert.deepEqual(TOOL_IDS, backend.TOOL_IDS);
  assert.deepEqual(CROP_ASPECT_IDS, backend.CROP_ASPECT_IDS);
  assert.deepEqual(ADJUSTMENTS.map((entry) => entry.id), backend.ADJUSTMENTS);
  assert.deepEqual(ADJUSTMENTS.filter((entry) => entry.auto).map((entry) => entry.id), [...backend.AUTO_EXPOSURE_FIELDS, ...backend.AUTO_WHITE_BALANCE_FIELDS]);
  for (const id of TOOL_IDS) assert.deepEqual(defaultToolSettings(id), { ...Object.fromEntries(Object.entries(backend.TOOLS[id].settings).map(([name, [, , fallback]]) => [name, fallback])), ...(backend.TOOLS[id].masks ? { masks: [] } : {}), ...(backend.TOOLS[id].aspect ? { aspect: "original" } : {}) }, `defaults of ${id}`);
  const messy = { style: "cinematic", adjustments: { exposure: null, contrast: "150", vibrance: null }, tools: { denoise: {}, removeObject: { masks: [{ x: 0.9, y: 0.2, w: 0.5, h: 0.1 }] }, autoCrop: { aspect: "9:16" } }, reference: { strength: 500 } };
  assert.deepEqual(normalizeRecipe(messy), backend.normalizeRecipe(messy));
  assert.deepEqual(EMPTY_RECIPE, backend.EMPTY_RECIPE);
  assert.equal(recipeIsEmpty({ adjustments: { exposure: 0 } }), backend.recipeIsEmpty({ adjustments: { exposure: 0 } }));
});

test("the ten retouching regions are tools of their own group, drawn by the same row as the AI tools in a section of their own", () => {
  const backend = require("../../backend/src/modules/image-selection/ai-editing/recipe.js");
  assert.deepEqual([...RETOUCH_TOOL_IDS], [...backend.RETOUCH_TOOL_IDS]);
  for (const id of RETOUCH_TOOL_IDS) {
    const spec = TOOLS.find((tool) => tool.id === id);
    assert.equal(spec.group, "retouch", `${id} is a retouching region`);
    assert.deepEqual(Object.keys(spec.settings), ["amount"], `${id} carries one intensity`);
    assert.equal(spec.labels.amount, "Intensity");
    assert.ok(spec.hint, `${id} says what it does`);
    assert.deepEqual(defaultToolSettings(id), { amount: backend.TOOLS[id].settings.amount[2] });
  }
  const controls = fs.readFileSync(path.join(here, "..", "src", "components", "image-selection", "editing", "EditingControls.js"), "utf8");
  assert.match(controls, /function ToolRow\(\{ spec, recipe, capabilities, disabled, onToggle, onSettings/, "one row for every tool");
  assert.match(controls, /TOOLS\.filter\(\(spec\) => spec\.group === "ai"\)\.map\(\(spec\) => <ToolRow/);
  assert.match(controls, /<Section title="Retouching" count=\{retouchCount \? `\$\{retouchCount\} on` : ""\} open=\{retouchOpen\}/, "folded away until a region is on, then the photographer's to fold");
  assert.match(controls, /const \[retouchOpen\] = useState\(\(\) => RETOUCH_TOOL_IDS\.some/, "opens on its own only for a photo that arrives with a region on");
  assert.match(controls, /RETOUCH_TOOL_IDS\.filter\(\(id\) => recipe\.tools\[id\] && toolAvailability\(capabilities, id\)\.available\)/, "the count is of regions this server can run");
  assert.match(controls, /label=\{region && name === "amount" \? `\$\{spec\.label\} intensity`/, "each intensity slider is named after its region");
  assert.match(controls, /<ToggleSwitch label=\{spec\.label\} helperText=\{availability\.available \? availability\.note \|\| spec\.hint : ""\}/, "a region says what it does in its switch's ⓘ, on or off, and beside the amber line when approximate");
  assert.match(controls, /TOOLS\.filter\(\(spec\) => spec\.group === "retouch"\)\.map\(\(spec\) => <ToolRow/);
  assert.equal((controls.match(/<ToggleSwitch /g) || []).length, 2, "the switch is typed twice: once in the row, once in a section header");
  assert.equal(summarizeRecipe({ tools: { teeth: { amount: 35 }, hair: { amount: 30 } } }), "Teeth · Hair");
});

test("the live preview approximates only the basic sliders, and says nothing for an untouched recipe", () => {
  assert.equal(approximateCssFilter(EMPTY_RECIPE), "");
  assert.match(approximateCssFilter({ adjustments: { exposure: 50 } }), /^brightness\(2\.000\)$/);
  assert.match(approximateCssFilter({ adjustments: { contrast: 50, saturation: 50, temperature: 40 } }), /contrast\(1\.300\) saturate\(1\.400\) sepia\(0\.140\)/);
  assert.match(approximateCssFilter({ adjustments: { temperature: -50 } }), /hue-rotate\(6deg\)/);
  assert.equal(summarizeRecipe({ style: "moody", adjustments: { exposure: 5 }, tools: { sharpen: {} }, reference: { strength: 50 } }), "Moody · 1 adjustment · Sharpen · Reference style");
});

test("a tile says where the photo stands, from the photo and its edit alone", () => {
  assert.equal(editingPhotoStatus({ status: "PROCESSING" }).id, "uploading");
  assert.equal(editingPhotoStatus({ status: "PROCESSING_FAILED" }).id, "failedUpload");
  assert.equal(editingPhotoStatus({ status: "READY", edit: null }).id, "untouched");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "DRAFT", recipe: EMPTY_RECIPE, hasOutput: false } }).id, "untouched", "an empty recipe saved is no edit");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "DRAFT", recipe: { style: "moody" }, hasOutput: false } }).id, "draft");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "QUEUED" } }).label, "Queued");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "RENDERING" } }).color, PROGRESS_COLORS.inProgress);
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "FAILED" } }).id, "failed");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "RENDERED", hasOutput: true, dirty: false } }).id, "edited");
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "RENDERED", hasOutput: true, dirty: true } }).id, "changed");
});

test("the bay polls only while something is moving", () => {
  assert.equal(editingNeedsPolling([{ status: "READY", edit: { status: "RENDERED" } }]), false);
  assert.equal(editingNeedsPolling([{ status: "PROCESSING" }]), true);
  assert.equal(editingNeedsPolling([{ status: "READY", edit: { status: "QUEUED" } }]), true);
  assert.equal(editingNeedsPolling([]), false);
});

test("a tile shows the render once there is one, and the sliders left to the AI read back what it chose", () => {
  assert.deepEqual(editingTileImage({ thumbnailUrl: "t", edit: { hasOutput: true, outputThumbnailUrl: "o" } }), { src: "o", edited: true });
  assert.deepEqual(editingTileImage({ thumbnailUrl: "t", edit: { hasOutput: false } }), { src: "t", edited: false });
  assert.deepEqual(autoValuesOf({ recipe: { adjustments: { exposure: null, contrast: 10 } }, appliedRecipe: { adjustments: { exposure: 12, contrast: 10 } } }), { exposure: 12 });
  assert.deepEqual(autoValuesOf(null), {});
  assert.match(editingSourceLine({ hasOutput: true, sourceKind: "ORIGINAL" }), /from the original/);
  assert.match(editingSourceLine({ hasOutput: true, sourceKind: "PREVIEW" }), /uploaded preview/);
  assert.equal(editingSourceLine({ hasOutput: false }), "");
  assert.equal(editingSentLine({ edit: { hasOutput: true, sentToAlbum: true } }), "Sent to Signature Album");
});

// AI Editing and Photo Selection are separate workspaces with no link between them on this tab,
// so nothing in AI Editing says anything about Photo Selection: the tile line and the editor's
// line name the Signature Album send and nothing else, whatever the server's row carries.
test("AI Editing says nothing about Photo Selection - not on a tile, not in the editor, whatever the row says", () => {
  for (const photo of [
    { inPhotoSelection: true, edit: null },
    { inPhotoSelection: true, edit: { hasOutput: false } },
    { inPhotoSelection: true, edit: { hasOutput: true, sentToPhotos: true } },
    { inPhotoSelection: false, edit: { status: "DRAFT", hasOutput: false, sentToPhotos: true } },
    { id: "u1", projectId: "p1", folderId: "f1", fileName: "DSC_0001.JPG", heldForEditing: true, edit: { status: "DRAFT" } },
    { inPhotoSelection: null, edit: null },
    null,
  ]) assert.equal(editingSentLine(photo), "", JSON.stringify(photo));
  assert.equal(editingSentLine({ inPhotoSelection: true, edit: { hasOutput: true, sentToPhotos: true, sentToAlbum: true } }), "Sent to Signature Album", "the album send is the one thing named");
  const grid = read("components", "image-selection", "editing", "EditingPhotoGrid.js");
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  const lib = read("lib", "imageSelectionEditing.mjs");
  // The grid and the editor draw the same line from the same helper, and no AI Editing file
  // renders the words itself or reads the server's Photo Selection fields.
  assert.match(grid, /const sent = editingSentLine\(photo\);/);
  assert.match(panel, /const sentLine = editingSentLine\(photo\);/);
  for (const source of [grid, panel, workspace]) assert.doesNotMatch(source, /In Photo Selection|Sent to Photo Selection|inPhotoSelection|sentToPhotos|cullingHoldAt|editingHoldAt|cullRejectedAt/);
  assert.doesNotMatch(lib, /"In Photo Selection"|"Sent to Photo Selection"|inPhotoSelection|sentToPhotos/);
});

test("the engine chip and the tool availability come from the server's own capability answer", () => {
  assert.equal(editingEngineStatus({ engine: { status: "ready" } }).label, "AI ready");
  assert.equal(editingEngineStatus({ engine: { status: "disabled" } }).color, PROGRESS_COLORS.notStarted);
  assert.equal(editingEngineStatus(null).label, "Checking AI");
  assert.deepEqual(toolAvailability(null, "retouchFace"), { available: true, reason: "", partial: false });
  assert.equal(toolAvailability({ tools: { retouchFace: { available: false, reason: "no face engine" } } }, "retouchFace").available, false);
  assert.equal(toolAvailability({ tools: { retouchFace: { available: true, partial: true, reason: "no landmarks" } } }, "retouchFace").partial, true);
});

// The AI Editing tab takes no browser upload: the desktop app imports and renders from the
// originals, and AI Culling's send is the web's own way in. The bay reviews what arrives.
test("the AI Editing tab offers no browser upload and names the desktop app as the way in", () => {
  const editing = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.doesNotMatch(editing, /UploadManager|uploadHere|uploaderOpen|Add photos/);
  assert.match(editing, /No photos are available for AI Editing/);
  assert.match(editing, /DBS Desktop application/);
  assert.doesNotMatch(read("lib", "imageSelectionUploadStore.js"), /holdForEditing/);
});

test("the workspace opens on its module, offers AI Editing behind its own permission, and sends from AI Culling by permission too", () => {
  const workspace = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
  // Opened on one module (Photo Selection by default); a project without it says so instead.
  assert.match(workspace, /stage = "photos"/);
  assert.match(workspace, /const activeTab = stage;/);
  assert.match(workspace, /const noTabs = stageReady && !hasTab\(stage\);/);
  assert.match(workspace, /useModuleAccess\("IMAGE_SELECTION", "AI Editing"\)/);
  assert.match(workspace, /tab\.id === "editing" \? editingAccess\.loading \|\| editingAccess\.canRead/);
  assert.match(workspace, /canSendToEditing=\{linkedTo\("culling", "editing"\) && editingAccess\.canWrite\}/);
  // A manual project's null tick reads as on for both AI tabs - the root cause of a missing
  // "Send to AI Editing" on an older project was the tab itself being absent.
  assert.match(workspace, /tab\.id === "culling" \? project\.photoCullingTab !== false/);
  assert.match(workspace, /tab\.id === "editing" \? project\.aiEditingTab !== false/);
  const review = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(review, /Select all loaded \(\$\{items\.length\}\)/);
  assert.match(review, /<SendPhotosActions[\s\S]*?from="culling"/);
  const culling = read("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(culling, /<CullingKeepsActions[\s\S]*?canSendToEditing=\{canSendToEditing\}/);
  assert.match(read("components", "image-selection", "culling", "CullingKeepsActions.js"), /cullingSessionId: session\.id, decision: "KEEP"/);
  assert.match(workspace, /canSendToAlbum=\{linkedTo\("culling", "album"\) && albumAccess\.canWrite\}/);
  const form = read("components", "image-selection", "CreateImageSelectionProject.js");
  // The form's Linked Modules list the modules in the flow's order, from the viewer's permissions.
  assert.match(form, /linkedModuleOptions\(current, hasPermission\)/);
  // No remaining "Photo Culling" on screen: the tab, the state card and the heading say AI Culling.
  assert.doesNotMatch(read("components", "image-selection", "culling", "CullingStateCard.js"), /eyebrow: "Photo Culling"/);
  assert.match(read("components", "image-selection", "culling", "CullingWorkspace.js"), /<h2 className="text-sm font-semibold text-slate-800">AI Culling<\/h2>/);
});

// An auto render is not an unapplied change: a slider left to the AI reads as the number the
// render chose - the backend's rule, so the panel's "Apply the changes before sending" and the
// server's `dirty` can never disagree. Held against the backend's own function.
test("a saved recipe matches its render when the Auto sliders read as the render's numbers (the backend's rule)", () => {
  const applied = { style: "luxuryWedding", adjustments: { ...EMPTY_RECIPE.adjustments, exposure: 21, highlights: -40, temperature: 3 }, tools: { autoExposure: {} }, reference: null };
  assert.equal(recipeMatchesApplied({ style: "luxuryWedding", adjustments: { exposure: null, highlights: null, temperature: null }, tools: { autoExposure: {} } }, applied), true);
  assert.equal(recipeMatchesApplied({ style: "luxuryWedding", adjustments: { exposure: 21, highlights: -40, temperature: 3 }, tools: { autoExposure: {} } }, applied), true);
  assert.equal(recipeMatchesApplied({ style: "luxuryWedding", adjustments: { exposure: 21, highlights: -40, temperature: 3, contrast: 15 }, tools: { autoExposure: {} } }, applied), false, "a moved slider is a change");
  assert.equal(recipeMatchesApplied({ style: "moody" }, null), false);
  const backendService = path.join(here, "..", "..", "backend", "src", "modules", "image-selection", "ai-editing", "service.js");
  let backend = null;
  try { backend = fs.existsSync(backendService) ? require(backendService) : null; } catch { backend = null; }
  if (backend) {
    for (const [recipe, rendered] of [[{ adjustments: { exposure: null } }, applied], [{ adjustments: { exposure: 5 } }, applied], [{ style: "moody" }, applied]]) {
      assert.equal(recipeMatchesApplied(recipe, rendered), backend.recipeMatchesApplied(recipe, rendered));
    }
  }
  const panel = fs.readFileSync(path.join(here, "..", "src", "components", "image-selection", "editing", "EditingPanel.js"), "utf8");
  assert.match(panel, /const dirty = !recipeMatchesApplied\(recipe, edit\?\.appliedRecipe\) && !recipeIsEmpty\(recipe\)/);
});

// Where a render reads from is never a silent fallback. A photo whose original lives only on a
// studio workstation waits for the desktop app that holds it (WAITING_FOR_DESKTOP), the bay keeps
// asking after it, and the one way to render it from the 1600px web preview is a button that says
// so. The three ways the workstation can fail to open the original carry the backend's own words.
test("a render waiting for the workstation has its own status, keeps the bay polling and is counted", () => {
  const waiting = editingPhotoStatus({ status: "READY", edit: { status: "WAITING_FOR_DESKTOP", recipe: { style: "moody" }, hasOutput: false } });
  assert.deepEqual(waiting, { id: "waitingForDesktop", label: "Waiting for workstation", color: PROGRESS_COLORS.inProgress });
  assert.equal(editingPhotoStatus({ status: "READY", edit: { status: "WAITING_FOR_DESKTOP", recipe: EMPTY_RECIPE, hasOutput: false } }).id, "waitingForDesktop", "a wait is never read as untouched, whatever the recipe");
  assert.equal(editingNeedsPolling([{ status: "READY", edit: { status: "WAITING_FOR_DESKTOP" } }]), true);
  assert.match(editingCountsLine({ total: 3, waitingForDesktop: 2 }), /2 waiting for workstation/);
  assert.doesNotMatch(editingCountsLine({ total: 3, waitingForDesktop: 0 }), /waiting/);
});

test("the local-source words are the contract's, said for an errorCode and for a wait", () => {
  assert.deepEqual(LOCAL_SOURCE_CODES, ["LOCAL_SOURCE_UNAVAILABLE", "LOCAL_SOURCE_CHANGED", "LOCAL_SOURCE_UNREADABLE"]);
  assert.equal(editingLocalSourceLine({ errorCode: "LOCAL_SOURCE_UNAVAILABLE" }), "Original file is unavailable on this workstation. Reconnect the storage/NAS or remap the storage root, then try again.");
  assert.equal(editingLocalSourceLine({ errorCode: "LOCAL_SOURCE_CHANGED" }), "The original on this workstation is not the file that was added (its size or checksum differs). Check the file, then try again.");
  assert.equal(editingLocalSourceLine({ errorCode: "LOCAL_SOURCE_UNREADABLE" }), "The original could not be decoded on this workstation, so it was not analysed.");
  assert.equal(editingLocalSourceLine({ errorCode: null }), "");
  assert.equal(editingLocalSourceLine({ errorCode: "SOMETHING_ELSE" }), "", "an unknown code gets no invented sentence");
  assert.equal(editingLocalSourceLine(null), "");
  assert.equal(editingWaitingLine({ edit: { status: "WAITING_FOR_DESKTOP" } }), "Only the desktop app that holds this original can render it from the original. Open the project in the desktop app, or render from the web preview (1600px) instead - the original stays untouched.");
  assert.equal(editingWaitingLine({ edit: { waitingForDesktop: true, status: "WAITING_FOR_DESKTOP" } }, true), editingWaitingLine({ edit: { status: "WAITING_FOR_DESKTOP" } }));
  // A viewer is told what is happening, not what to do - they cannot do it.
  assert.equal(editingWaitingLine({ edit: { status: "WAITING_FOR_DESKTOP" } }, false), "Waiting for the studio workstation to render this photo from the original.");
  assert.equal(editingWaitingLine({ edit: { status: "QUEUED" } }), "");
  assert.equal(editingWaitingLine(null, false), "");
});

test("the panel asks before rendering from the preview, and offers it only as an explicit button", () => {
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  const service = read("services", "image-selection", "ai-editing.service.js");
  // Apply sends no source; the server routes. `() => render()`, never `onClick={render}` - the
  // click event would travel as `source` and the server would refuse it.
  assert.match(panel, /renderAiEditingPhoto\(projectId, uploadId, recipe, source \? \{ source \} : \{\}\)/);
  assert.match(service, /source \? \{ recipe, source \} : \{ recipe \}/);
  assert.match(panel, /<Button variant="primary" size="sm" onClick=\{\(\) => render\(\)\} disabled=\{rendering \|\| waitingForDesktop \|\| recipeIsEmpty\(recipe\)\}/);
  assert.doesNotMatch(panel, /onClick=\{render\}/);
  // A 409 asking for a choice opens the dialog instead of a notice; the dialog leads with the consequence.
  assert.match(panel, /error\.status === 409 && error\.data\?\.details\?\.requiresSourceChoice/);
  assert.match(panel, /title="Render from the web preview\?"/);
  assert.match(panel, /The edit will be rendered at web-preview quality \(1600px\), not from the original\. The original stays untouched on the studio's machine\./);
  assert.match(panel, /cancelLabel="Not now"/);
  assert.match(panel, /onCancel=\{\(\) => \{ setSourceChoice\(null\); setSourceDeclined\(true\); \}\}/);
  assert.match(panel, /<p role="status" className="[^"]*">Not applied — the original is only on the studio workstation\.<\/p>/);
  // The preview is only ever sent as "preview", by the user's own hand, and only where the
  // workstation is the reason: the waiting banner, or a failure in the local-source words.
  const sources = [...panel.matchAll(/render\("([a-z]+)"\)/g)].map((match) => match[1]);
  assert.ok(sources.length > 0);
  assert.deepEqual([...new Set(sources)], ["preview"]);
  assert.match(panel, /\{canWrite && localSourceLine && <Button[^\n]*render\("preview"\)/);
  assert.doesNotMatch(panel, /edit\.errorCode && <Button/);
  assert.match(panel, />Render from web preview instead<\/Button>/);
  assert.doesNotMatch(panel, /<button/, "no raw button; Button does the job");
  assert.doesNotMatch(panel, /Handed to the desktop app/, "the banner says it; no toast as well");
  // A batch that needs a choice opens the dialog with its counts, instead of a notice.
  assert.match(panel, /data\.requiresSourceChoice > 0\) setSourceChoice\(\{ kind: "batch", scope, count: data\.requiresSourceChoice, queued: data\.queued \|\| 0, waitingForDesktop: data\.waitingForDesktop \|\| 0 \}\)/);
  assert.doesNotMatch(panel, /your choice below/);
  assert.match(panel, /Already going ahead: \$\{sourceChoice\.queued\} queued on the server, \$\{sourceChoice\.waitingForDesktop\} handed to the workstation\./);
  assert.match(panel, /applyTo\(choice\.scope, "preview"\)/);
});

// The editor walks the bay from the keyboard: Left / Right a photo, Home / End the ends, the list
// clamped (the culling review's rule), a key typed into a control left to the control.
test("the keyboard moves between the bay's photos, clamped at the ends, and never from inside a control", () => {
  assert.equal(editingNavigationKey({ key: "ArrowLeft" }), "prev");
  assert.equal(editingNavigationKey({ key: "ArrowRight" }), "next");
  assert.equal(editingNavigationKey({ key: "Home" }), "first");
  assert.equal(editingNavigationKey({ key: "End" }), "last");
  assert.equal(editingNavigationKey({ key: "ArrowUp" }), null);
  assert.equal(editingNavigationKey({ key: "ArrowRight", ctrlKey: true }), null, "a chord is the browser's");
  assert.equal(editingNavigationKey({ key: "ArrowRight", shiftKey: true }), null);
  assert.equal(editingNavigationKey(null), null);
  assert.equal(editingNavigationTarget("next", 2, 20), 3);
  assert.equal(editingNavigationTarget("prev", 2, 20), 1);
  assert.equal(editingNavigationTarget("first", 7, 20), 0);
  assert.equal(editingNavigationTarget("last", 7, 20), 19);
  assert.equal(editingNavigationTarget("next", 19, 20), null, "the last photo's Right lands nowhere - no wrap");
  assert.equal(editingNavigationTarget("prev", 0, 20), null);
  assert.equal(editingNavigationTarget("first", 0, 20), null);
  assert.equal(editingNavigationTarget("next", -1, 20), null, "a photo the page no longer lists moves nowhere");
  assert.equal(editingNavigationTarget("next", 0, 0), null);
  assert.equal(editingPositionLine({ index: 2, total: 20 }), "3 of 20");
  assert.equal(editingPositionLine({ index: 0, total: 1 }), "1 of 1");
  assert.equal(editingPositionLine(null), "");
  assert.equal(editingPositionLine({ index: -1, total: 20 }), "");
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  // One listener, bound while the editor is open, reading the latest handlers through a ref; a
  // key in a field, slider, menu or dialog is the control's, arrows on the compare tabs are the
  // tabs', any open dialog owns every key, and Escape leaves the way "All photos" does - through
  // the one Escape stack (useEscapeKey), never a listener of its own.
  assert.match(workspace, /const direction = editingNavigationKey\(event\);/);
  assert.match(workspace, /if \(!direction \|\| event\.defaultPrevented \|\| cullingKeyIgnored\(event\.target, event\)\) return;/);
  assert.match(workspace, /if \(document\.querySelector\('\[role="dialog"\]'\) \|\| event\.target\?\.closest\?\.\('\[role="tablist"\]'\)\) return;/);
  assert.match(workspace, /window\.addEventListener\("keydown", keydown\)/);
  assert.match(workspace, /\}, \[editorOpen\]\);/);
  assert.match(workspace, /useEffect\(\(\) => \{ navigateRef\.current = navigate; \}\);/);
  assert.match(workspace, /useEscapeKey\(\(\) => \{ closePhoto\(\); load\(\); onChanged\?\.\(\); \}, editorOpen\);/);
  assert.doesNotMatch(workspace, /"Escape"/);
  // The bay is one continuous list: Right off the last loaded photo loads the next batch and moves
  // on, End loads every batch left; both moves rest meanwhile.
  assert.match(workspace, /const needsMore = bay\.hasMore && \(direction === "last" \|\| \(direction === "next" && openIndex === photos\.length - 1\)\);/);
  assert.match(workspace, /\(direction === "last" \? bay\.loadAll\(\) : bay\.loadMore\(\)\)/);
  assert.match(workspace, /if \(!open \|\| loading \|\| openIndex < 0 \|\| moving\) return;/);
  assert.match(workspace, /canNext: !loading && !moving && \(openIndex < photos\.length - 1 \|\| bay\.hasMore\)/);
  assert.match(workspace, /const current = openIndex >= 0 \? photos\[openIndex\] : open;/, "the editor is given the bay's current row, so a return shows what was saved");
  assert.match(workspace, /photo=\{current\}/);
  assert.match(workspace, /position=\{position\}\n\s+onNavigate=\{navigate\}/);
  assert.match(workspace, /\{ index: openIndex, total, canPrev: !loading && !moving && openIndex > 0, canNext: !loading && !moving && \(openIndex < photos\.length - 1 \|\| bay\.hasMore\) \}/, "its place in the whole bay, clamped at both ends");
  // The move is announced from one live region outside the keyed panel, and a move made with a
  // button puts focus back on that button.
  assert.match(workspace, /<p className="sr-only" role="status" aria-live="polite">\{position \? `\$\{focus \? "Selected photo" : "Photo"\} \$\{position\.index \+ 1\} of \$\{position\.total\}, \$\{current\?\.fileName \|\| ""\}` : ""\}<\/p>/);
  assert.match(workspace, /document\.querySelector\(`\[aria-label="\$\{direction === "prev" \? "Previous photo" : "Next photo"\}"\]`\)\?\.focus\(\);/);
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  assert.match(panel, /<IconButton size="md" ariaLabel="Previous photo" disabled=\{!position\.canPrev\} onClick=\{\(\) => onNavigate\?\.\("prev", \{ viaButton: true \}\)\} className="[^"]*sm:h-8 sm:w-8"/, "a 40px target on a phone, the header's 32px from sm up");
  assert.match(panel, /<IconButton size="md" ariaLabel="Next photo" disabled=\{!position\.canNext\} onClick=\{\(\) => onNavigate\?\.\("next", \{ viaButton: true \}\)\} className="[^"]*sm:h-8 sm:w-8"/);
  assert.match(panel, /<span className="min-w-12 text-center tabular-nums">\{editingPositionLine\(position\)\}<\/span>/, "the counter sits between the two arrows");
  assert.ok(!panel.includes("Home / End · Esc"), "no key-hint text beside the arrows (the owner's call)");
  assert.doesNotMatch(panel, /title="(Previous|Next) photo/, "no browser tooltip on an icon button (the house rule)");
  // Leaving the photo saves a change still waiting (or one whose save failed) and writes it into
  // the bay's row; a save that fails even then hands the sliders to the bay, which keeps them for
  // the photo's next opening (opened "Not saved" with Retry) and offers "Open photo".
  assert.match(panel, /if \(!canWrite \|\| JSON\.stringify\(latestRecipe\.current\) === savedJson\.current\) return;/);
  assert.match(panel, /latest\.current\.onPhotoChange\?\.\(\{ \.\.\.latest\.current\.photo, edit: response\.data \}\)/);
  assert.match(panel, /\.catch\(\(\) => latest\.current\.onUnsavedChange\?\.\(uploadId, next, latest\.current\.photo\?\.fileName\)\)/);
  assert.match(panel, /useEffect\(\(\) => \{ latest\.current = \{ photo, onPhotoChange, onUnsavedChange \}; \}\);/);
  assert.match(panel, /\}, \[canWrite, projectId, uploadId\]\);\n  useEffect\(\(\) => flush, \[flush\]\);/);
  assert.match(panel, /useState\(\(\) => normalizeRecipe\(unsavedRecipe \|\| initial\.edit\?\.recipe\)\)/);
  assert.match(panel, /useState\(unsavedRecipe \? "failed" : "saved"\)/);
  assert.match(workspace, /unsavedRecipe=\{unsaved\.get\(open\.id\) \|\| null\}/);
  assert.match(workspace, /Your changes to \$\{fileName \|\| "the photo"\} were not saved\. Open the photo and retry\./);
  assert.match(workspace, /label: "Open photo", onSelect: \(\) => openPhoto\(row\)/);
});

// AI Editing sends to the Signature Album only. Photo Selection is filled by a finalized AI
// Culling run's Keeps; nothing in the editing tab - the editor, the bay's bulk bar, the service -
// reaches it, and no render or save does so on its own.
test("the AI Editing tab has no send to Photo Selection, on screen or in its service", () => {
  for (const file of [["components", "image-selection", "editing", "EditingPanel.js"], ["components", "image-selection", "editing", "AiEditingWorkspace.js"], ["components", "image-selection", "SendPhotosActions.js"], ["services", "image-selection", "ai-editing.service.js"]]) {
    const source = read(...file);
    assert.doesNotMatch(source, /send-to-photo-selection|sendAiEditingToPhotoSelection|canSendToPhotos|onOpenPhotos|"Send to Photo Selection"/, `${file.at(-1)} offers no way into Photo Selection`);
  }
  const workspace = read("components", "image-selection", "ImageSelectionProjectWorkspace.js");
  assert.doesNotMatch(workspace, /<AiEditingWorkspace[\s\S]*?canSendToPhotos/, "the editing tab is not given a Photo Selection send");
  const send = read("components", "image-selection", "SendPhotosActions.js");
  assert.match(send, /const LABELS = \{ editing: "AI Editing", album: "Signature Album" \};/);
  assert.match(send, /\{canSendToAlbum && button\("album", "Send to Signature Album"\)\}/);
  assert.match(send, /not sent: still rendering, or the render failed\. Apply again, then send\./, "the album summary says what was held back");
  // Every photo held back is a problem, not a success, and the selection is kept for the retry.
  assert.match(send, /if \(!n\(data\.created\) && !n\(data\.referenced\) && data\.notReady\) return `Nothing was sent\.\$\{held\}`;/);
  assert.match(send, /if \(!sentSomething && !repeats\.length && data\.notReady\) \{ onError\?\.\(summarize\(destination, data, from\)\); setConfirm\(null\); return; \}/);
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  assert.match(panel, /disabled=\{rendering \|\| waitingForDesktop \|\| dirty\}/, "the send waits for the render on screen");
  assert.match(panel, /<p role="status" className="[^"]*">\{rendering \? "Rendering - the send and the download unlock when it finishes\."/, "why the send and the download rest is announced");
  assert.match(panel, /label: "Open Signature Album"/);
});

// The viewer frame is sized by the workspace, not by the photograph: its width comes from the
// room's height and the photo's own ratio, capped by the column, so a portrait photo stands as
// tall as the room allows and a landscape one fills the column - the same rule in every mode.
test("the editor's frame is bounded by the workspace in every compare mode, hugs the photo and never distorts it", () => {
  assert.equal(EDITING_VIEWER_FALLBACK_HEIGHT, "clamp(14rem, calc(100vh - 22rem), 64rem)");
  assert.equal(EDITING_VIEWER_MAX_HEIGHT, `var(--editing-viewer-max, ${EDITING_VIEWER_FALLBACK_HEIGHT})`, "the measured room, the fallback until it is measured");
  // The room: from the frame's top to the pane's bottom less the action bar's 7rem, clamped 14rem..64rem.
  assert.equal(EDITING_VIEWER_RESERVE_REM, 10, "the navigation row and the action bar sit under the frame");
  assert.equal(editingViewerRoom({ paneHeight: 884, frameTop: 324, rem: 16 }), 400);
  assert.equal(editingViewerRoom({ paneHeight: 500, frameTop: 400, rem: 16 }), 224, "never under 14rem");
  assert.equal(editingViewerRoom({ paneHeight: 3000, frameTop: 100, rem: 16 }), 1024, "never over 64rem");
  assert.deepEqual(editingViewerFrame({ width: 6000, height: 4000 }), { aspectRatio: "6000 / 4000", width: `min(100%, calc(${EDITING_VIEWER_MAX_HEIGHT} * 6000 / 4000))` });
  assert.deepEqual(editingViewerFrame({ width: 2000, height: 3000 }), { aspectRatio: "2000 / 3000", width: `min(100%, calc(${EDITING_VIEWER_MAX_HEIGHT} * 2000 / 3000))` });
  assert.deepEqual(editingViewerFrame(null), editingViewerFrame({ width: 3, height: 2 }), "no dimensions yet: a 3:2 frame stands in");
  assert.deepEqual(editingViewerFrame({ width: 0, height: null }), editingViewerFrame({ width: 3, height: 2 }));
  const preview = read("components", "image-selection", "editing", "EditingPreview.js");
  // One frame rule for Before / After, Split and both Side by side panels; the frame hugs the
  // photo (mx-auto, never w-full with the photo's ratio), the photo is object-contain inside.
  assert.match(preview, /const frame = editingViewerFrame\(natural \|\| \{ width: photo\.width, height: photo\.height \}\);/);
  assert.equal((preview.match(/style=\{frame\}/g) || []).length, 3, "the single frame and the two side panels");
  assert.doesNotMatch(preview, /aspectRatio: ratio|(?<!max-)w-full overflow-hidden|mx-auto w-full/);
  // The room is measured from the layout onto the frame's wrapper, on mount and on resize - a DOM write, no state.
  assert.match(preview, /function useViewerRoom\(ref\) \{\n  useLayoutEffect\(/);
  assert.match(preview, /element\.style\.setProperty\("--editing-viewer-max", `\$\{editingViewerRoom\(\{ paneHeight, frameTop, rem \}\)\}px`\);/);
  assert.match(preview, /window\.addEventListener\("resize", remeasure\);/);
  assert.match(preview, /<div ref=\{areaRef\} className="flex w-full items-center justify-center"/);
  assert.doesNotMatch(preview, /setRoom/, "a DOM write, no state");
  assert.match(preview, /className="relative mx-auto max-w-full overflow-hidden rounded-lg bg-slate-900" style=\{frame\}>\{image\(before, "Before", undefined, measure\)\}/);
  assert.match(preview, /className=\{`relative mx-auto max-w-full overflow-hidden rounded-lg bg-slate-900 \$\{mode === "split"/);
  assert.match(preview, /<div className="grid w-full items-center gap-2 sm:grid-cols-2">/, "the two panels share one size, centred in the region");
  assert.match(preview, /className="absolute inset-0 h-full w-full object-contain/, "the photo is never stretched or cropped");
  // The frame's ratio is the preview's own pixels once they load; the row's dimensions stand in before.
  assert.match(preview, /const measure = \(event\) => \{ const \{ naturalWidth, naturalHeight \} = event\.currentTarget;/);
  assert.match(preview, /style=\{\{ clipPath: `inset\(0 \$\{100 - divider\}% 0 0\)` \}\}>\{image\(before, "Before", undefined, measure\)\}/, "Split keeps its clip-path divider over the full-size Before layer");
  // The way of comparing is the bay's state, kept from photo to photo; the Before / After view stays per photo.
  assert.match(preview, /export default function EditingPreview\(\{ photo, recipe, view, onViewChange, mode = "toggle", onModeChange,/);
  assert.doesNotMatch(preview, /useState\("toggle"\)/);
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.match(workspace, /const \[compareMode, setCompareMode\] = useState\("toggle"\);/);
  assert.match(workspace, /compareMode=\{compareMode\}\n\s+onCompareModeChange=\{setCompareMode\}/);
  assert.match(read("components", "image-selection", "editing", "EditingPanel.js"), /mode=\{compareMode\} onModeChange=\{onCompareModeChange\}/);
});

// The actions sit right under the photo; what the render had to say reads below them, so four
// notes never push Apply or Send to Signature Album out of the window. The notes belong to the
// last render and say so while the sliders have moved since.
test("the editor keeps its actions under the photo and the render's feedback below them", () => {
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  const at = (pattern) => panel.search(pattern);
  const preview = at(/<EditingPreview photo=\{photo\}/);
  const actions = at(/The actions: apply, reset, and where the photo goes next - right under the photo\./);
  for (const [label, pattern] of [["source line", /\{\(sourceLine \|\| sentLine\) && <p/], ["failure", /\{edit\?\.status === "FAILED" && \(edit\.error \|\| localSourceLine\) && \(/], ["waiting", /\{waitingForDesktop && \(\n\s+<div role="status"/], ["notes", /\{notes\.length > 0 && \(/], ["analysis", /\{analysisLine && <p/]]) {
    assert.ok(preview < actions && actions < at(pattern), `${label} reads below the actions`);
  }
  assert.match(panel, /\{dirty \? "Notes from the last render - your changes since are not applied yet" : `Notes from this render \(\$\{notes\.length\}\)`\}/);
  assert.match(panel, /<ul className="mt-1 list-disc space-y-1 break-words pl-4">/, "a long note wraps instead of widening the column");
});

// The three section switches read their state off the recipe and write only their own part of it,
// with each control's own semantics: a tool is on when present, a basic slider is handed to the AI
// (null) rather than given an invented number, and a number the photographer set is never touched.
test("the AI tools, Retouching and Basic adjustments switches follow the recipe and change only their own section", async () => {
  const { normalizeRecipe, RETOUCH_TOOL_IDS: REGIONS } = await import("../src/lib/aiEditingRecipe.mjs");
  const ai = sectionToolIds("ai", null);
  assert.deepEqual(ai, ["retouchFace", "faceEnhance", "denoise", "sharpen", "enhanceSky", "background", "autoCrop"], "Remove Object waits for marks, so its own row keeps it");
  assert.deepEqual(sectionToolIds("retouch", null), [...REGIONS]);
  assert.deepEqual(sectionToolIds("ai", { tools: { background: { available: false } } }).includes("background"), false, "a tool this server cannot run is not switched on");
  let recipe = normalizeRecipe({ style: "classic", tools: { sharpen: { amount: 80 }, lips: { amount: 70 } }, adjustments: { exposure: 0, contrast: 15 } });
  assert.equal(toolSectionState(recipe, ai), "mixed", "one AI tool on of seven");
  assert.equal(toolSectionState(recipe, sectionToolIds("retouch", null)), "mixed");
  const allAi = setToolSection(recipe, ai, true);
  assert.equal(toolSectionState(allAi, ai), "on");
  assert.deepEqual(allAi.tools.sharpen, { amount: 80 }, "a tool already on keeps its settings");
  assert.deepEqual(allAi.tools.denoise, { strength: 50, detail: 60 }, "a tool switched on starts on its defaults");
  assert.deepEqual(allAi.tools.lips, { amount: 70 }, "the AI switch leaves Retouching alone");
  assert.deepEqual(allAi.adjustments, recipe.adjustments, "and the sliders");
  assert.equal(allAi.style, "classic");
  const noAi = setToolSection(allAi, ai, false);
  assert.equal(toolSectionState(noAi, ai), "off");
  assert.deepEqual(Object.keys(noAi.tools), ["lips"]);
  const marks = setToolSection(normalizeRecipe({ tools: { removeObject: { masks: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } } }), ai, false);
  assert.equal(marks.tools.removeObject.masks.length, 1, "painted areas survive the AI switch going off");
  assert.deepEqual(normalizeRecipe(allAi), allAi, "what the switch writes is a normal recipe, saved and rendered as any other");
  // Basic adjustments: contrast was set to 15, exposure left at 0.
  assert.equal(adjustmentSectionState(recipe), "mixed");
  const auto = setAdjustmentSection(recipe, true);
  assert.equal(adjustmentSectionState(auto), "on");
  assert.deepEqual(auto.adjustments, { exposure: null, contrast: 15, highlights: null, shadows: null, whites: null, blacks: null, temperature: null, tint: null, vibrance: 0, saturation: 0 }, "the auto-able sliders go to Auto, the photographer's 15 stays, no number is invented");
  assert.deepEqual(auto.tools, recipe.tools, "the slider switch leaves the tools alone");
  const back = setAdjustmentSection(auto, false);
  assert.deepEqual(back.adjustments, recipe.adjustments, "off puts back exactly what on changed");
  assert.equal(adjustmentSectionState(setAdjustmentSection(normalizeRecipe({ adjustments: { exposure: 20 } }), true)).toString(), "on", "a slider set by hand counts as in use and keeps its number");
  assert.equal(setAdjustmentSection(normalizeRecipe({ adjustments: { exposure: 20 } }), true).adjustments.exposure, 20);
  assert.equal(adjustmentSectionState(normalizeRecipe({})), "off");
  assert.equal(toolSectionState(normalizeRecipe({}), []), "off", "a section covering nothing reads off");
  const controls = read("components", "image-selection", "editing", "EditingControls.js");
  assert.match(controls, /<Section title="AI tools" count=\{aiCount \? `\$\{aiCount\} on` : ""\} open toggle=\{toolToggle\(aiSectionIds,/);
  assert.match(controls, /open=\{retouchOpen\} toggle=\{toolToggle\(retouchSectionIds,/);
  assert.match(controls, /<Section title="Basic adjustments"[^\n]*toggle=\{\{ state: adjustmentSectionState\(recipe\), onChange: \(on\) => onChange\(setAdjustmentSection\(recipe, on\)\)/);
  assert.match(controls, /<ToggleSwitch ariaLabel=\{toggle\.label\} checked=\{toggle\.state === "on"\} mixed=\{toggle\.state === "mixed"\}/);
  assert.match(controls, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/, "the header switch never opens or shuts its fold");
  const toggle = read("components", "shared", "ToggleSwitch.js");
  assert.match(toggle, /const setIndeterminate = \(input\) => \{ if \(input\) input\.indeterminate = Boolean\(mixed\); \};/, "the group switch is announced as mixed");
  assert.match(toggle, /onCheckedChange\?\.\(mixed \? true : event\.target\.checked, event\)/, "a press on a mixed switch means all on");
});

// The editor's frame: Auto Edit and the style stay at the top of the controls while the sections
// scroll; the photo's position row sits under the photo; the viewer region is one fixed height in
// every mode, so nothing below it moves.
test("the controls keep Auto Edit and Style fixed, and the viewer, its navigation and the actions never move", () => {
  const controls = read("components", "image-selection", "editing", "EditingControls.js");
  assert.match(controls, /<div className="flex min-h-0 flex-col gap-3 lg:flex-1">\n      <div className="shrink-0 space-y-3 border-b border-slate-200 pb-3">/);
  assert.match(controls, /<div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">/);
  assert.ok(controls.indexOf('aria-pressed={autoOn}') < controls.indexOf('<div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto') && controls.indexOf('ariaLabel="Style"') < controls.indexOf('<div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto'), "Auto Edit and Style are in the fixed block");
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  assert.match(panel, /<aside className="min-w-0 lg:flex lg:max-h-\[calc\(100vh-14rem\)\] lg:flex-col">/, "the aside bounds the height; only the section list scrolls");
  const preview = panel.indexOf("<EditingPreview photo={photo}");
  const actions = panel.indexOf("The actions: apply, reset, and where the photo goes next");
  const nav = panel.indexOf('ariaLabel="Previous photo"');
  assert.ok(preview < nav && nav < actions, "the position row is under the photo, above the actions");
  assert.ok(panel.indexOf('ariaLabel="Previous photo"') > panel.indexOf("All photos</Button>") + 400, "and not in the header");
  assert.match(panel, /\) : <div className="mt-2 min-h-10 sm:min-h-8" aria-hidden="true" \/>\}/, "the row keeps its height even when the bay cannot place the photo");
  const viewer = read("components", "image-selection", "editing", "EditingPreview.js");
  assert.match(viewer, /<div ref=\{areaRef\} className="flex w-full items-center justify-center" style=\{\{ height: EDITING_VIEWER_MAX_HEIGHT \}\}>/, "one fixed-height region for every mode and orientation");
});

// The chunked original upload is gone from the web too: nothing here sends an original anywhere.
test("the web no longer carries the chunked original upload calls", () => {
  const service = read("services", "image-selection", "image-selection.service.js");
  assert.doesNotMatch(service, /initiateImageUpload|uploadImageChunk|completeImageUpload|XMLHttpRequest/);
  assert.match(service, /export const cancelImageUpload/, "cancel stays - the upload store abandons a hold with it");
});

// Edit Selected, Download Edited and the header without its expand control.
test("Edit Selected walks the ticked photos only, by id, and leaves the ticks as they were", async () => {
  const { editingFocusOrder, editingFocusPosition, editingNavigationTarget } = await import("../src/lib/imageSelectionEditing.mjs");
  const page = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(editingFocusOrder(new Set(["z", "c", "a"]), page), ["a", "c", "z"], "this page's ticks in the bay's order, then one ticked on another page");
  assert.deepEqual(editingFocusOrder(new Set(), page), []);
  const ids = ["a", "c", "z"];
  assert.deepEqual(editingFocusPosition(ids, "c"), { index: 1, total: 3, canPrev: true, canNext: true });
  assert.deepEqual(editingFocusPosition(ids, "z"), { index: 2, total: 3, canPrev: true, canNext: false }, "clamped at the end - nothing wraps");
  assert.equal(editingFocusPosition(ids, "b"), null, "an unticked photo is not in the walk");
  assert.deepEqual(editingFocusPosition(ids, "a", true), { index: 0, total: 3, canPrev: false, canNext: false }, "both moves rest while a photo is fetched");
  assert.equal(ids[editingNavigationTarget("next", 0, ids.length)], "c", "next from a is c, skipping the unticked b");
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.match(workspace, /const target = editingNavigationTarget\(direction, focus\.ids\.indexOf\(open\.id\), focus\.ids\.length\);\n\s+if \(target !== null\) openWalked\(focus\.ids\[target\]\);\n\s+return;/, "while it is on, moves stay inside the walked ids");
  assert.match(workspace, /const response = await getAiEditingPhoto\(projectId, id\); setOpen\(response\.data\);/, "a ticked photo on another page is fetched by id");
  assert.match(workspace, /Edit selected<\/Button>/);
  assert.match(workspace, /Exit selected editing<\/Button>/);
  assert.match(workspace, /const closePhoto = \(\) => \{ setMoving\(false\); setOpen\(null\); setFocus\(null\); onExpandedChange\?\.\(false\); \};/, "leaving ends the walk; the ticks (`selected`) are untouched");
  assert.ok(!/setSelected\(new Set\(\)\)[^\n]*startFocus|startFocus[^\n]*setSelected/.test(workspace), "starting it never clears the ticks");
  assert.match(workspace, /<EditingPhotoGrid photos=\{photos\} selected=\{selected\} onToggle=\{toggle\} onOpen=\{openPhoto\} canSelect \/>/, "anyone who sees the bay can tick, to edit or download");
});

test("Download Edited asks the server, says what is left out, and posts the ticket into a hidden frame - never an original, never the page's memory", async () => {
  const { editedDownloadSummary } = await import("../src/lib/imageSelectionEditing.mjs");
  assert.deepEqual(editedDownloadSummary({ asked: 4, included: [{}, {}], excluded: { notEdited: 1, outdated: 1 } }), {
    included: 2, leftOut: 2, title: "Download 2 edited photos?",
    line: "2 edited photos will be downloaded as one ZIP. 2 not included: 1 not edited, 1 changed since the last Apply.",
  });
  assert.equal(editedDownloadSummary({ asked: 3, included: [], excluded: { notEdited: 3 } }).line, "None of the 3 photos has a saved edit to download (3 not edited). Apply an edit first.");
  assert.equal(editedDownloadSummary({ asked: 1, included: [{}], excluded: {} }).line, "1 edited photo will be downloaded.");
  assert.equal(editedDownloadSummary({ asked: 1, included: [], excluded: { outdated: 1 } }).line, "This photo has no saved edit to download (1 changed since the last Apply). Apply an edit first.");
  const button = read("components", "image-selection", "editing", "EditedDownloadButton.js");
  assert.match(button, /if \(!summary\.included\) \{ onNotice\?\.\(summary\.line, "info"\); return; \}/, "nothing edited: said, nothing downloaded");
  assert.match(button, /if \(summary\.leftOut\) \{ setConfirm\(\{ ticket: data\.ticket, summary \}\); return; \}/, "a mixed selection is asked about first");
  assert.match(button, /if \(working\.current\) return;\n\s+working\.current = true;/, "a double press prepares once");
  const service = read("services", "image-selection", "ai-editing.service.js");
  assert.match(service, /export const planAiEditingDownload = \(projectId, uploadIds\) => apiRequest\(`\$\{base\(projectId\)\}\/downloads\/plan`, \{ method: "POST", body: JSON\.stringify\(\{ uploadIds \}\) \}\);/);
  assert.match(service, /form\.action = `\$\{API_URL\}\$\{base\(projectId\)\}\/downloads\/archive`;\n\s+form\.target = frameName;/, "the browser streams the file itself, into a hidden frame");
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  assert.match(panel, /\{edit\?\.hasOutput && \(\n\s+<EditedDownloadButton\n\s+projectId=\{projectId\}\n\s+uploadIds=\{\[uploadId\]\}\n\s+label="Download edited"\n\s+disabled=\{rendering \|\| waitingForDesktop \|\| dirty \|\| saveState !== "saved"\}/, "the open photo's download waits for its edit to be applied and saved");
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  assert.match(workspace, /<EditedDownloadButton\n\s+projectId=\{projectId\}\n\s+uploadIds=\{\[\.\.\.selected\]\}\n\s+label="Download selected edited"/);
});

test("the AI Editing header has no expand control any more; its status chip stays", () => {
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  for (const gone of ["OpenInFull", "CloseFullscreen", "Edit at full width", "Show the folders and project panel again"]) assert.ok(!workspace.includes(gone), `${gone} is gone`);
  assert.match(workspace, /style=\{progressChipStyle\(engine\.color\)\}/, "the engine's status chip is still drawn");
  assert.match(workspace, /const openPhoto = \(photo\) => \{ rememberScroll\(\); setOpen\(photo\); onExpandedChange\?\.\(true\); \};/, "the editor still takes the full width while a photo is open (and the bay remembers where it was)");
});

test("the bay's header and search stay in view inside the pane's own scroll, and the selection bar takes the theme's surface", () => {
  const workspace = read("components", "image-selection", "editing", "AiEditingWorkspace.js");
  // Sticky inside the tab's scrolling pane (p-5), pulled over its padding - never position: fixed.
  assert.match(workspace, /<div className="sticky -top-5 z-20 -mx-5 -mt-5 mb-3 border-b border-slate-200 bg-white px-5 pb-3 pt-5">/);
  assert.ok(!/\bfixed\b/.test(workspace.split("<EditingPhotoGrid")[0].split("return (\n    <div className=\"w-full\">").pop()), "no fixed positioning in the bay's header");
  const sticky = workspace.slice(workspace.indexOf('className="sticky -top-5'), workspace.indexOf("{capabilities?.engine?.status && capabilities.engine.status"));
  for (const part of ['<h2 className="text-sm font-semibold text-slate-800">AI Editing</h2>', 'placeholder="Search file names"', "Select all loaded", "progressChipStyle(engine.color)"]) assert.ok(sticky.includes(part), `${part} is in the sticky block`);
  // The bar: light classes the [data-theme] rules remap in the dark themes - no hardcoded navy.
  const bar = workspace.slice(workspace.indexOf("{selected.size > 0 && ("));
  assert.match(bar, /sticky bottom-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\] z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-lg/);
  for (const gone of ["bg-slate-800", "bg-white/10", "text-slate-300"]) assert.ok(!bar.includes(gone), `${gone} is gone from the bar`);
  const css = read("app", "globals.css");
  assert.match(css, /\[data-theme="dark"\] \.app-shell \.bg-white,/, "the dark theme remaps the bar's bg-white");
});


test("an enrolled photo's line says where its automatic album sync stands, and the bay keeps polling while one is on its way", async () => {
  const { editingSentLine, editingAlbumSyncFailed, editingNeedsPolling } = await import("../src/lib/imageSelectionEditing.mjs");
  const at = (state) => ({ edit: { albumSync: { state }, sentToAlbum: state === "synced" } });
  assert.equal(editingSentLine(at("waiting")), "Signature Album: updates when you apply an edit");
  assert.equal(editingSentLine(at("rendering")), "Signature Album: updates when this edit is saved");
  assert.equal(editingSentLine(at("pending")), "Signature Album: updating…");
  assert.equal(editingSentLine(at("synced")), "In the Signature Album - this edit");
  assert.equal(editingSentLine(at("failed")), "Signature Album update failed");
  assert.equal(editingSentLine({ edit: { sentToAlbum: true } }), "Sent to Signature Album", "a photo not enrolled keeps the manual send's line");
  assert.equal(editingAlbumSyncFailed(at("failed")), true);
  assert.equal(editingNeedsPolling([{ status: "READY", ...at("pending") }]), true);
  assert.equal(editingNeedsPolling([{ status: "READY", ...at("synced") }]), false);
  const panel = read("components", "image-selection", "editing", "EditingPanel.js");
  assert.match(panel, /\{editingAlbumSyncFailed\(photo\) && canSendToAlbum && \(/, "Retry is offered to who may write the album");
  assert.match(panel, /await retryAiEditingAlbumSync\(projectId, \[uploadId\]\);/);
});

test("the bay and the review are one continuous list: batches append without duplicates, an old question's answer is dropped, no Previous / Next", async () => {
  const { mergeById } = await import("../src/components/shared/useIncrementalPages.js");
  const photos = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: `p${from + i}` }));
  const merged = mergeById(mergeById([], photos(0, 60)), photos(59, 119));
  assert.equal(merged.length, 119);
  assert.equal(new Set(merged.map((p) => p.id)).size, 119, "an overlapping batch never draws a card twice");
  assert.equal(mergeById(merged, photos(59, 119)).length, 119, "a retried batch adds nothing");
  const hook = read("components", "shared", "useIncrementalPages.js");
  assert.match(hook, /if \(loadingMore\.current \|\| !pages\.current \|\| pages\.current \* pageSize >= total\.current\) return null;/, "one batch at a time, never past the end");
  assert.match(hook, /if \(asked !== generation\.current\) return null;/, "an answer to an older folder, search or filter is dropped");
  assert.match(hook, /const shown = Math\.max\(pages\.current, 1\) \* pageSize;/, "a refresh re-reads exactly what is shown, in place");
  for (const [file, name] of [[["components", "image-selection", "editing", "AiEditingWorkspace.js"], "bay"], [["components", "image-selection", "culling", "CullingReviewGallery.js"], "list"]]) {
    const source = read(...file);
    assert.doesNotMatch(source, />Previous<\/Button>|>Next<\/Button>|page \{page\} of \{totalPages\}/);
    assert.match(source, new RegExp(`<IncrementalListFooter list=\\{${name}\\} resetKey=\\{listKey\\} />`));
  }
  const review = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(review, /const listKey = `\$\{sessionId\}\|\$\{filter\}\|\$\{sort\}\|\$\{order\}\|\$\{activeScene\}`;/, "a filter, scene or sort is a new list from the server, never a filter of what is loaded");
  assert.match(review, /updateItems\(\(current\) => current\.map\(\(entry\) => \(entry\.id === item\.id \? response\.data\.result : entry\)\)\);/, "a decision lands in place - no reload, no jump");
  const footer = read("components", "image-selection", "IncrementalListFooter.js");
  assert.match(footer, /useInfiniteScroll\(\{ onLoadMore: loadMore, hasMore: hasMore && !error, loading: loadingMore, count: items\.length, resetKey \}\)/);
  assert.match(footer, />Retry<\/Button>/);
});

