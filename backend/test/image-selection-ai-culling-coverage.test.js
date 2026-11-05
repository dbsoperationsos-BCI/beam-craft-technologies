const test = require("node:test");
const assert = require("node:assert/strict");
const { coverageSession, folderQuotas } = require("../src/modules/image-selection/ai-culling/analysis/coverage");
const { createPhashSimilarityProvider, activeSimilarityProvider } = require("../src/modules/image-selection/ai-culling/analysis/similarity");
const { buildGroups } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");

/**
 * The story-coverage layer, pinned over synthetic weddings. The promise under test is the one
 * the product forbids breaking: a global top-N must never keep every portrait and drop the
 * ceremony. Quotas are derived, never hardcoded — these tests assert proportions and floors,
 * not magic numbers.
 */

let counter = 0;
function photo({ folder = "f1", score = 70, at = null, userDecision = null, duplicateGroupId = null, isGroupBest = false } = {}) {
  counter += 1;
  return {
    id: `r${String(counter).padStart(4, "0")}`,
    folderId: folder,
    capturedAt: at,
    reasonCodes: [],
    technicalScore: score,
    faceCount: null,
    faceQualityScore: null,
    eyesOpenScore: null,
    expressionScore: null,
    isGroupBest,
    duplicateGroupId,
    burstGroupId: null,
    userDecision,
  };
}
const hour = (offset) => new Date(Date.UTC(2026, 7, 30, 8 + offset, 15)).toISOString();
const keeps = (updates) => updates.filter((update) => update.aiDecision === "KEEP");

// ---------------------------------------------------------------------------
// folderQuotas
// ---------------------------------------------------------------------------
test("quotas are proportional, sum exactly to the target, and floor every folder at one", () => {
  const quotas = folderQuotas(new Map([["prep", 900], ["ceremony", 2500], ["reception", 2600]]), 600);
  assert.equal([...quotas.values()].reduce((sum, value) => sum + value, 0), 600);
  assert.equal(quotas.get("prep"), 90);
  assert.equal(quotas.get("ceremony"), 250);
  assert.equal(quotas.get("reception"), 260);
  // A tiny folder is never starved to zero by a huge one.
  const floored = folderQuotas(new Map([["detail", 3], ["reception", 997]]), 10);
  assert.ok(floored.get("detail") >= 1);
  assert.equal([...floored.values()].reduce((sum, value) => sum + value, 0), 10);
});

test("a quota never exceeds what the folder actually holds", () => {
  const quotas = folderQuotas(new Map([["a", 2], ["b", 100]]), 50);
  assert.ok(quotas.get("a") <= 2);
  assert.equal([...quotas.values()].reduce((sum, value) => sum + value, 0), 50);
});

// ---------------------------------------------------------------------------
// coverageSession — the anti-"global top N" guarantee
// ---------------------------------------------------------------------------
test("high-scoring portraits cannot starve the ceremony: keeps follow the quotas, not the global order", () => {
  const rows = [
    ...Array.from({ length: 40 }, () => photo({ folder: "portraits", score: 95 })),
    ...Array.from({ length: 40 }, () => photo({ folder: "ceremony", score: 60 })),
  ];
  const { updates, counts } = coverageSession(rows, 20);
  assert.equal(counts.keep, 20);
  const ceremonyKeeps = keeps(updates).filter((update) => rows.find((row) => row.id === update.id).folderId === "ceremony");
  assert.equal(ceremonyKeeps.length, 10, "half the target belongs to the ceremony, whatever the scores say");
});

test("every non-empty hour of the story keeps its best frame, badged UNIQUE_FRAME when score alone would have dropped it", () => {
  // One folder: 9 strong frames at 8am, one modest frame at 11pm — the last dance.
  const rows = [
    ...Array.from({ length: 9 }, () => photo({ score: 90, at: hour(0) })),
    photo({ score: 40, at: hour(15) }),
  ];
  const lastDance = rows[9];
  const { updates } = coverageSession(rows, 5);
  const kept = keeps(updates);
  assert.equal(kept.length, 5);
  const rescued = kept.find((update) => update.id === lastDance.id);
  assert.ok(rescued, "the story beat survives the score cut");
  assert.ok(rescued.rankingCodes.includes("UNIQUE_FRAME"));
  // Frames that made it on score alone carry no coverage badge.
  assert.ok(kept.filter((update) => update.id !== lastDance.id).every((update) => !update.rankingCodes.includes("UNIQUE_FRAME")));
});

test("redundant duplicates are rejected first and never spend the target", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => photo({ score: 80 })),
    ...Array.from({ length: 4 }, () => photo({ score: 99, duplicateGroupId: "g1" })),
    photo({ score: 99, duplicateGroupId: "g1", isGroupBest: true }),
  ];
  const { updates, counts } = coverageSession(rows, 5);
  assert.equal(counts.keep, 5);
  for (const update of updates.filter((entry) => { const row = rows.find((candidate) => candidate.id === entry.id); return row.duplicateGroupId && !row.isGroupBest; })) {
    assert.equal(update.aiDecision, "REJECT");
    assert.equal(update.confidence, 0.9);
  }
  // The group's best frame competes normally and, at 99, wins a slot.
  const best = updates.find((entry) => rows.find((candidate) => candidate.id === entry.id).isGroupBest);
  assert.equal(best.aiDecision, "KEEP");
});

