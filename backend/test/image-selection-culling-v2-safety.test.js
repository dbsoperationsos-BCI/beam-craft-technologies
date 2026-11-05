const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { scorePhoto } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { finalizePlan } = require("../src/modules/image-selection/ai-culling/service");

/*
 * Production readiness: a closed-eyes reading (a sleeping newborn is the known false positive)
 * can only move a recommendation. It never rejects a sharp photo in Balanced on its own, nothing
 * the analysis does finalizes a run, finalizing asks before hiding anything undecided, and
 * finalizing hides - it never deletes or moves a photo - so every AI call stays reversible.
 */
const AI = path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling");
const newborn = (over) => ({ technicalScore: 80, faceCount: 1, faceQualityScore: 75, eyesOpenScore: 0, expressionScore: 50, reasonCodes: ["SHARP", "PRIMARY_SUBJECT_BLINK"], ...over });

test("a sharp photo whose subject's eyes read closed is never rejected in Balanced for that alone", () => {
  for (let technical = 65; technical <= 100; technical += 5) {
    for (let face = 70; face <= 100; face += 10) {
      for (let expression = 0; expression <= 100; expression += 25) {
        const verdict = scorePhoto(newborn({ technicalScore: technical, faceQualityScore: face, expressionScore: expression }), "BALANCED");
        assert.notEqual(verdict.aiDecision, "REJECT", `technical ${technical}, face ${face}, expression ${expression}: ${verdict.finalScore}`);
      }
    }
  }
  // The blink is one weighted term, never a rule of its own: open against closed eyes moves the score at most 20 points.
  const open = scorePhoto(newborn({ eyesOpenScore: 100, reasonCodes: ["SHARP", "EYES_OPEN"] }), "BALANCED");
  const closed = scorePhoto(newborn(), "BALANCED");
  assert.ok(open.finalScore - closed.finalScore <= 20 + 1e-9, `${open.finalScore} vs ${closed.finalScore}`);
});

test("nothing the analysis runs can finalize: only the photographer's finalize call stamps photos", () => {
  const files = ["service.js", "worker.js", "repository.js"].map((name) => [name, fs.readFileSync(path.join(AI, name), "utf8")]);
  const service = files[0][1];
  assert.equal((service.match(/repo\.finalizeSession\(/g) || []).length, 1, "one caller");
  const finalizeAt = service.indexOf("async finalize(projectId, sessionId");
  assert.ok(finalizeAt > 0 && service.indexOf("repo.finalizeSession(") > finalizeAt, "and it is the finalize method behind POST /finalize");
  assert.doesNotMatch(files[1][1], /finalizeSession|\.finalize\(/, "the worker never finalizes (failSession only marks a run FAILED)");
  for (const [name, text] of files) assert.doesNotMatch(text, /imageSelectionUpload\.(delete|deleteMany)\(/, `${name} never deletes a photo`);
});

test("finalizing asks before hiding Maybe or undecided photos, and refuses to hide everything", () => {
  const session = { status: "REVIEW_READY", totalImages: 10, keepCount: 4, maybeCount: 3, rejectCount: 2 };
  assert.throws(() => finalizePlan({ session, published: false, acknowledge: false }), (error) => error.status === 409 && error.details?.requiresAcknowledgement === true || error.requiresAcknowledgement === true || /confirmation/.test(error.message));
  assert.equal(finalizePlan({ session, published: false, acknowledge: true }), true);
  assert.throws(() => finalizePlan({ session: { ...session, keepCount: 0 }, published: false, acknowledge: true }), /at least one photo Keep/);
});
