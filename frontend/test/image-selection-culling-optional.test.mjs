import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CULLING_FAILED_ASSURANCE } from "../src/lib/imageSelectionCulling.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// AI Culling is optional: a run that fails hides nothing, and the photographer can carry on in
// Photo Selection or start again - never stuck behind a failed cull.
test("a failed run says it changed nothing and offers a new run as the one way on", () => {
  assert.match(CULLING_FAILED_ASSURANCE, /This run changed nothing/);
  assert.doesNotMatch(CULLING_FAILED_ASSURANCE, /without culling/, "there is no way past AI Culling");
  const workspace = read("components", "image-selection", "culling", "CullingWorkspace.js");
  const failed = workspace.slice(workspace.indexOf('{state === "failed" && ('), workspace.indexOf('{state === "cancelled"'));
  assert.match(failed, /CULLING_FAILED_ASSURANCE/);
  assert.doesNotMatch(failed, /Photo Selection/, "a failed run never points at Photo Selection");
  assert.match(workspace, /state === "failed"[^\n]*\n?[\s\S]*?startControls/, "a new run can still be started below");
});

// The final delivery comes from the originals; one that is missing is named with where its record
// says it lives, and every other photo is still saved.
test("a download names every missing original and where it was expected, and saves the rest", () => {
  const button = read("components", "image-selection", "DownloadSelectedButton.js");
  assert.match(button, /missing\.push\(\{ fileName: image\.fileName, path: /);
  assert.match(button, /continue;/, "a missing file never stops the copy");
  assert.match(button, /<MissingOriginalsDialog items=\{missingList\}/);
  assert.match(button, />View Missing</, "the button reads View Missing - the count stays in the dialog, not on the label");
  assert.doesNotMatch(button, /See missing/);
  const dialog = read("components", "image-selection", "MissingOriginalsDialog.js");
  assert.match(dialog, /Original file missing: \{item\.fileName\}/);
  assert.match(dialog, /\{item\.path\}/);
  assert.match(dialog, /import Dialog from "@\/components\/ui\/Dialog"/);
  // A narrow header holds two controls at most: with originals missing, the remedy (locate the
  // folder again) lives in the dialog beside the list, not as a third button in the row.
  assert.match(button, /\{needsSource && !missingList\.length && \(/);
  assert.match(button, /onLocate=\{needsSource \? /);
  assert.match(dialog, /onLocate && <Button[^>]*>Locate Photo Folder<\/Button>/);
  assert.match(dialog, /key=\{`\$\{index\}:\$\{item\.path\}`\}/, "two rows with one path never collide");
});

test("the face v2 badges are named in the studio's words and read as concerns", async () => {
  const { cullingReasonGroups } = await import("../src/lib/imageSelectionCulling.mjs");
  const groups = cullingReasonGroups(["HALF_CLOSED_EYES", "LOOKING_AWAY"]);
  assert.deepEqual(groups.concerns, ["Eyes half closed or looking down", "Looking away"]);
});
