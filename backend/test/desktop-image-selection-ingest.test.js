const test = require("node:test");
const assert = require("node:assert/strict");
const { createIngest, OFF } = require("../src/modules/image-selection/faces/ingest");
const vectors = require("../src/modules/ai-feature/shared/vectors");

/*
 * The Virtual Curation desktop's hand-off into the client gallery's People filter. These tests pin
 * the trust boundary with fakes: what is refused before anything is written, that accepted
 * descriptors reach the clustering normalised and gated exactly as the worker's own do, and that a
 * photo handed over twice is cleared before it is counted again.
 */
function fakeRepository({ images = {}, mappings = {} } = {}) {
  const log = [];
  const scans = {};
  return {
    log, scans,
    findGalleryImage: async (projectId, imageId) => { log.push(["find", projectId, imageId]); return images[imageId] || null; },
    startScan: async (projectId, imageId) => { log.push(["start", imageId]); scans[imageId] = { status: "PROCESSING", attempts: (scans[imageId]?.attempts || 0) + 1 }; },
    listMappings: async (imageId) => { log.push(["listMappings", imageId]); return mappings[imageId] || []; },
    deleteMappings: async (imageId) => { log.push(["deleteMappings", imageId]); delete mappings[imageId]; },
    completeScan: async (imageId, faceCount) => { log.push(["complete", imageId, faceCount]); scans[imageId] = { ...scans[imageId], status: "COMPLETED", faceCount }; },
    failScan: async (imageId, message) => { log.push(["fail", imageId, message]); scans[imageId] = { ...scans[imageId], status: "FAILED", error: message }; },
  };
}

function fakeClustering({ assign } = {}) {
  const calls = { recount: [], assign: [], sweep: [] };
  return {
    calls,
    recount: async (projectId, personIds) => { calls.recount.push([projectId, personIds]); },
    assignAndPersist: async (projectId, imageId, faces, options) => { calls.assign.push({ projectId, imageId, faces, options }); if (assign) return assign(faces); return faces.map((_, index) => ({ personId: `person-${index + 1}`, score: 1, isNew: true })); },
    sweepEmptyPeople: async (projectId) => { calls.sweep.push(projectId); },
  };
}

const config = (overrides = {}) => ({ enabled: () => true, minFaceQuality: () => 0.35, clusterThreshold: () => 0.55, ...overrides });
const LIVE = { albumProofing: false, deletedAt: null };
const READY = { id: "img-1", status: "READY", project: LIVE };

function serviceFor({ repository, clustering = fakeClustering(), configOverrides, model = "buffalo_l" } = {}) {
  const locks = [];
  const service = createIngest({
    repository, clustering, config: config(configOverrides), vectors,
    withProjectLock: (projectId, task) => { locks.push(projectId); return task(); },
    expectedModel: () => model,
  });
  return { service, clustering, locks };
}

const embedding = (first = 3, second = 4) => { const values = new Array(512).fill(0); values[0] = first; values[1] = second; return values; };
const face = (extra = {}) => ({ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, detScore: 0.9, quality: 0.8, embedding: embedding(), ...extra });
const body = (extra = {}) => ({ imageId: "img-1", model: "buffalo_l", dimension: 512, frame: { width: 6000, height: 4000 }, faces: [face()], ...extra });

test("accepted descriptors reach the clustering normalised, quality-gated, under the project lock, and the scan completes with every face counted", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const { service, clustering, locks } = serviceFor({ repository });
  const result = await service.ingest("project-1", body({ faces: [face(), face({ quality: 0.2, embedding: embedding(0, 1) })] }));

  assert.deepEqual(result, { imageId: "img-1", faces: 2, people: 1 });
  assert.equal(clustering.calls.assign.length, 1);
  const call = clustering.calls.assign[0];
  assert.equal(call.projectId, "project-1");
  assert.equal(call.imageId, "img-1");
  assert.deepEqual(call.options, { threshold: 0.55 });
  assert.equal(call.faces.length, 1, "the face below the quality gate is counted but never used to group anybody");
  assert.ok(call.faces[0].vector instanceof Float32Array);
  assert.ok(Math.abs(call.faces[0].vector[0] - 0.6) < 1e-6 && Math.abs(call.faces[0].vector[1] - 0.8) < 1e-6, "a raw embedding is unit-normalised before it is compared");
  assert.equal(call.faces[0].quality, 0.8);
  assert.deepEqual(call.faces[0].box, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  assert.deepEqual(locks, ["project-1"]);
  assert.deepEqual(repository.scans["img-1"], { status: "COMPLETED", attempts: 1, faceCount: 2 });
  assert.deepEqual(clustering.calls.sweep, ["project-1"]);
  assert.deepEqual(clustering.calls.recount, [], "nothing stale, so nobody is recounted");
});

