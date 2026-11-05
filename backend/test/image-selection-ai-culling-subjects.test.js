const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Phase 4 of the culling V2 work: who is in the photo, and how much each face matters - read from
 * the photograph alone. The People filter's clusters are the identity layer; the subject stage
 * turns each face's size and centrality into a subject score and weights eyes by that prominence
 * (a tiny face at the edge blinking is noise, a large central face blinking is the reason to pick
 * another frame), and the ranking reads it. No role and no appearance count enters it. Pure maths
 * pinned here against hand-built faces and people.
 */
const { boxIou, normalizeBox, subjectSignals, presenceOf, PROMINENT_PRESENCE } = require("../src/modules/image-selection/ai-culling/analysis/subjects");
const { faceDetailsOf } = require("../src/modules/image-selection/ai-culling/analysis/faces");
const { finalScoreOf } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

test("no label and no appearance count weighs a person: the same face in the same frame scores the same, whoever it is", () => {
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
  // Whatever a person row still carries (an old role, a photo count) never reaches the verdict.
  const asCouple = subjectSignals({ mappings: [{ personId: "couple", box, role: "PRIMARY", photoCount: 900 }], faceDetails: [{ box, eyesOpen: { value: true, confidence: 95 } }] });
  const asGuestSeenOnce = subjectSignals({ mappings: [{ personId: "guest", box, role: "BACKGROUND", photoCount: 1 }], faceDetails: [{ box, eyesOpen: { value: true, confidence: 95 } }] });
  assert.deepEqual({ ...asCouple, subjectPersonId: null }, { ...asGuestSeenOnce, subjectPersonId: null }, "a guest's best portrait is judged exactly as the couple's");
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  assert.doesNotMatch(service, /personImportance|maxCount/, "the stage computes no weight from roles or how often someone appears");
  assert.match(service, /const signals = subjectSignals\(\{ mappings: mappings\[row\.uploadId\] \|\| \[\], faceDetails: row\.faceDetails \}\);/);
});

test("a group photo: one small closed pair of eyes among many open ones does not mark the frame", () => {
  // Six people across a wide shot, one blinking.
  const boxes = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8].map((x) => ({ x, y: 0.4, w: 0.08, h: 0.11 }));
  const mappings = boxes.map((box, index) => ({ personId: `p${index}`, box }));
  const faceDetails = boxes.map((box, index) => ({ box, eyesOpen: { value: index !== 2, confidence: 95 } }));
  const result = subjectSignals({ mappings, faceDetails });
  assert.ok(!result.reasonCodes.includes(REASON_CODES.IMPORTANT_SUBJECT_BLINK), "no face dominates, so no blink is named");
  assert.ok(result.eyesOpenScore >= 75, `the weighted eyes stay high: ${result.eyesOpenScore}`);
  assert.ok(boxes.every((box) => presenceOf(box) < PROMINENT_PRESENCE));
});

