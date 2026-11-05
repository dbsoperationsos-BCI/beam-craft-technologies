const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sceneWhere, sceneCounts, SCENE_MIN_CONFIDENCE, SCENE_ID_PATTERN } = require("../src/modules/image-selection/ai-culling/scene/filter");
const { scenesOf, sceneCatalogue, accidentalSceneIds } = require("../src/modules/image-selection/ai-culling/scene/profile");
const publicationService = require("../src/modules/image-selection/publication/service");
const galleryRepository = require("../src/modules/image-selection/gallery/repository");
const galleryService = require("../src/modules/image-selection/gallery/service");
const sceneBackfill = require("../src/modules/image-selection/ai-culling/scene/backfill");
const controller = require("../src/modules/image-selection/public-gallery/controller");

/*
 * The client gallery's Scene filter is a layer beside Image Selection, the way the People filter
 * is: one more condition on the published listing, read from the scene cache the culling run
 * leaves on each photo. These pin the pieces that decide things without a database - the
 * condition, the counting rule, and the shape of the id a public query may carry.
 */

test("the scene filter is one more condition on the listing, and nothing when no scene is asked for", () => {
  assert.deepEqual(sceneWhere(undefined), {});
  assert.deepEqual(sceneWhere(""), {});
  assert.deepEqual(sceneWhere("FAMILY"), { sceneCache: { some: { sceneLabel: "FAMILY", sceneConfidence: { gte: SCENE_MIN_CONFIDENCE } } } });
  assert.equal(SCENE_MIN_CONFIDENCE, 0.4, "the line the culling review draws a scene at - a gallery never says more than the review would");
});

test("a photo counts once per scene it was read as, never twice in one scene", () => {
  const rows = [
    { uploadId: "u1", sceneLabel: "FAMILY" },
    { uploadId: "u1", sceneLabel: "FAMILY" }, // the same reading listed twice counts once
    { uploadId: "u2", sceneLabel: "FAMILY" },
    { uploadId: "u3", sceneLabel: "DETAILS" },
    { uploadId: "u3", sceneLabel: "FAMILY" }, // a photo read as two scenes is in both, once each
    { uploadId: "u4", sceneLabel: null }, // an unsure or missing reading is no scene at all
    { uploadId: null, sceneLabel: "DETAILS" },
  ];
  assert.deepEqual(sceneCounts(rows), { FAMILY: 3, DETAILS: 1 });
  assert.deepEqual(sceneCounts([]), {});
  assert.deepEqual(sceneCounts(), {});
});

test("the list the dropdown draws is in the profile's order and words, and a scene with no photo is not listed", () => {
  const scenes = scenesOf({ DETAILS: 12, FAMILY: 8, GROOM_PORTRAIT: 1, EMOTIONAL: 2, PORTRAIT: 1, CEREMONY: 0 });
  assert.deepEqual(scenes.map((scene) => [scene.id, scene.label, scene.count]), [
    ["GROOM_PORTRAIT", "Groom portrait", 1],
    ["PORTRAIT", "Portrait", 1],
    ["FAMILY", "Family", 8],
    ["EMOTIONAL", "Emotional moment", 2],
    ["DETAILS", "Details", 12],
  ]);
  assert.deepEqual(scenesOf({}), [], "a gallery whose photos were never culled offers no scenes");
  assert.ok(sceneCatalogue().some((scene) => scene.accidental), "the profile names an accidental scene, which the gallery never lists");
});

test("the scene list reads the stored readings and hands unread photos to the background, saying so", async () => {
  const galleryRepositoryModule = require("../src/modules/image-selection/gallery/repository");
  const saved = [galleryRepositoryModule.listSceneReadings, sceneBackfill.pending];
  const asked = [];
  galleryRepositoryModule.listSceneReadings = async () => [{ uploadId: "u1", sceneLabel: "FAMILY" }, { uploadId: "u2", sceneLabel: "FAMILY" }];
  sceneBackfill.pending = async (projectId) => { asked.push(projectId); return true; };
  try {
    const answer = await galleryService.listScenes("proj", { folderGroupId: "shoot" });
    assert.deepEqual(answer, { scenes: [{ id: "FAMILY", label: "Family", count: 2 }], processing: true });
    assert.deepEqual(asked, ["proj"], "the unread photos of this project, and no other, are handed over");
    sceneBackfill.pending = async () => { throw new Error("redis down"); };
    assert.deepEqual(await galleryService.listScenes("proj"), { scenes: [{ id: "FAMILY", label: "Family", count: 2 }], processing: false }, "a check that fails never fails the list");
  } finally { [galleryRepositoryModule.listSceneReadings, sceneBackfill.pending] = saved; }
});

test("a public query may only name a scene the way the engine writes one", () => {
  for (const id of ["FAMILY", "GETTING_READY", "KIDS", "A", "A".repeat(30)]) assert.match(id, SCENE_ID_PATTERN);
  for (const id of ["family", "", " FAMILY", "FAMILY,DETAILS", "A".repeat(31), "1ABC", "FAM-ILY", "%27"]) assert.doesNotMatch(id, SCENE_ID_PATTERN);
});

const src = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");

