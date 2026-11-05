import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AI_MEDIA_ACCEPT, toUploadEntries } from "../src/lib/aiMediaUpload/selectFiles.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

// The AI Feature takes photos only, so its Media tab offers no Photos / Videos choice: the list is
// every row of the folder (an event's older video rows still appear, badged, and can be deleted).
test("the AI Feature Media tab draws no Photos and videos / Videos filter", () => {
  const tab = read("components", "ai-feature", "event", "tabs", "MediaTab.js");
  assert.doesNotMatch(tab, /KIND_OPTIONS|Photos and videos|ariaLabel="Kind"|setKind|changeKind/);
  assert.doesNotMatch(tab, /listAiMedia\([^)]*\bkind\b/, "the list is not asked for one kind");
  assert.match(tab, /<AiMediaUploadWorkspace /, "the upload workspace is still there");
  assert.doesNotMatch(tab, /All Photos shows every folder together/, "All Photos carries no helper banner");
  const workspace = read("components", "ai-feature", "media-upload", "components", "AiMediaUploadWorkspace.js");
  assert.match(workspace, /Photos only \(JPG, PNG, WebP, HEIC\)/);
});

test("picking, a folder and a drop all go through the same photo-only sorting", () => {
  assert.equal(/video/.test(AI_MEDIA_ACCEPT), false);
  const entries = toUploadEntries([
    { name: "a.jpg", size: 1, type: "image/jpeg", webkitRelativePath: "Wedding/a.jpg" },
    { name: "clip.mp4", size: 1, type: "video/mp4", webkitRelativePath: "Wedding/clip.mp4" },
    // A video renamed as a photo still says video by its type; the server decodes every byte anyway.
    { name: "trick.jpg", size: 1, type: "video/quicktime" },
  ]);
  assert.deepEqual(entries.map((entry) => entry.kind), ["photo", "video", "video"]);
});
