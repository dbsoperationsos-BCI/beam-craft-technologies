const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroups, bestOf, DUPLICATE_WINDOW_SECONDS } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");

/**
 * The grouping engine over hand-built photo rows — no database, no images. What is pinned is
 * the staged design's promises: only neighbours in time can meet, hashes must agree before a
 * chain forms, folders never mix, a missing capture time falls back to filename sequence at a
 * tighter hash threshold, and the best frame of a group is the technically strongest with faces
 * breaking ties.
 */

let counter = 0;
function photo({ folder = "f1", at = null, name, hash = "0000000000000000", tech = 70, face = null, eyes = null, structure = null, people = null, subject = null } = {}) {
  counter += 1;
  return {
    resultId: `r${counter}`,
    uploadId: `u${counter}`,
    folderId: folder,
    capturedAt: at,
    fileName: name || `IMG_${String(counter).padStart(4, "0")}.CR3`,
    perceptualHash: hash,
    technicalScore: tech,
    faceQualityScore: face,
    eyesOpenScore: eyes,
    subjectScore: subject,
    structureSignature: structure,
    personIds: people,
  };
}
const second = (offset) => new Date(Date.UTC(2026, 7, 30, 10, 0, offset)).toISOString();
const ofType = (plans, type) => plans.filter((plan) => plan.type === type);

test("a rapid identical sequence forms one duplicate group and one burst group", () => {
  const photos = [photo({ at: second(0) }), photo({ at: second(1) }), photo({ at: second(2) })];
  const plans = buildGroups(photos);
  assert.equal(ofType(plans, "DUPLICATE").length, 1);
  assert.equal(ofType(plans, "BURST").length, 1);
  assert.equal(ofType(plans, "DUPLICATE")[0].memberCount, 3);
});

test("the duplicate window is about time: identical frames a minute apart never group", () => {
  const plans = buildGroups([photo({ at: second(0) }), photo({ at: second(60) })]);
  assert.equal(plans.length, 0);
  // And just inside the window they do.
  const close = buildGroups([photo({ at: second(0) }), photo({ at: second(DUPLICATE_WINDOW_SECONDS) })]);
  assert.equal(ofType(close, "DUPLICATE").length, 1);
});

test("hashes must agree: seconds apart but visually different is no duplicate", () => {
  // 24 differing bits — a different frame, not a near-identical one.
  const plans = buildGroups([photo({ at: second(0) }), photo({ at: second(1), hash: "0000000000ffffff" })]);
  assert.equal(ofType(plans, "DUPLICATE").length, 0);
});

test("a burst tolerates variation a duplicate would not", () => {
  // 8 differing bits: too far apart for DUPLICATE (≤6), close enough for BURST (≤18).
  const plans = buildGroups([photo({ at: second(0) }), photo({ at: second(1), hash: "00000000000000ff" })]);
  assert.equal(ofType(plans, "DUPLICATE").length, 0);
  assert.equal(ofType(plans, "BURST").length, 1);
});

test("folders never mix, however close the moments are", () => {
  const plans = buildGroups([photo({ folder: "a", at: second(0) }), photo({ folder: "b", at: second(0) })]);
  assert.equal(plans.length, 0);
});

test("no capture time: filename sequence chains duplicates at a tighter threshold, and bursts need real time", () => {
  // 4 differing bits — inside the tightened no-time duplicate threshold.
  const near = buildGroups([photo({ name: "IMG_0001.CR3" }), photo({ name: "IMG_0002.CR3", hash: "000000000000000f" })]);
  assert.equal(ofType(near, "DUPLICATE").length, 1);
  assert.equal(ofType(near, "BURST").length, 0, "a burst is a fact about time");
  // 6 differing bits would pass the timed threshold but not the tightened one.
  const far = buildGroups([photo({ name: "IMG_0003.CR3" }), photo({ name: "IMG_0004.CR3", hash: "000000000000003f" })]);
  assert.equal(far.length, 0);
});

test("filename sequence sorts naturally, so IMG_9 chains to IMG_10", () => {
  const nine = photo({ name: "IMG_9.CR3" });
  const ten = photo({ name: "IMG_10.CR3" });
  const eleven = photo({ name: "IMG_11.CR3", hash: "0000000000ffffff" });
  // If IMG_10 sorted before IMG_9 lexically, the chain would break on the different IMG_11.
  const plans = buildGroups([eleven, nine, ten]);
  assert.equal(ofType(plans, "DUPLICATE").length, 1);
  assert.deepEqual(ofType(plans, "DUPLICATE")[0].memberResultIds.sort(), [nine.resultId, ten.resultId].sort());
});

test("photos without a hash are skipped, never grouped", () => {
  const plans = buildGroups([photo({ at: second(0), hash: null }), photo({ at: second(1), hash: null })]);
  assert.equal(plans.length, 0);
});

test("the group's best is the technically strongest, faces and eyes breaking ties", () => {
  const soft = photo({ at: second(0), tech: 60 });
  const strong = photo({ at: second(1), tech: 90 });
  assert.equal(bestOf([soft, strong]), strong);
  const blink = photo({ at: second(0), tech: 90, face: 80, eyes: 10 });
  const open = photo({ at: second(1), tech: 90, face: 80, eyes: 95 });
  assert.equal(bestOf([blink, open]), open);
  const plans = buildGroups([soft, strong]);
  assert.equal(plans[0].bestResultId, strong.resultId);
  assert.equal(plans[0].representativeUploadId, strong.uploadId);
  assert.equal(plans[0].groupScore, 90);
});