test("just past the cut is MAYBE, far past is a confident REJECT, and boundary confidence reads low", () => {
  const rows = Array.from({ length: 30 }, (_, index) => photo({ score: 90 - index * 2 }));
  const { updates, counts } = coverageSession(rows, 10);
  assert.equal(counts.keep, 10);
  assert.equal(counts.maybe, 3, "the one-more-pass band");
  assert.equal(counts.reject, 17);
  const maybes = updates.filter((update) => update.aiDecision === "MAYBE");
  assert.ok(maybes.every((update) => update.rankingCodes.includes("LOW_CONFIDENCE")));
  const rejects = updates.filter((update) => update.aiDecision === "REJECT");
  assert.ok(Math.max(...rejects.map((update) => update.confidence)) > Math.min(...rejects.map((update) => update.confidence)), "confidence grows with distance from the cut");
});

test("the photographer's override rides through coverage and the counts follow it", () => {
  const rows = [photo({ score: 95 }), photo({ score: 10, userDecision: "KEEP" }), photo({ score: 90 })];
  const { updates, counts } = coverageSession(rows, 2);
  const rescued = updates.find((update) => update.id === rows[1].id);
  assert.equal(rescued.effectiveDecision, "KEEP");
  // Culling V2: the target is the size of the selection - the photographer's rescue takes one of
  // its slots, and the AI fills the rest.
  assert.equal(counts.keep, 2, "the photographer's rescue plus the AI's one remaining pick");
  assert.equal(updates.find((update) => update.id === rows[0].id).effectiveDecision, "KEEP");
});

// ---------------------------------------------------------------------------
// Similarity provider abstraction
// ---------------------------------------------------------------------------
test("grouping runs on the similarity interface, so a different provider changes what chains", () => {
  const near = [
    { resultId: "a", uploadId: "ua", folderId: "f", capturedAt: hour(0), fileName: "1", perceptualHash: "0000000000000000", technicalScore: 70 },
    { resultId: "b", uploadId: "ub", folderId: "f", capturedAt: hour(0), fileName: "2", perceptualHash: "00000000000000ff", technicalScore: 70 },
  ];
  // Default pHash provider: 8 bits apart — a burst, not a duplicate.
  assert.deepEqual(buildGroups(near).map((plan) => plan.type), ["BURST"]);
  // A provider that calls everything identical turns the same pair into a duplicate too.
  const everythingAlike = { ...createPhashSimilarityProvider(), name: "test-alike", distance: () => 0 };
  assert.deepEqual(buildGroups(near, everythingAlike).map((plan) => plan.type).sort(), ["BURST", "DUPLICATE"]);
  assert.equal(activeSimilarityProvider().name, "phash-64");
});

// ---------------------------------------------------------------------------
// Story coverage v2: key people and scenes are guaranteed before hours, then score fills.
// ---------------------------------------------------------------------------
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");
const v2 = (overrides) => ({ ...photo(overrides), sceneLabel: overrides.scene ?? null, sceneConfidence: overrides.sceneConfidence ?? (overrides.scene ? 0.8 : null), subjectPersonId: overrides.person ?? null, reasonCodes: overrides.codes || (overrides.person ? [REASON_CODES.KEY_PEOPLE_PRESENT] : []) });
const kept = (updates, row) => updates.find((update) => update.id === row.id).aiDecision === "KEEP";
const codesOf = (updates, row) => updates.find((update) => update.id === row.id).rankingCodes;

test("every key person keeps their best frame, even when their frames score low", () => {
  const portraits = Array.from({ length: 30 }, () => v2({ score: 90, at: hour(1), scene: "COUPLE" }));
  const grandma = [v2({ score: 40, at: hour(1), scene: "COUPLE", person: "grandma" }), v2({ score: 45, at: hour(1), scene: "COUPLE", person: "grandma" })];
  const { updates } = coverageSession([...portraits, ...grandma], 5);
  assert.ok(kept(updates, grandma[1]), "her better frame is kept");
  assert.ok(!kept(updates, grandma[0]), "one frame of her is enough");
  assert.ok(codesOf(updates, grandma[1]).includes(REASON_CODES.COVERS_PERSON));
  assert.equal(keeps(updates).length, 5, "the target still holds");
});

test("every scene of a folder keeps its best frame before the hours and the score fill", () => {
  const ceremony = Array.from({ length: 20 }, () => v2({ score: 85, at: hour(2), scene: "GROUP" }));
  const decor = v2({ score: 50, at: hour(2), scene: "KIDS" });
  const details = v2({ score: 55, at: hour(2), scene: "DETAILS" });
  const { updates } = coverageSession([...ceremony, decor, details], 4);
  assert.ok(kept(updates, decor) && kept(updates, details), "the quiet moments are in the story");
  assert.ok(codesOf(updates, decor).includes(REASON_CODES.COVERS_SCENE));
  assert.equal(keeps(updates).length, 4);
});

