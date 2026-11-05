import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CULLING_SCORE_LINES, cullingDecisionBasis } from "../src/lib/imageSelectionCulling.mjs";

// What the AI's call rested on, said only when the backend's own rules and the photo's stored
// fields show it; a call those fields cannot explain gets no sentence rather than an invented one.
const balanced = { mode: "BALANCED" };
const photo = (over = {}) => ({ aiDecision: "MAYBE", finalScore: 50, reasonCodes: [], duplicateGroupId: null, burstGroupId: null, isGroupBest: false, ...over });

test("the score lines are the backend's, kept identical by this test", () => {
  const scoring = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "modules", "image-selection", "ai-culling", "analysis", "scoring.js"), "utf8");
  for (const [mode, lines] of Object.entries(CULLING_SCORE_LINES)) {
    assert.match(scoring, new RegExp(`\\[MODES\\.${mode}\\]: \\{ reject: ${lines.reject}, keep: ${lines.keep} \\}`), mode);
  }
});

test("a decision made by the score says which line it crossed", () => {
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", finalScore: 31 }), balanced), /31 is below Balanced's Reject line of 40/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "KEEP", finalScore: 80 }), balanced), /80 reaches Balanced's Keep line of 62/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "MAYBE", finalScore: 50 }), { mode: "STRICT" }), /between Strict's Reject line \(50\) and Keep line \(70\)/);
});

test("a decision made by a rule names the rule", () => {
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", duplicateGroupId: "g", reasonCodes: ["DUPLICATE"] }), balanced), /Another frame of this duplicate/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", burstGroupId: "b" }), { mode: "STRICT" }), /Strict keeps only the best frame of a burst/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", finalScore: 55, reasonCodes: ["SEVERE_BLUR"] }), balanced), /Severe blur/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "MAYBE", reasonCodes: ["ANALYSIS_FAILED"] }), balanced), /could not be measured/);
  // A photo the workstation could not open from the original is stamped, not measured from its
  // preview in the original's place: the AI leaves it to the photographer, and the sentence says
  // what to do about it. The same words sit in the desktop's cullingState.js.
  const localSourceLine = "The original could not be opened on the workstation, so the AI leaves this one to you. Reconnect the storage drive or NAS (or remap its storage root) in the desktop app and run again to measure it.";
  for (const code of ["LOCAL_SOURCE_UNAVAILABLE", "LOCAL_SOURCE_CHANGED", "LOCAL_SOURCE_UNREADABLE"]) {
    assert.equal(cullingDecisionBasis(photo({ aiDecision: "MAYBE", reasonCodes: ["ANALYSIS_FAILED", code] }), balanced), localSourceLine, code);
  }
  // Whatever the scoring then landed on, the code is the reason: a Keep or Reject carrying it says so too.
  assert.equal(cullingDecisionBasis(photo({ aiDecision: "KEEP", finalScore: 80, reasonCodes: ["LOCAL_SOURCE_UNAVAILABLE"] }), balanced), localSourceLine);
  assert.equal(cullingDecisionBasis(photo({ aiDecision: "REJECT", finalScore: 20, reasonCodes: ["ANALYSIS_FAILED", "LOCAL_SOURCE_CHANGED"] }), balanced), localSourceLine);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "KEEP" }), { mode: "TARGET_COUNT", targetCount: 40 }), /one of the 40/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT" }), { mode: "TARGET_COUNT", targetCount: 40 }), /outside the 40/);
});

test("a call the stored fields cannot explain says the group changed since, or nothing", () => {
  // Rejected as a duplicate when the run ranked it; the photographer has since made it the best.
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", finalScore: 46, duplicateGroupId: "g", isGroupBest: true }), balanced), /best frame has changed since/);
  assert.equal(cullingDecisionBasis(photo({ aiDecision: "REJECT", finalScore: 46 }), balanced), null);
  assert.equal(cullingDecisionBasis(photo({ aiDecision: null }), { mode: "ASSISTED" }), null);
});

test("a run decided by the studio's trained model says so in the studio's words, not the fixed score lines", () => {
  const learned = { mode: "BALANCED", engineVersions: { ranker: "culling-ranker@1.0.0" } };
  const basis = cullingDecisionBasis(photo({ aiDecision: "KEEP", finalScore: 80 }), learned);
  assert.match(basis, /^Scored 80 by the culling model trained on this studio's own Keep and Reject decisions \(version 1\.0\.0\)\.$/);
  assert.doesNotMatch(basis, /ranker|culling-ranker@/, "no internal names");
  assert.doesNotMatch(cullingDecisionBasis(photo({ aiDecision: "KEEP", finalScore: 80 }), learned), /Keep line of 62/);
  assert.match(cullingDecisionBasis(photo({ aiDecision: "REJECT", duplicateGroupId: "g" }), learned), /Another frame of this duplicate/, "the rules still name themselves");
});
