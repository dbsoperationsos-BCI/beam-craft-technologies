import test from "node:test";
import assert from "node:assert/strict";
import { cullingAiStatus, cullingConfidenceBands, cullingFinalizeFigures, cullingReasonGroups, cullingStageSteps, cullingWorkspaceState } from "../src/lib/imageSelectionCulling.mjs";

// The Photo Culling tab draws one state per moment of the lifecycle, from the overview's own
// counts: never one generic empty box, never a number the server did not send.
const counts = (over = {}) => ({ total: 0, ready: 0, processing: 0, uploading: 0, failed: 0, ...over });
const overview = (over = {}) => ({ session: null, readyCount: 0, photoCounts: counts(), ...over });

test("each moment of the lifecycle has its own state", () => {
  assert.equal(cullingWorkspaceState(overview()), "empty");
  assert.equal(cullingWorkspaceState(overview({ photoCounts: counts({ total: 3, uploading: 3 }) })), "uploading");
  assert.equal(cullingWorkspaceState(overview({ photoCounts: counts({ total: 5, uploading: 1, processing: 4 }) })), "processing");
  assert.equal(cullingWorkspaceState(overview({ photoCounts: counts({ total: 2, failed: 2 }) })), "unprocessable");
  assert.equal(cullingWorkspaceState(overview({ readyCount: 8, photoCounts: counts({ total: 10, ready: 8, processing: 2 }) })), "ready");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "QUEUED", analysisSource: "DESKTOP", startedAt: null } })), "waiting");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "ANALYZING" } })), "running");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "REVIEW_READY" } })), "review");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "REVIEW_READY" }, stale: true })), "stale");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "FINALIZED" } })), "finalized");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "FAILED" } })), "failed");
  assert.equal(cullingWorkspaceState(overview({ session: { status: "CANCELLED" }, readyCount: 4 })), "cancelled");
});

test("an older server without photo counts still reads ready or empty from readyCount", () => {
  assert.equal(cullingWorkspaceState({ session: null, readyCount: 4 }), "ready");
  assert.equal(cullingWorkspaceState({ session: null, readyCount: 0 }), "empty");
});

test("the stage list marks done, current, pending and skipped from the run itself", () => {
  const running = cullingStageSteps({ status: "ANALYZING", currentStage: "SCENE" }, { faces: true, scene: true });
  assert.deepEqual(running.map((step) => [step.id, step.state]), [["TECHNICAL_ANALYSIS", "done"], ["FACE_ANALYSIS", "done"], ["SUBJECTS", "done"], ["SCENE", "current"], ["GROUPING", "pending"], ["RANKING", "pending"]]);
  const noEngines = cullingStageSteps({ status: "ANALYZING", currentStage: "TECHNICAL_ANALYSIS" }, { faces: false, scene: false });
  assert.deepEqual(noEngines.map((step) => step.state), ["current", "skipped", "skipped", "skipped", "pending", "pending"]);
  const done = cullingStageSteps({ status: "REVIEW_READY", engineVersions: { serverTechnical: "1.8.0", scene: "clip" } }, { faces: true, scene: true });
  assert.deepEqual(done.map((step) => step.state), ["done", "skipped", "skipped", "done", "done", "done"], "a finished run says what it actually ran");
  const desktop = cullingStageSteps({ status: "REVIEW_READY", engineVersions: { technical: "d", faces: "d" } }, { faces: false, scene: false });
  assert.equal(desktop[1].state, "done", "faces the workstation analyzed count");
  assert.ok(running.every((step) => step.label && !/_/.test(step.label)));
});

test("confidence bands come from the server's counts, or not at all", () => {
  assert.equal(cullingConfidenceBands(null), null);
  const bands = cullingConfidenceBands({ high: 125, medium: 26, low: 3, average: 0.88 });
  assert.deepEqual(bands.bands.map((band) => [band.label, band.count]), [["High", 125], ["Medium", 26], ["Low", 3]]);
  assert.equal(bands.average, "88%");
});

test("reasons split into what speaks for a photo, against it, and notes, in the studio's words", () => {
  const groups = cullingReasonGroups(["SHARP", "BEST_IN_BURST", "SOFT_FOCUS", "LOW_CONFIDENCE", "UNKNOWN_CODE"]);
  assert.deepEqual(groups.positives, ["Sharp", "Best of burst"]);
  assert.deepEqual(groups.concerns, ["Soft focus"]);
  assert.deepEqual(groups.notes, ["Low confidence", "UNKNOWN_CODE"]);
  assert.deepEqual(cullingReasonGroups(null), { positives: [], concerns: [], notes: [] });
});