test("a gap in the middle splits the chain into two groups", () => {
  const photos = [photo({ at: second(0) }), photo({ at: second(1) }), photo({ at: second(30) }), photo({ at: second(31) })];
  const duplicates = ofType(buildGroups(photos), "DUPLICATE");
  assert.equal(duplicates.length, 2);
  assert.deepEqual(duplicates.map((plan) => plan.memberCount), [2, 2]);
});

// ---------------------------------------------------------------------------
// Similarity v2: the structure signature and the people in the frame confirm or split a chain,
// and every group ranks its members.
// ---------------------------------------------------------------------------
const { rankMembers, DUPLICATE_MAX_STRUCTURE, BURST_MAX_STRUCTURE } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");
const SAME_LAYOUT = "8".repeat(64);
const OTHER_LAYOUT = "0".repeat(32) + "f".repeat(32);
const FAR_HASH = "0000000000ffffff"; // 24 bits from all-zero: past the burst window of the hash alone

test("a burst the hash misses is confirmed by the same layout and the same people", () => {
  const confirmed = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT, people: ["bride"] }), photo({ at: second(1), hash: "0000000000ffffff", structure: SAME_LAYOUT, people: ["bride"] })]);
  assert.equal(ofType(confirmed, "BURST").length, 1, "24 hash bits apart, but one layout and one person");
  assert.equal(ofType(confirmed, "DUPLICATE").length, 0);
  const strangers = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT, people: ["bride"] }), photo({ at: second(1), hash: "0000000000ffffff", structure: SAME_LAYOUT, people: ["guest"] })]);
  assert.equal(strangers.length, 0, "a different person in the same layout is a different moment");
  const unknown = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT }), photo({ at: second(1), hash: "0000000000ffffff", structure: SAME_LAYOUT })]);
  assert.equal(ofType(unknown, "BURST").length, 1, "no people data: the layout alone may confirm");
  assert.ok(BURST_MAX_STRUCTURE <= DUPLICATE_MAX_STRUCTURE, "the layout is held to the duplicate's bar when it vouches for a burst");
});

test("a hash duplicate is split by a different layout or different people, but stays a burst", () => {
  const layouts = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT }), photo({ at: second(1), structure: OTHER_LAYOUT })]);
  assert.equal(ofType(layouts, "DUPLICATE").length, 0);
  assert.equal(ofType(layouts, "BURST").length, 1);
  const people = buildGroups([photo({ at: second(0), people: ["bride"] }), photo({ at: second(1), people: ["guest"] })]);
  assert.equal(ofType(people, "DUPLICATE").length, 0);
  assert.equal(ofType(people, "BURST").length, 1);
  const same = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT, people: ["bride", "groom"] }), photo({ at: second(1), structure: SAME_LAYOUT, people: ["groom", "bride"] })]);
  assert.equal(ofType(same, "DUPLICATE").length, 1, "order of people does not matter");
  // The scan missing one face in one frame does not make two frames of the same moment strangers.
  const oneMore = buildGroups([photo({ at: second(0), people: ["bride"] }), photo({ at: second(1), people: ["bride", "groom"] })]);
  assert.equal(ofType(oneMore, "DUPLICATE").length, 1, "one set inside the other is the same people");
});

test("far hashes with no layout to vouch for them never group", () => {
  assert.equal(buildGroups([photo({ at: second(0) }), photo({ at: second(1), hash: FAR_HASH })]).length, 0);
});

test("the layout loosens the hash, it never replaces it", () => {
  // Unrelated real frames sit 17-28 apart on the structure scale, so a similar-but-different
  // layout must not make a burst on its own...
  const SIMILAR_LAYOUT = "8".repeat(32) + "e".repeat(32); // 20 from SAME_LAYOUT
  const similar = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT }), photo({ at: second(1), hash: "0000000000ffffff", structure: SIMILAR_LAYOUT })]);
  assert.equal(similar.length, 0, "a layout 20 apart is how unrelated frames look");
  // ...and a hash far past the burst range is not rescued by any layout.
  const far = buildGroups([photo({ at: second(0), structure: SAME_LAYOUT, people: ["bride"] }), photo({ at: second(1), hash: "00000000ffffffff", structure: SAME_LAYOUT, people: ["bride"] })]);
  assert.equal(far.length, 0, "32 hash bits apart is another frame whatever the layout says");
});

test("members are ranked by balanced merit — eyes and expression weigh with sharpness — and the best is rank one", () => {
  const members = [photo({ at: second(0), tech: 60 }), photo({ at: second(1), tech: 80, face: 50 }), photo({ at: second(2), tech: 80, face: 70, eyes: 20 }), photo({ at: second(3), tech: 80, face: 70, eyes: 90 })];
  const ranked = rankMembers(members);
  // Eyes open (#3) first; a blink (#2, eyes 20) now ranks below an equally sharp frame whose eyes
  // are unknown (#1) and below the softer frame with no face to blink (#0): a blink is a worse keeper.
  assert.deepEqual(ranked.map((member) => member.resultId), [members[3].resultId, members[1].resultId, members[0].resultId, members[2].resultId]);
  const [plan] = ofType(buildGroups(members), "DUPLICATE");
  assert.deepEqual(plan.rankedResultIds, ranked.map((member) => member.resultId));
  assert.equal(plan.bestResultId, plan.rankedResultIds[0]);
  // The subject stage's score breaks the last tie.
  const tied = rankMembers([photo({ at: second(0), tech: 80, face: 70, eyes: 90, subject: 40 }), photo({ at: second(1), tech: 80, face: 70, eyes: 90, subject: 90 })]);
  assert.equal(tied[0].subjectScore, 90);
});
