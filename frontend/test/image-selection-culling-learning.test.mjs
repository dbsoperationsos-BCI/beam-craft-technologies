import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// Phase 1 on the web: every decision says how it was made, the photos actually seen are recorded
// quietly, and the studio's training consent has its own switch in Settings.
test("each decision path sends how it was made", () => {
  const service = read("services", "image-selection", "image-selection.service.js");
  assert.match(service, /setCullingDecision = \(projectId, sessionId, resultId, decision, source = "UNKNOWN"\)[\s\S]*?JSON\.stringify\(\{ decision, source \}\)/);
  assert.match(service, /bulkCullingDecision = \(projectId, sessionId, resultIds, decision, source = "BULK"\)/);
  assert.match(service, /recordCullingViews = \(projectId, sessionId, resultIds, source\)[\s\S]*?\/views/);
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  for (const source of ["KEY", "PREVIEW_PANEL", "CLICK", "BULK"]) assert.match(gallery, new RegExp(`"${source}"`));
  assert.match(gallery, /inPreview \? "PREVIEW_PANEL" : "KEY"/, "a key pressed inside the preview counts as a preview decision");
  assert.match(read("components", "image-selection", "culling", "CullingGroupCompareDialog.js"), /"COMPARE_DIALOG"/);
});

test("seen photos are recorded once, quietly, by writers only", () => {
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  assert.match(gallery, /useCullingViews\(\{ projectId, sessionId, enabled: canWrite \}\)/);
  // The hook is declared before anything reads it (a read above it crashed the whole tab).
  const declared = gallery.indexOf("const views = useCullingViews");
  assert.ok(declared > 0 && [...gallery.matchAll(/views\./g)].every((match) => match.index > declared));
  assert.ok(gallery.indexOf("const { opened } = views;") > declared);
  assert.match(gallery, /ref=\{views\.observe\}\s*data-culling-result=\{item\.id\}/);
  const hook = read("components", "image-selection", "culling", "useCullingViews.js");
  assert.match(hook, /\.catch\(\(\) => \{\}\)/, "a failed send never interrupts the review");
  assert.match(hook, /sent\.current\[source\]\.has\(resultId\)/, "each photo once per source");
  assert.match(hook, /SEEN_AFTER_MS = 1000/);
  // A tile taller than a phone's screen can never be 60% visible; filling most of the screen counts.
  assert.match(hook, /intersectionRect\.height >= 0\.6 \* entry\.rootBounds\.height/);
});

test("the studio's training consent is its own section, saved by its own switch", () => {
  const config = read("constants", "formPanelConfig.js");
  assert.match(config, /id: "culling-training"[\s\S]*?name: "cullingTrainingSettings", type: "custom"/);
  assert.match(read("components", "image-selection", "ImageSelectionSettingsForm.js"), /cullingTrainingSettings: \(\) => <CullingTrainingConsentField \/>/);
  const field = read("components", "image-selection", "CullingTrainingConsentField.js");
  assert.match(field, /Photos never leave the server/);
  // Only someone who may change it sees the switch; turning it on is confirmed, turning it off is not.
  assert.match(field, /useModuleAccess\("SETTINGS", "Organization"\)/);
  assert.match(field, /\{canWrite && \(\s*<ToggleSwitch/);
  assert.match(field, /<ConfirmDialog[\s\S]*?confirmLabel="Turn on training"/);
  assert.match(field, /if \(next\) \{ setConfirming\(true\); return; \}/);
  assert.match(field, />Try again</, "a failed load can be retried");
  assert.match(field, /Turned \$\{consent\.consent \? "on" : "off"\} by/);
  // The studio's words, not the registry's.
  assert.doesNotMatch(field, /ranker|Shadow trial|held-out|coded ids|\.name\}@/);
  assert.doesNotMatch(field, /artifactPath/);
  assert.match(read("services", "image-selection", "culling-learning.service.js"), /\/api\/image-selection\/culling-learning/);
});