test("boxes from either provider become fractions and intersect the obvious way", () => {
  assert.deepEqual(normalizeBox({ Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  assert.deepEqual(normalizeBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  assert.equal(boxIou({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.5 }), 1);
  assert.equal(boxIou({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }), 0);
  assert.ok(Math.abs(boxIou({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.25, y: 0, w: 0.5, h: 0.5 }) - 1 / 3) < 1e-9);
});

test("no people means no subject verdict — a landscape is not dragged down", () => {
  assert.deepEqual(subjectSignals({ mappings: [], faceDetails: [] }), { peopleCount: 0, subjectPersonId: null, subjectScore: null, eyesOpenScore: null, reasonCodes: [] });
});

test("the group photo: the bride blinking costs the frame, a tiny background guest blinking does not", () => {
  const brideBox = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
  const guestBox = { x: 0.9, y: 0.1, w: 0.04, h: 0.06 };
  const mappings = [{ personId: "bride", box: brideBox, quality: 0.9 }, { personId: "guest", box: guestBox, quality: 0.5 }];
  const open = { value: true, confidence: 95 };
  const shut = { value: false, confidence: 95 };
  const brideBlinks = subjectSignals({ mappings, faceDetails: [{ box: brideBox, eyesOpen: shut }, { box: guestBox, eyesOpen: open }] });
  const guestBlinks = subjectSignals({ mappings, faceDetails: [{ box: brideBox, eyesOpen: open }, { box: guestBox, eyesOpen: shut }] });
  assert.equal(brideBlinks.subjectPersonId, "bride");
  assert.equal(brideBlinks.peopleCount, 2);
  assert.ok(brideBlinks.reasonCodes.includes(REASON_CODES.IMPORTANT_SUBJECT_BLINK));
  assert.ok(!guestBlinks.reasonCodes.includes(REASON_CODES.IMPORTANT_SUBJECT_BLINK));
  assert.ok(guestBlinks.eyesOpenScore > brideBlinks.eyesOpenScore + 30, `weighted eyes: ${guestBlinks.eyesOpenScore} vs ${brideBlinks.eyesOpenScore}`);
  assert.ok(guestBlinks.eyesOpenScore >= 85, "a background blink barely registers");
  assert.ok(brideBlinks.subjectScore >= 65, `the bride, large and centred, makes the frame: ${brideBlinks.subjectScore}`);
  assert.ok(guestBlinks.reasonCodes.includes(REASON_CODES.KEY_PEOPLE_PRESENT));
});

test("a face nobody is mapped to is judged by its own place in the frame: a large unknown face blinking is the photo's flaw", () => {
  const bigFace = { x: 0.1, y: 0.1, w: 0.5, h: 0.6 };
  const smallBride = { x: 0.7, y: 0.4, w: 0.12, h: 0.15 };
  const result = subjectSignals({ mappings: [{ personId: "bride", box: smallBride, quality: 0.8 }], faceDetails: [{ box: bigFace, eyesOpen: { value: false, confidence: 95 } }, { box: smallBride, eyesOpen: { value: true, confidence: 95 } }] });
  assert.equal(result.subjectPersonId, "bride", "the subject is the most prominent known person");
  assert.ok(result.reasonCodes.includes(REASON_CODES.IMPORTANT_SUBJECT_BLINK), "the largest face in the frame has its eyes shut - that is what a viewer sees");
  assert.ok(result.eyesOpenScore < 40, `${result.eyesOpenScore}`);
  assert.equal(result.peopleCount, 1, "people are mapped persons; a stranger is a face, not a person");
});

test("without eye data the subject stage still scores presence and leaves eyes alone", () => {
  const result = subjectSignals({ mappings: [{ personId: "bride", box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, quality: 0.9 }], faceDetails: null });
  assert.equal(result.eyesOpenScore, null);
  assert.ok(result.subjectScore > 50);
});

test("the face stage keeps per-face details the subject stage can match later", () => {
  const details = faceDetailsOf([
    { BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 }, Confidence: 99, EyesOpen: { Value: true, Confidence: 96 }, Smile: { Value: false, Confidence: 70 }, Quality: { Sharpness: 80 } },
    { BoundingBox: { Left: 0.5, Top: 0.5, Width: 0.1, Height: 0.1 }, Confidence: 40 },
  ]);
  assert.deepEqual(details, [{ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, confidence: 99, eyesOpen: { value: true, confidence: 96 }, smile: { value: false, confidence: 70 }, sharpness: 80, yaw: null, expression: null }]);
});

test("the ranking reads the subject score as a bounded, explainable nudge", () => {
  const base = { technicalScore: 70, faceCount: 1, faceQualityScore: 70, eyesOpenScore: 70, expressionScore: 50 };
  const plain = finalScoreOf(base);
  assert.equal(finalScoreOf({ ...base, subjectScore: 50 }), plain, "a middling subject score changes nothing");
  assert.equal(finalScoreOf({ ...base, subjectScore: 100 }), plain + 6);
  assert.equal(finalScoreOf({ ...base, subjectScore: 0 }), plain - 6);
  assert.equal(finalScoreOf({ ...base, subjectScore: null }), plain);
});

test("the migration adds roles to people and the subject columns to results, additively", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261002180000_culling_subjects", "migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE `image_selection_face_person` ADD COLUMN `role` VARCHAR\(30\) NULL/);
  assert.match(sql, /ALTER TABLE `image_selection_culling_result`[\s\S]*ADD COLUMN `subject_score` DOUBLE NULL[\s\S]*ADD COLUMN `people_count` INTEGER NULL[\s\S]*ADD COLUMN `subject_person_id` VARCHAR\(191\) NULL[\s\S]*ADD COLUMN `face_details` JSON NULL/);
  assert.match(sql, /FOREIGN KEY \(`subject_person_id`\) REFERENCES `image_selection_face_person`\(`id`\)\s+ON DELETE SET NULL/);
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE FROM|UPDATE )/im, "nothing dropped or rewritten (ON UPDATE CASCADE is a key clause, not a rewrite)");
  for (const name of sql.match(/`[a-z_]+`/g).map((entry) => entry.slice(1, -1))) assert.ok(name.length <= 64, name);
});