test("a repeated hand-off clears the earlier mappings and recounts their people before the faces are grouped again", async () => {
  const repository = fakeRepository({ images: { "img-1": READY }, mappings: { "img-1": [{ personId: "person-a" }, { personId: "person-b" }] } });
  const { service, clustering } = serviceFor({ repository });
  await service.ingest("project-1", body());
  const order = repository.log.map((entry) => entry[0]);
  assert.deepEqual(order, ["find", "start", "listMappings", "deleteMappings", "complete"]);
  assert.deepEqual(clustering.calls.recount, [["project-1", ["person-a", "person-b"]]]);
  assert.equal(clustering.calls.assign.length, 1);
});

test("descriptors from another model are refused before the photo is even looked up", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const { service, clustering } = serviceFor({ repository, model: "antelopev2" });
  await assert.rejects(service.ingest("project-1", body()), (error) => error.status === 409 && /antelopev2/.test(error.message));
  assert.deepEqual(repository.log, []);
  assert.equal(clustering.calls.assign.length, 0);
});

test("a wrong dimension or a short embedding is a 400 and writes nothing", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const { service } = serviceFor({ repository });
  await assert.rejects(service.ingest("project-1", body({ dimension: 128 })), (error) => error.status === 400);
  await assert.rejects(service.ingest("project-1", body({ faces: [face({ embedding: [1, 2, 3] })] })), (error) => error.status === 400);
  assert.deepEqual(repository.log, []);
});

test("a photo that is not a READY gallery photo of this project is a 404 and no scan is started", async () => {
  const repository = fakeRepository({ images: {
    "img-1": { id: "img-1", status: "PROCESSING", project: LIVE },
    "img-2": { id: "img-2", status: "READY", project: { albumProofing: true, deletedAt: null } },
    "img-3": { id: "img-3", status: "READY", project: { albumProofing: false, deletedAt: new Date() } },
  } });
  const { service, clustering } = serviceFor({ repository });
  for (const imageId of ["img-1", "img-2", "img-3", "img-missing"]) {
    await assert.rejects(service.ingest("project-1", body({ imageId })), (error) => error.status === 404, imageId);
  }
  assert.ok(repository.log.every((entry) => entry[0] === "find"), "only lookups, never a write");
  assert.equal(clustering.calls.assign.length, 0);
});

test("with the People filter switched off the hand-off is the same 409 the queue endpoint gives", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const { service } = serviceFor({ repository, configOverrides: { enabled: () => false } });
  await assert.rejects(service.ingest("project-1", body()), (error) => error.status === 409 && error.message === OFF && /IMAGE_SELECTION_FACE_RECOGNITION_ENABLED/.test(error.message));
  assert.deepEqual(repository.log, []);
});

test("a photo with no usable face still completes with its face count, and nobody is grouped", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const { service, clustering } = serviceFor({ repository });
  const result = await service.ingest("project-1", body({ faces: [] }));
  assert.deepEqual(result, { imageId: "img-1", faces: 0, people: 0 });
  assert.deepEqual(clustering.calls.assign[0].faces, []);
  assert.equal(repository.scans["img-1"].status, "COMPLETED");
});

test("a clustering failure marks the scan FAILED and surfaces the error", async () => {
  const repository = fakeRepository({ images: { "img-1": READY } });
  const clustering = fakeClustering({ assign: () => { throw new Error("database away"); } });
  const { service } = serviceFor({ repository, clustering });
  await assert.rejects(service.ingest("project-1", body()), /database away/);
  assert.equal(repository.scans["img-1"].status, "FAILED");
  assert.equal(repository.scans["img-1"].error, "database away");
});