test("an unsure scene or an accidental frame is never guaranteed", () => {
  const ceremony = Array.from({ length: 10 }, () => v2({ score: 85, at: hour(2), scene: "GROUP" }));
  const unsure = v2({ score: 30, at: hour(2), scene: "KIDS", sceneConfidence: 0.2 });
  const accidental = v2({ score: 20, at: hour(2), scene: "ACCIDENTAL", codes: [REASON_CODES.ACCIDENTAL_FRAME] });
  const { updates } = coverageSession([...ceremony, unsure, accidental], 3);
  assert.ok(!kept(updates, unsure));
  assert.ok(!kept(updates, accidental));
});

test("when the target is smaller than the guarantees, key people come first", () => {
  const rows = [v2({ score: 30, at: hour(1), scene: "GROUP", person: "bride" }), v2({ score: 90, at: hour(1), scene: "KIDS" }), v2({ score: 90, at: hour(1), scene: "FAMILY" })];
  const { updates } = coverageSession(rows, 1);
  assert.ok(kept(updates, rows[0]));
  assert.equal(keeps(updates).length, 1);
});

test("rows without scenes or people behave exactly as before", () => {
  const rows = Array.from({ length: 12 }, (_, index) => photo({ score: 50 + index, at: hour(index % 3) }));
  const before = coverageSession(rows.map((row) => ({ ...row })), 4).updates.map((update) => [update.id, update.aiDecision]);
  const after = coverageSession(rows.map((row) => ({ ...row, sceneLabel: null, subjectPersonId: null })), 4).updates.map((update) => [update.id, update.aiDecision]);
  assert.deepEqual(after, before);
});

test("the ranking stage hands coverage what it needs and owns the coverage badges", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  const ranking = source.split(String.fromCharCode(10)).find((line) => line.includes("listResultsForRanking:"));
  for (const field of ["sceneLabel", "sceneConfidence", "subjectPersonId"]) assert.match(ranking, new RegExp(`${field}: true`), field);
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  const owned = service.split(String.fromCharCode(10)).find((line) => line.includes("const RANKING_REASON_CODES"));
  for (const code of ["UNIQUE_FRAME", "COVERS_PERSON", "COVERS_SCENE"]) assert.match(owned, new RegExp(code), `${code} is stripped and re-derived on every run`);
});

test("the coverage summary says how many moments and key people the Keeps cover, and names what is missing", () => {
  const { coverageOf } = require("../src/modules/image-selection/ai-culling/scene/profile");
  const summary = coverageOf({ scenes: { CEREMONY: { total: 48, kept: 30 }, DECOR: { total: 1, kept: 0 }, KIDS: { total: 40, kept: 12 } }, people: { total: 3, kept: 2 } });
  assert.deepEqual(summary, { moments: { total: 3, kept: 2, missing: [{ id: "DECOR", label: "Decor" }] }, keyPeople: { total: 3, kept: 2 } });
  assert.equal(coverageOf({ scenes: {}, people: { total: 0, kept: 0 } }), null, "nothing to say without scenes or key people");
  assert.deepEqual(coverageOf({ scenes: {}, people: { total: 2, kept: 2 } }), { moments: null, keyPeople: { total: 2, kept: 2 } });
});

test("the overview carries the live coverage of a settled run, read from the effective decisions", async () => {
  const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
  const session = { id: "s1", projectId: "p1", folderId: null, status: "REVIEW_READY", totalImages: 5 };
  const asked = [];
  const repo = {
    findProject: async () => ({ id: "p1" }),
    findLatestSession: async () => session,
    countReadyImages: async () => 5,
    countResults: async () => 5,
    countResultsByFilter: async () => 0,
    countReadyNotInSession: async () => 0,
    countGroupsByType: async () => ({}),
    countScenes: async () => ({ CEREMONY: 4, DECOR: 1 }),
    coverageCounts: async (sessionId, accidentalScenes) => { asked.push({ sessionId, accidentalScenes }); return { scenes: { CEREMONY: { total: 4, kept: 2 }, DECOR: { total: 1, kept: 0 } }, people: { total: 1, kept: 1 } }; },
  };
  const service = createAiCullingService(repo, { queue: {}, progress: { publish: async () => {} } });
  const overview = await service.overview("p1");
  assert.deepEqual(overview.coverage, { moments: { total: 2, kept: 1, missing: [{ id: "DECOR", label: "Decor" }] }, keyPeople: { total: 1, kept: 1 } });
  // Culling V2: neither the accidental scene nor a scene the calibration did not validate is a moment.
  assert.deepEqual(asked, [{ sessionId: "s1", accidentalScenes: require("../src/modules/image-selection/ai-culling/scene/profile").uncountedSceneIds() }], "the accidental scene is never a moment");
  assert.ok(asked[0].accidentalScenes.includes("ACCIDENTAL") && asked[0].accidentalScenes.includes("CEREMONY"));
});