test("a role is one of the studio's words or nothing", () => {
  const { personRoleSchema, personParamsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  assert.equal(personRoleSchema.parse({ role: "PRIMARY" }).role, "PRIMARY");
  assert.equal(personRoleSchema.parse({ role: null }).role, null);
  assert.equal(personRoleSchema.safeParse({ role: "BRIDE" }).success, false, "roles are generic so a birthday shoot fits too");
  assert.equal(personParamsSchema.safeParse({ projectId: "p", personId: "x" }).success, true);
});

// ---------------------------------------------------------------------------
// The stage, orchestrated over a fake repository
// ---------------------------------------------------------------------------
const { runSubjectStage } = require("../src/modules/image-selection/ai-culling/service");

function stageRepo() {
  const state = {
    session: { id: "s1", projectId: "p1", status: "ANALYZING", currentStage: null, progressPercent: 90 },
    mappings: { u1: [{ personId: "bride", box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, quality: 0.9 }, { personId: "guest", box: { x: 0.9, y: 0.1, w: 0.04, h: 0.06 }, quality: 0.5 }], u2: [] },
    rows: [
      { id: "r1", uploadId: "u1", reasonCodes: ["SHARP", "EYES_OPEN"], eyesOpenScore: 90, faceDetails: [{ box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, eyesOpen: { value: false, confidence: 95 } }, { box: { x: 0.9, y: 0.1, w: 0.04, h: 0.06 }, eyesOpen: { value: true, confidence: 95 } }] },
      { id: "r2", uploadId: "u2", reasonCodes: ["SHARP"], eyesOpenScore: null, faceDetails: null },
    ],
    updates: [],
  };
  return {
    state,
    findSessionById: async () => state.session,
    transitionSession: async (_id, from, data) => { if (!from.includes(state.session.status)) return { count: 0 }; Object.assign(state.session, data); return { count: 1 }; },
    updateSession: async (_id, data) => Object.assign(state.session, data),
    listResultsForSubjects: async (_sessionId, cursor, take) => { const start = cursor ? state.rows.findIndex((row) => row.id === cursor) + 1 : 0; return state.rows.slice(start, start + take); },
    listMappingsForUploads: async (_projectId, uploadIds) => Object.fromEntries(uploadIds.map((id) => [id, state.mappings[id] || []])),
    updateResult: async (id, data) => { state.updates.push({ id, data }); Object.assign(state.rows.find((row) => row.id === id), data); },
  };
}

test("the subject stage stamps who is in each photo, re-weights eyes by prominence and keeps the other stages' codes", async () => {
  const repo = stageRepo();
  await runSubjectStage("s1", repo, { publish: async () => {} });
  const r1 = repo.state.rows[0];
  assert.equal(r1.subjectPersonId, "bride");
  assert.equal(r1.peopleCount, 2);
  assert.ok(r1.subjectScore >= 65);
  assert.ok(r1.eyesOpenScore < 40, `the bride's blink now dominates the eye score: ${r1.eyesOpenScore}`);
  assert.ok(r1.reasonCodes.includes("IMPORTANT_SUBJECT_BLINK"));
  assert.ok(r1.reasonCodes.includes("SHARP"), "the technical stage's codes survive");
  const r2 = repo.state.rows[1];
  assert.equal(r2.peopleCount, undefined, "nobody known and nothing of ours on the row: not rewritten");
  assert.equal(r2.subjectScore, undefined);
  assert.equal(r2.eyesOpenScore, null, "no faces, no eyes — unchanged");
  assert.equal(repo.state.session.currentStage, "SUBJECTS");
});

test("the subject stage leaves a session that is no longer analyzing alone", async () => {
  const repo = stageRepo();
  repo.state.session.status = "CANCELLED";
  await runSubjectStage("s1", repo, { publish: async () => {} });
  assert.equal(repo.state.updates.length, 0);
  assert.equal(repo.state.session.currentStage, null);
});

test("a person merged away mid-run costs the photo its subject link, never the run", async () => {
  const repo = stageRepo();
  let refused = 0;
  const write = repo.updateResult;
  repo.updateResult = async (id, data) => {
    if (data.subjectPersonId === "bride" && !refused) { refused += 1; throw Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }); }
    return write(id, data);
  };
  await runSubjectStage("s1", repo, { publish: async () => {} });
  const r1 = repo.state.rows[0];
  assert.equal(refused, 1);
  assert.equal(r1.subjectPersonId, null, "the dangling link is dropped");
  assert.equal(typeof r1.subjectScore, "number", "the score survives");
  assert.equal(r1.peopleCount, 2);
});