test("the AI status speaks plainly and uses the progress palette", () => {
  assert.equal(cullingAiStatus("ready").label, "Ready");
  assert.equal(cullingAiStatus("running", { currentStage: "FACE_ANALYSIS" }).label, "Analyzing");
  assert.equal(cullingAiStatus("running", { currentStage: "FACE_ANALYSIS" }).detail, "Face analysis");
  assert.equal(cullingAiStatus("review").label, "Complete");
  assert.equal(cullingAiStatus("finalized").label, "Finalized");
  assert.equal(cullingAiStatus("empty").label, "Waiting for photos");
  assert.match(cullingAiStatus("running").color, /^#/);
});

test("finalize figures are the run's own counts", () => {
  assert.deepEqual(cullingFinalizeFigures({ totalImages: 10, keepCount: 6 }), { total: 10, stay: 6, hidden: 4 });
  assert.deepEqual(cullingFinalizeFigures(null), { total: 0, stay: 0, hidden: 0 });
});

// The folder is the scope; the settings rail is Photo Selection's. AI Culling and AI Editing keep
// the shared folder tree (and its New Folder, dialogs and selection) and draw neither the Photo
// Selection settings rail nor the publish badge, taking the rail's column for the workspace.
test("AI Culling and AI Editing share the folder tree with Photo Selection and carry none of its settings rail", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const workspace = readFileSync(join(process.cwd(), "src", "components", "image-selection", "ImageSelectionProjectWorkspace.js"), "utf8");
  assert.match(workspace, /const railless = activeTab === "culling" \|\| activeTab === "editing";/);
  // Two columns on the processing tabs - the tree and the workspace - one while the review is expanded,
  // three on Photo Selection, two (workspace and rail) on the album.
  assert.match(workspace, /cullingWideActive \? "md:grid-cols-\[minmax\(0,1fr\)\]" : railless \? "md:grid-cols-\[210px_minmax\(0,1fr\)\]" : folderless \? "md:grid-cols-\[minmax\(0,1fr\)_300px\]" : "md:grid-cols-\[210px_minmax\(0,1fr\)_300px\]"/);
  // The tree is drawn on every tab but the album's: the processing tabs are not folderless.
  assert.match(workspace, /const folderless = activeTab === "album";/);
  assert.match(workspace, /\{!folderless && <aside[^>]*>\s*<FolderTree/);
  // The whole right-hand column - album rail, View Invite, settings rail - is absent on the processing tabs.
  assert.match(workspace, /\{!railless && <div className="contents">\s*\{activeTab === "album" \? \(/);
  assert.match(workspace, /<ImageSelectionSettingsPanel[\s\S]*?\/>\s*\)\}\s*<\/div>\}/);
  // So is the client gallery's header badge; the last-write label stays.
  assert.match(workspace, /\{!railless && <GalleryPublication/);
  assert.match(workspace, /\{!collectingSelection && <span className="shrink-0">Updated: \{updatedLabel\}<\/span>\}/);
  // Nothing hidden with CSS and left standing: no md:hidden column on the processing tabs.
  assert.doesNotMatch(workspace, /contents md:hidden/);
});

// Folder-first, as Photo Selection is: the project root is never a culling or editing scope. With
// no folder chosen the two processing tabs show the same guidance box Photo Selection shows, and
// the workspace - its counts, its Start button - appears only for the folder picked in the tree.
test("AI Culling and AI Editing open on a folder-first empty state, never on the whole project", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const workspace = readFileSync(join(process.cwd(), "src", "components", "image-selection", "ImageSelectionProjectWorkspace.js"), "utf8");
  // A viewer is never told to create what they may not: the guidance drops "or create" for them.
  assert.match(workspace, /activeTab === "culling" \? \([\s\S]*?!currentFolder \? \(\s*<div[^>]*>\s*\{canWrite \? "Select or create a folder to start AI Culling\." : "Select a folder to see its AI Culling\."\}\s*<\/div>\s*\) : <CullingWorkspace/);
  assert.match(workspace, /activeTab === "editing" \? \([\s\S]*?!currentFolder \? \(\s*<div[^>]*>\s*\{editingAccess\.canWrite \? "Select or create a folder to start AI Editing\." : "Select a folder to see its AI Editing\."\}\s*<\/div>\s*\) : <AiEditingWorkspace/);
  // The project root is never a scope, so no "Whole project" label is handed to either workspace.
  assert.doesNotMatch(workspace, /"Whole project"/);
  // The workspace is handed the chosen folder, and its header names it as a folder.
  const culling = readFileSync(join(process.cwd(), "src", "components", "image-selection", "culling", "CullingWorkspace.js"), "utf8");
  const editing = readFileSync(join(process.cwd(), "src", "components", "image-selection", "editing", "AiEditingWorkspace.js"), "utf8");
  assert.match(culling, /Folder: \{scopeLabel\}/);
  assert.match(editing, /Folder: \{scopeLabel/);
  // Photo Selection's own folder-first guidance is untouched.
  assert.match(workspace, /Select or create a subfolder to upload and view photos\./);
});