test("the public gallery carries the scene filter on its listing, its counts and its own scenes route", () => {
  const controller = src("public-gallery", "controller.js");
  assert.match(controller, /sceneId: sceneIdSchema\.optional\(\)/, "the images query takes one validated scene id");
  assert.equal((controller.match(/sceneId: query\.sceneId/g) || []).length, 3, "the listing and both tab counts follow the scene, as they follow the people");
  assert.match(controller, /async function listScenes\(req, res\)/);
  assert.match(controller, /const session = requireSession\(req, res, params\.token\); if \(!session\) return;\n  try \{\n    const publication = await authorizeSession\(params\.token, session\);\n    const folderId = query\.folderId === undefined \? undefined : folderScope\(query\.folderId\);\n    return res\.json\(\{ data: await galleryService\.listScenes/, "the scenes route authenticates by the gallery session before it reads anything");
  assert.match(src("public-gallery", "routes.js"), /router\.get\("\/:token\/scenes", scenesLimiter, listScenes\);/, "budgeted per address: a poll that starts engine work is not an unlimited call");
  const repository = src("gallery", "repository.js");
  // Both are wrapped in `withoutHeldFolders`: a shoot not yet at its day is left out of either.
  assert.match(repository, /\.\.\.personWhere\(options\.personId\), \.\.\.sceneWhere\(options\.sceneId\) \}, await heldFolderIds\(projectId\)\);/, "the scene is one more condition on the same published listing");
  assert.match(repository, /upload: withoutHeldFolders\(\{ projectId, status: "READY", \.\.\.cullEligible, \.\.\.folderWhere\(\{ folderGroupId, folderId \}\), \.\.\.personWhere\(personId\) \}, await heldFolderIds\(projectId\)\)/, "the counts are read under the listing's own eligibility, shoot and People conditions");
  assert.match(repository, /distinct: \["uploadId", "sceneLabel"\]/);
});

/*
 * The handlers themselves, with the publication, service and repository layers stubbed: what each
 * refuses, and that what reaches the data layer is the authorized project and the validated scene.
 */
const fakeRes = () => { const res = { statusCode: 200, body: null }; res.status = (code) => { res.statusCode = code; return res; }; res.json = (body) => { res.body = body; return res; }; return res; };
const request = (params = {}, query = {}) => ({ params: { token: "ABCD23", ...params }, query, headers: { authorization: "Bearer session" } });
const publication = () => ({ projectId: "proj", pinHash: "hash", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), project: { projectName: "Arun & Meena", deletedAt: null } });
async function withStubs(stubs, run) {
  const saved = stubs.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of stubs) target[key] = value;
  try { await run(); } finally { for (const [target, key, value] of saved) target[key] = value; }
}
const sessionStubs = (session) => [[publicationService, "verifySession", () => { if (!session) throw Object.assign(new Error("Open the gallery link again."), { status: 401 }); return session; }], [publicationService, "authorize", async () => publication()]];

test("the scenes route answers the authorized project's scenes for the scope asked, and nothing without a session", async () => {
  const asked = [];
  await withStubs([...sessionStubs({ projectId: "proj" }), [galleryService, "listScenes", async (projectId, scope) => { asked.push([projectId, scope]); return { scenes: [{ id: "FAMILY", label: "Family", count: 8 }] }; }]], async () => {
    const res = fakeRes();
    await controller.listScenes(request({}, { folderGroupId: "shoot1", personId: "p1,p2" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { data: { scenes: [{ id: "FAMILY", label: "Family", count: 8 }] } });
    assert.deepEqual(asked, [["proj", { folderId: undefined, folderGroupId: "shoot1", personId: "p1,p2" }]], "the project is the publication's, never the request's");
    const all = fakeRes();
    await controller.listScenes(request({}, { folderId: "all" }), all);
    assert.deepEqual(asked[1], ["proj", { folderId: undefined, folderGroupId: undefined, personId: undefined }], "`all` is no folder condition, as the People list reads it");
  });
  await withStubs([...sessionStubs(null), [galleryService, "listScenes", async () => { throw new Error("must not be reached"); }]], async () => {
    const res = fakeRes();
    await controller.listScenes(request(), res);
    assert.equal(res.statusCode, 401);
  });
  await withStubs([...sessionStubs({ projectId: "proj" }), [galleryService, "listScenes", async () => { throw new Error("must not be reached"); }]], async () => {
    const res = fakeRes();
    await controller.listScenes(request({}, { personId: "' OR 1" }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "Invalid gallery request." });
  });
});

test("the listing carries one validated scene into the photos and both counts, and refuses a malformed or accidental one", async () => {
  const calls = [];
  const listPublishedImages = async (projectId, page, pageSize, options) => { calls.push([projectId, options.sceneId, options.selected]); return { items: [], total: 0 }; };
  await withStubs([...sessionStubs({ projectId: "proj" }), [galleryRepository, "listPublishedImages", listPublishedImages]], async () => {
    const res = fakeRes();
    await controller.listFolderImages(request({ folderId: "all" }, { sceneId: "FAMILY", folderGroupId: "shoot1" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [["proj", "FAMILY", "all"], ["proj", "FAMILY", "all"], ["proj", "FAMILY", "selected"]]);
    for (const sceneId of ["family", "FAMILY,DETAILS", accidentalSceneIds()[0]]) {
      const refused = fakeRes();
      await controller.listFolderImages(request({ folderId: "all" }, { sceneId }), refused);
      assert.equal(refused.statusCode, 400, `${sceneId} is refused`);
    }
    assert.equal(calls.length, 3, "a refused scene never reaches the repository");
  });
});