test("the stage reads no person rows: a role or a photo count cannot reach the score", async () => {
  const repo = stageRepo();
  let asked = 0;
  repo.listPersonsWithCounts = async () => { asked += 1; return []; };
  await runSubjectStage("s1", repo, { publish: async () => {} });
  assert.equal(asked, 0);
  assert.ok(repo.state.updates.some((update) => update.id === "r1"), "the photos are still judged");
});

// ---------------------------------------------------------------------------
// The people endpoints, over the module's fake repository
// ---------------------------------------------------------------------------
const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");

function peopleRepo({ deleted = false } = {}) {
  const image = (id) => ({ id, thumbnailKey: null, width: 1000, height: 800 });
  const persons = [
    { id: "late", role: null, createdAt: new Date("2026-01-03"), coverBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, coverImage: image("i3"), mappings: [], photoCount: 5 },
    { id: "bride", role: "PRIMARY", createdAt: new Date("2026-01-01"), coverBox: null, coverImage: null, mappings: [{ box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, image: image("i1") }], photoCount: 120 },
    { id: "nobody", role: null, createdAt: new Date("2026-01-02"), coverBox: null, coverImage: null, mappings: [], photoCount: 0 },
    { id: "tie", role: "FAMILY", createdAt: new Date("2026-01-02"), coverBox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, coverImage: image("i2"), mappings: [], photoCount: 5 },
  ];
  const calls = { roles: [] };
  return {
    calls,
    findProject: async (projectId) => (projectId === "p1" && !deleted ? { id: "p1", projectName: "Wedding" } : null),
    listPersonsWithCounts: async (projectId) => (projectId === "p1" ? persons : []),
    updatePersonRole: async (projectId, personId, role) => { calls.roles.push({ projectId, personId, role }); return projectId === "p1" && persons.some((person) => person.id === personId) ? 1 : 0; },
  };
}

test("people are numbered by how many photos they are in, with a face even when the cover photo is gone", async () => {
  const service = createAiCullingService(peopleRepo(), { queue: {}, progress: { publish: async () => {} } });
  const people = await service.people("p1");
  assert.deepEqual(people.map((person) => [person.label, person.id, person.photoCount, person.role]), [
    ["Person 1", "bride", 120, "PRIMARY"],
    ["Person 2", "tie", 5, "FAMILY"],
    ["Person 3", "late", 5, null],
  ], "ranked by count, ties by who was found first, nobody with zero photos");
  const bride = people[0];
  assert.equal(bride.cover.thumbnailUrl, "/api/image-selection/projects/p1/gallery/i1/thumbnail", "falls back to the clearest remaining face");
  assert.deepEqual(bride.cover.box, { x: 0.4, y: 0.3, w: 0.2, h: 0.3 });
  assert.equal(people[1].cover.thumbnailUrl, "/api/image-selection/projects/p1/gallery/i2/thumbnail");
});

