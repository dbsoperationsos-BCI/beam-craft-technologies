import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CULLING_GROUP_RANKING, CULLING_SHARP_FACE, CULLING_SIGNAL_SCORES, cullingDecisionBasis, cullingSignalValue, cullingGroupOf, cullingGroupTitle, cullingReasonGroups, cullingReasonLabel, cullingSignalNotes } from "../src/lib/imageSelectionCulling.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

// Culling V2, phase 8: the review explains the V2 signals in the studio's words - the photo's own
// quality beside the decision score, the measured face signals, the expression, and where a frame
// stands in a series of similar frames - and the compare view opens a similar series too.
test("a photo's group for the compare view: its duplicate, else its burst, else its similar series", () => {
  assert.deepEqual(cullingGroupOf({ similarGroupId: "s", similarRank: 2 }), { id: "s", type: "SIMILAR", rank: 2, noun: "similar frames" });
  assert.equal(cullingGroupOf({ duplicateGroupId: "d", duplicateRank: 1, burstGroupId: "b", similarGroupId: "s" }).type, "DUPLICATE");
  assert.equal(cullingGroupOf({ burstGroupId: "b", burstRank: 3, similarGroupId: "s" }).rank, 3);
  assert.equal(cullingGroupOf({}), null);
  assert.equal(cullingGroupTitle({ type: "SIMILAR", memberCount: 3 }), "Similar frames — 3 frames");
  assert.equal(cullingGroupTitle({ type: "BURST", memberCount: 2 }), "Burst group — 2 frames");
  assert.equal(cullingGroupTitle({ type: "DUPLICATE", memberCount: 1 }), "Duplicate group — 1 frame");
  assert.match(CULLING_GROUP_RANKING.BURST, /open eyes.*expression/);
  assert.doesNotMatch(CULLING_GROUP_RANKING.BURST, /technical quality first/, "the keeper is no longer sharpness first");
  assert.match(CULLING_GROUP_RANKING.SIMILAR, /never rejected for it/);
  assert.ok(CULLING_GROUP_RANKING.BURST.split(". ").length <= 2, "two short sentences at most");
});

test("the explanation reads the measured face signals and names the expression", () => {
  const keys = CULLING_SIGNAL_SCORES.map(([key]) => key);
  for (const key of ["technicalScore", "faceSharpnessScore", "eyesOpenScore", "expressionScore", "headPoseScore"]) assert.ok(keys.includes(key), key);
  const notes = cullingSignalNotes({ expressionLabel: "happiness", similarGroupId: "s", similarRank: 2, qualityScore: 64, finalScore: 67, preferenceAdjustment: 3 });
  assert.ok(notes.includes("Expression: smiling"), "no score row to sit in: a note");
  assert.ok(notes.includes("#2 among similar frames"));
  assert.ok(notes.includes("Photo quality 64. Your learned taste added 3."));
  assert.deepEqual(cullingSignalNotes({ expressionLabel: "happiness", expressionScore: 82 }), [], "with a score the expression sits in its row");
  assert.equal(cullingSignalValue({ expressionScore: 82.4, expressionLabel: "happiness" }, "expressionScore"), "82, smiling");
  assert.equal(cullingSignalValue({ technicalScore: 70.6 }, "technicalScore"), "71");
  const grouped = cullingSignalNotes({ qualityScore: 60, finalScore: 63, preferenceAdjustment: 0.3 });
  assert.ok(grouped.includes("Photo quality 60. Its place in its group moved the score to 63."), "a taste that rounds to nothing is not named");
  assert.ok(cullingSignalNotes({ qualityScore: 70, finalScore: 66, preferenceAdjustment: -4 }).includes("Photo quality 70. Your learned taste took off 4."));
  assert.deepEqual(cullingSignalNotes({ qualityScore: 70, finalScore: 70 }), [], "nothing to say when the two agree");
  assert.deepEqual(cullingSignalNotes({}), []);
  assert.equal(cullingReasonLabel("ALTERNATE_FRAME"), "Alternate frame");
  assert.ok(cullingReasonGroups(["ALTERNATE_FRAME"]).notes.length === 1, "an alternate is a note, never a concern");
});

test("a blurred frame with sharp faces says why blur did not reject it", () => {
  const basis = cullingDecisionBasis({ aiDecision: "MAYBE", reasonCodes: ["SEVERE_BLUR"], faceSharpnessScore: 70, finalScore: 50 }, { mode: "BALANCED" });
  assert.match(basis, /faces are sharp/);
  assert.equal(cullingDecisionBasis({ aiDecision: "REJECT", reasonCodes: ["SEVERE_BLUR"], faceSharpnessScore: 20, finalScore: 20 }, { mode: "BALANCED" }), "Severe blur.");
});

test("the explanation, the gallery and the compare view use the shared helpers", () => {
  const explanation = read("components", "image-selection", "culling", "CullingPhotoExplanation.js");
  assert.match(explanation, /CULLING_SIGNAL_SCORES/);
  assert.match(explanation, /cullingSignalNotes\(item\)/);
  assert.match(explanation, /cullingSignalValue\(item, key\)/);
  assert.match(explanation, /cullingGroupOf\(item\)/);
  assert.match(read("components", "image-selection", "culling", "CullingReviewGallery.js"), /cullingGroupOf\(item\)/);
  const compare = read("components", "image-selection", "culling", "CullingGroupCompareDialog.js");
  assert.match(compare, /cullingGroupTitle\(group\)/);
  assert.match(compare, /CULLING_GROUP_RANKING/);
});

test("the compare chip keeps its look but takes a 40 px tap: an invisible hit area 8 px above and below its 24 px", () => {
  const gallery = read("components", "image-selection", "culling", "CullingReviewGallery.js");
  const chip = gallery.slice(gallery.indexOf("setCompareGroupId(groupId); }}"), gallery.indexOf("ariaLabel={`Compare the"));
  assert.match(chip, /min-h-6 /, "the chip itself is unchanged");
  assert.match(chip, /relative before:absolute before:-inset-y-2 before:-inset-x-1 before:content-\[''\]/);
});

test("the sharp-face line and the keeper-merit shares match the backend's", () => {
  const backend = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "image-selection", "ai-culling", ...parts), "utf8");
  assert.match(backend("analysis", "scoring.js"), new RegExp(`const SHARP_FACE = ${CULLING_SHARP_FACE};`));
  assert.match(backend("analysis", "duplicates.js"), /const MERIT_WEIGHTS = Object\.freeze\(\{ technical: 0\.35, eyes: 0\.3, expression: 0\.2, face: 0\.15 \}\);/);
  assert.match(read("lib", "imageSelectionCulling.mjs"), /const GROUP_TASTE_DEFAULT = \{ technical: 0\.35, eyes: 0\.3, expression: 0\.2, face: 0\.15 \};/);
});
