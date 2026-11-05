import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CULLING_IMPORT_DEFAULT_MODE, cullingAiStatus, cullingImportEta, cullingImportProgress, cullingImportStatus, cullingImporting, cullingWaitingForDesktop, cullingWorkspaceState } from "../src/lib/imageSelectionCulling.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...parts) => fs.readFileSync(path.join(here, "..", "src", ...parts), "utf8");

/*
 * A culling run that begins with the import (the desktop drops a folder once): the web reads the
 * same state and draws the same progress rule - settled units, never an average of percentages -
 * from the server's counts alone, and hands such a run over only by force.
 */
test("a run that began with the import is its own moment, before waiting and running", () => {
  const session = { status: "QUEUED", awaitsUploads: true, startedAt: null, analysisSource: "DESKTOP" };
  assert.equal(cullingImporting(session), true);
  assert.equal(cullingWaitingForDesktop(session), true, "it is also the desktop's to analyze");
  assert.equal(cullingWorkspaceState({ session, photoCounts: { total: 54, ready: 3, processing: 2, uploading: 49, failed: 0 } }), "importing", "importing wins over waiting");
  assert.equal(cullingWorkspaceState({ session: { ...session, analysisSource: "SERVER" } }), "importing", "whichever side analyzes");
  assert.equal(cullingWorkspaceState({ session: { ...session, startedAt: "2026-10-10T00:00:00Z" } }), "running", "handed over");
  assert.equal(cullingWorkspaceState({ session: { ...session, awaitsUploads: false } }), "waiting", "a plain desktop run is unchanged");
  assert.equal(cullingAiStatus("importing").label, "Importing");
  assert.equal(CULLING_IMPORT_DEFAULT_MODE, "BALANCED");
});

test("the import's progress is settled units over the whole pipeline: three per photo when the workstation analyzes, two when the server will, the last filled by the server's own pass", () => {
  const importing = { analyzed: 10, inFlight: 33, ready: 20, settled: false };
  const counts = { ready: 20, processing: 3, uploading: 30, failed: 1 };
  const waiting = { status: "QUEUED", awaitsUploads: true, startedAt: null };
  const local = cullingImportProgress({ importing, counts, localAnalysis: true, session: waiting });
  assert.equal(local.total, 54, "the server's counts are the whole story on the web");
  assert.equal(local.uploaded, 20);
  assert.equal(local.landed, 21);
  assert.equal(local.analyzed, 10);
  assert.equal(local.unitsPerPhoto, 3);
  assert.equal(local.percent, Math.floor(((21 + 11) / 162) * 100));
  assert.equal(local.complete, false);
  assert.equal(local.handedOver, false);
  const handed = cullingImportProgress({ counts: { ready: 154 }, localAnalysis: true, session: { status: "ANALYZING", awaitsUploads: true, startedAt: "2026-10-10T00:00:00Z", totalImages: 154, processedImages: 154, progressPercent: 60, currentStage: "SCENE" } });
  assert.equal(handed.total, 154, "from the hand-over the run's scope is the total");
  assert.equal(handed.stage, "SCENE");
  assert.equal(handed.percent, Math.floor(((154 + 154 + 92.4) / 462) * 100));
  assert.equal(cullingImportStatus(handed), "Finishing");
  assert.equal(cullingImportProgress({ counts: { ready: 54 }, localAnalysis: true, session: { status: "ANALYZING", startedAt: "2026-10-10T00:00:00Z", totalImages: 54, processedImages: 54, progressPercent: 100, currentStage: "RANKING" } }).percent, 99, "only a run at its review is 100");
  const server = cullingImportProgress({ importing: { analyzed: 0, inFlight: 0, ready: 53, settled: true }, counts: { ready: 53, processing: 0, uploading: 0, failed: 1 }, localAnalysis: false, session: { status: "REVIEW_READY", awaitsUploads: true, startedAt: "2026-10-10T00:00:00Z", totalImages: 53, processedImages: 53, progressPercent: 100 } });
  assert.equal(server.unitsPerPhoto, 2);
  assert.equal(server.percent, 100);
  assert.equal(server.complete, true);
  assert.equal(cullingImportStatus(server), "Ready, with failures");
  assert.equal(cullingImportProgress({}).percent, 0, "nothing known is 0, never NaN");
  assert.equal(cullingImportEta(server, 0, 60_000), null, "a finished import has no time left");
  assert.equal(cullingImportEta(cullingImportProgress({ run: { total: 100, compressed: 40, ready: 30, duplicates: 0, failed: 0, status: "RUNNING" }, localAnalysis: false }), 1000, 3000), null, "no estimate before a rate is known");
});

test("the web workspace draws the import panel in that state and hands such a run over only by force", () => {
  const workspace = src("components", "image-selection", "culling", "CullingWorkspace.js");
  assert.match(workspace, /\{state === "importing" && \(\n\s+<CullingImportPanel overview=\{overview\} session=\{session\} canWrite=\{canWrite\} busy=\{busy\} onHandOver=\{\(\) => setConfirmAction\(\{ type: "handOver" \}\)\} onCancelRun=\{\(\) => setConfirmAction\(\{ type: "cancelRun" \}\)\} \/>/, "both actions confirm first, with the counts");
  assert.match(workspace, /confirmAction\?\.type === "handOver"/);
  assert.match(workspace, /confirmAction\?\.type === "cancelRun"/);
  assert.match(workspace, /runCullingSession\(projectId, session\.id, \{ force: cullingImporting\(session\) \}\)/);
  const panel = src("components", "image-selection", "culling", "CullingImportPanel.js");
  assert.match(panel, /cullingImportProgress\(\{ importing: overview\?\.importing, counts: overview\?\.photoCounts, localAnalysis, session \}\)/);
  assert.doesNotMatch(panel, /<button|<input|<select/, "the shared Button only");
  assert.match(panel, /<ProgressBar percent=\{progress\.percent\} label="Import and AI analysis progress"/, "the shared bar, named");
  assert.match(panel, /\{progress\.failed > 0 && <Figure label="Could not be processed"/, "a figure that does not apply is left out");
  const service = src("services", "image-selection", "image-selection.service.js");
  assert.doesNotMatch(service, /updateCullingSession/, "the web changes no run's mode; the desktop does");
  assert.match(service, /runCullingSession = \(projectId, sessionId, \{ force = false \} = \{\}\)/);
});