test("a role is set only inside the project, and a deleted project answers 404", async () => {
  const repo = peopleRepo();
  const service = createAiCullingService(repo, { queue: {}, progress: { publish: async () => {} } });
  assert.deepEqual(await service.setPersonRole("p1", "bride", "FAMILY"), { id: "bride", role: "FAMILY" });
  await assert.rejects(service.setPersonRole("p1", "stranger", "FAMILY"), (error) => error.status === 404);
  assert.deepEqual(repo.calls.roles.map((call) => call.projectId), ["p1", "p1"], "the project always travels with the id");
  const gone = createAiCullingService(peopleRepo({ deleted: true }), { queue: {}, progress: { publish: async () => {} } });
  await assert.rejects(gone.people("p1"), (error) => error.status === 404);
  await assert.rejects(gone.setPersonRole("p1", "bride", null), (error) => error.status === 404);
});

test("the subject stage replaces the face stage's eye badges with its weighted answer and leaves unknown photos unwritten", async () => {
  const repo = stageRepo();
  // r1: the bride, large and central, blinks while the face stage badged the frame EYES_OPEN.
  // r3: a large, sharp unknown face blinking in front of a small open-eyed bride.
  repo.state.rows.push({ id: "r3", uploadId: "u3", reasonCodes: ["SHARP", "PRIMARY_SUBJECT_BLINK"], eyesOpenScore: 10, faceDetails: [{ box: { x: 0.1, y: 0.1, w: 0.3, h: 0.4 }, eyesOpen: { value: false, confidence: 95 } }, { box: { x: 0.6, y: 0.2, w: 0.1, h: 0.15 }, eyesOpen: { value: true, confidence: 95 } }] });
  repo.state.mappings.u3 = [{ personId: "bride", box: { x: 0.6, y: 0.2, w: 0.1, h: 0.15 }, quality: 0.8 }];
  await runSubjectStage("s1", repo, { publish: async () => {} });
  const [r1, r2, r3] = repo.state.rows;
  assert.ok(!r1.reasonCodes.includes("EYES_OPEN"), "the largest face's badge no longer speaks for the bride");
  assert.ok(r1.reasonCodes.includes("IMPORTANT_SUBJECT_BLINK"));
  assert.ok(r3.reasonCodes.includes("IMPORTANT_SUBJECT_BLINK") && !r3.reasonCodes.includes("EYES_OPEN"), "the prominent face's blink is the photo's, labelled person or not");
  assert.ok(r3.eyesOpenScore < 40, `weighted ${r3.eyesOpenScore}`);
  assert.ok(!repo.state.updates.some((update) => update.id === "r2"), "a photo with nobody known and no faces is not rewritten");
  assert.equal(r2.subjectScore, undefined);
});

test("faces without any eye claim (a desktop-analyzed photo) leave the eye score alone", () => {
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
  const result = subjectSignals({ mappings: [{ personId: "bride", box, quality: 0.9 }], faceDetails: [{ box, confidence: 97, eyesOpen: null }] });
  assert.equal(result.eyesOpenScore, null);
  assert.equal(result.subjectPersonId, "bride", "presence is still weighed");
  assert.deepEqual(result.reasonCodes, ["KEY_PEOPLE_PRESENT"]);
});

test("Culling V2: when the weighted answer is open eyes, the largest face's half-closed and looking-away badges go with it", async () => {
  const repo = stageRepo();
  // r4: a large, central bride with open eyes; a small face at the edge whose eyes the face stage read as half closed.
  repo.state.rows.push({ id: "r4", uploadId: "u4", reasonCodes: ["SHARP", "HALF_CLOSED_EYES", "LOOKING_AWAY"], eyesOpenScore: 40, faceDetails: [{ box: { x: 0.9, y: 0.05, w: 0.05, h: 0.07 }, eyesOpen: { value: false, confidence: 95 } }, { box: { x: 0.35, y: 0.25, w: 0.3, h: 0.4 }, eyesOpen: { value: true, confidence: 95 } }] });
  repo.state.mappings.u4 = [{ personId: "bride", box: { x: 0.35, y: 0.25, w: 0.3, h: 0.4 }, quality: 0.8 }];
  await runSubjectStage("s1", repo, { publish: async () => {} });
  const r4 = repo.state.rows.find((row) => row.id === "r4");
  assert.ok(r4.reasonCodes.includes("EYES_OPEN"), `weighted open: ${r4.reasonCodes}`);
  assert.ok(!r4.reasonCodes.includes("HALF_CLOSED_EYES") && !r4.reasonCodes.includes("LOOKING_AWAY"), "no badge contradicts the weighted answer");
});
