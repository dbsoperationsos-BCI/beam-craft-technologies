const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const profile = require("../src/modules/image-selection/ai-culling/scene/profile");
const { coverageSession } = require("../src/modules/image-selection/ai-culling/analysis/coverage");
const { featuresOf } = require("../src/modules/image-selection/ai-culling/analysis/preferences");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Production readiness: a scene counts toward decisions only when it was validated. Measured on
 * the 154 hand-labelled real photos at the "sure" confidence (0.4): Couple 36/38, Bride portrait
 * 16/18, Family 8/8, Group 10/10, Details 12/13, Kids 24/30 hold up; Ceremony was called 11 times
 * and wrong every time (the set holds no ceremony), Getting ready 0/4, Groom portrait 0/3, Food
 * 0/3, Emotional 0/1, Stage 2/4, the rest never called. An unvalidated scene is still shown as the
 * AI's guess and still filterable - its confidence is never altered - but it guarantees nothing in
 * Target Count, is not counted by the coverage line, and never becomes a learned taste.
 */
const VALIDATED = ["COUPLE", "BRIDE_PORTRAIT", "FAMILY", "GROUP", "DETAILS", "KIDS"];

test("the profile records which scenes the calibration validated, and how", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "scene", "profiles", "event.json"), "utf8"));
  assert.deepEqual(raw.scenes.filter((scene) => scene.validated).map((scene) => scene.id).sort(), [...VALIDATED].sort());
  assert.match(raw.calibration.method, /154/);
  assert.equal(raw.calibration.results.CEREMONY, "0/11");
  for (const id of ["CEREMONY", "EMOTIONAL", "GETTING_READY", "GROOM_PORTRAIT", "FOOD", "STAGE"]) assert.ok(profile.unvalidatedSceneIds().includes(id), id);
  assert.ok(!profile.unvalidatedSceneIds().includes("ACCIDENTAL"), "the accidental scene has its own, stricter rule");
  assert.deepEqual(profile.uncountedSceneIds().sort(), [...profile.unvalidatedSceneIds(), ...profile.accidentalSceneIds()].sort());
});

test("an unvalidated scene guarantees nothing in Target Count; a validated one still does", () => {
  const at = new Date(Date.UTC(2026, 5, 24, 10));
  let next = 0;
  const row = (score, scene) => ({ id: `p${(next += 1)}`, technicalScore: score, faceCount: 0, reasonCodes: [], folderId: "f", capturedAt: at, userDecision: null, sceneLabel: scene, sceneConfidence: 0.9 });
  const many = Array.from({ length: 10 }, () => row(90, "COUPLE"));
  const ceremony = row(40, "CEREMONY");
  const details = row(41, "DETAILS");
  const { updates } = coverageSession([...many, ceremony, details], 3, { unvalidatedScenes: profile.unvalidatedSceneIds() });
  const of = (photo) => updates.find((update) => update.id === photo.id);
  assert.equal(of(ceremony).aiDecision === "KEEP", false, "no guarantee from a scene that was wrong every time it was measured");
  assert.equal(of(details).aiDecision, "KEEP");
  assert.ok(of(details).rankingCodes.includes(REASON_CODES.COVERS_SCENE));
});

test("an unvalidated scene never becomes a learned taste", () => {
  assert.deepEqual(featuresOf({ reasonCodes: ["PRIMARY_SUBJECT_BLINK"], sceneLabel: "CEREMONY", sceneConfidence: 0.95 }), ["PRIMARY_SUBJECT_BLINK"]);
  assert.deepEqual(featuresOf({ reasonCodes: ["PRIMARY_SUBJECT_BLINK"], sceneLabel: "KIDS", sceneConfidence: 0.95 }).sort(), ["PRIMARY_SUBJECT_BLINK", "PRIMARY_SUBJECT_BLINK@KIDS", "scene:KIDS"].sort());
});

test("the coverage line and the ranking stage leave unvalidated scenes out; the scene picker keeps them", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  assert.match(source, /repo\.coverageCounts\(session\.id, profile\.uncountedSceneIds\(\)\)/);
  assert.match(source, /repo\.countScenes\(session\.id, profile\.accidentalSceneIds\(\)\)/, "still filterable, as the AI's guess");
  assert.match(source, /coverageSession\([^\n]*unvalidatedScenes/);
});
