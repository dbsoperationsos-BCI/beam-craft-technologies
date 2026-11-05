const test = require("node:test");
const assert = require("node:assert/strict");
const { createIngest } = require("../src/modules/ai-feature/processing/ingest");
const vectors = require("../src/modules/ai-feature/shared/vectors");
const { mergeGroup } = require("../src/modules/ai-feature/shared/settingsDefaults");

/*
 * The Virtual Curation desktop's hand-off into an event's face pipeline. With every side effect
 * faked, these pin that the rows written are the rows `processMedia` writes - encoded vector,
 * model, dimension, box as fractions - that clustering and matching follow the event's settings,
 * that the desktop's crop is used when sent and the server's own when not, and what is refused.
 */
function fakes({ media = {}, staleFaces = [], settings = {}, event = "event-1" } = {}) {
  const calls = { mediaUpdates: [], facesCreated: [], deletedFaces: [], deletedKeys: [], recount: [], assign: [], match: [], activity: [], announce: [], failed: [], previewReads: 0, thumbsFromBase64: [], thumbsFromPreview: [] };
  const ai = mergeGroup("ai", settings);
  let nextFace = 1;
  const prisma = {
    aiEventMedia: {
      findFirst: async ({ where }) => { const row = media[where.id]; return row && row.eventId === where.eventId && !row.deletedAt ? row : null; },
      update: async ({ where, data }) => { calls.mediaUpdates.push({ id: where.id, data }); const row = media[where.id]; row.aiAttempts = (row.aiAttempts || 0) + (data.aiAttempts?.increment || 0); return { ...row, ...data, aiAttempts: row.aiAttempts }; },
    },
    aiEventFace: {
      findMany: async () => staleFaces,
      deleteMany: async ({ where }) => { calls.deletedFaces.push(where.mediaId); },
      create: async ({ data }) => { const id = `face-${nextFace++}`; calls.facesCreated.push({ id, ...data }); return { id }; },
    },
  };
  const deps = {
    prisma,
    storage: { deletePrivateKeys: async (keys) => { calls.deletedKeys.push(keys); } },
    vectors,
    activity: { EVENTS: { AI_PROCESSING_STARTED: "AI_PROCESSING_STARTED" }, systemActor: () => ({ actorType: "SYSTEM" }), record: async (...args) => { calls.activity.push(args); } },
    people: { recount: async (eventId, ids) => { calls.recount.push([eventId, ids]); }, assignFaces: async (eventId, faces, settingsUsed) => { calls.assign.push({ eventId, faces, settingsUsed }); return faces.map((face) => ({ faceId: face.id, personId: `person-${face.id}` })); } },
    matching: { matchFacesToGuests: async (eventId, mediaId, faces, settingsUsed) => { calls.match.push({ eventId, mediaId, faces, settingsUsed }); return faces.map(() => ({ id: "match" })); } },
    loadEvent: async (eventId) => { if (eventId !== event) throw Object.assign(new Error("Event not found."), { status: 404 }); return { id: eventId }; },
    aiSettingsFor: async () => ai,
    announceIfFinished: async (eventId) => { calls.announce.push(eventId); },
    failMedia: async (mediaId, message) => { calls.failed.push([mediaId, message]); },
    expectedModel: () => "buffalo_l",
    readPreview: async () => { calls.previewReads += 1; return { frame: Buffer.from("preview"), width: 2000, height: 1000 }; },
    thumbnails: {
      fromBase64: async (eventId, base64) => { calls.thumbsFromBase64.push(base64); return "ai-feature/event-1/faceThumbs/desktop.webp"; },
      fromPreview: async (eventId, preview, box) => { calls.thumbsFromPreview.push(box); return "ai-feature/event-1/faceThumbs/server.webp"; },
    },
  };
  return { calls, deps, service: createIngest(deps) };
}

const PHOTO = { id: "media-1", eventId: "event-1", kind: "PHOTO", fileName: "DSC_0001.JPG", previewKey: "ai-feature/event-1/previews/a.jpg", aiStatus: "QUEUED", aiAttempts: 0, deletedAt: null };
const embedding = (first = 3, second = 4) => { const values = new Array(512).fill(0); values[0] = first; values[1] = second; return values; };
const face = (extra = {}) => ({ box: { x: 0.12345678, y: 0.2, w: 0.3, h: 0.4 }, detScore: 0.9, quality: 0.8, embedding: embedding(), ...extra });
const body = (extra = {}) => ({ model: "buffalo_l", dimension: 512, frame: { width: 6000, height: 4000 }, faces: [face()], ...extra });

test("rows are written as processMedia writes them - encoded vector, model, dimension, rounded box - then clustered, matched and completed", async () => {
  const { calls, service } = fakes({ media: { "media-1": { ...PHOTO } } });
  const thumb = Buffer.from("RIFF....WEBP").toString("base64");
  const result = await service.ingest("event-1", "media-1", body({ faces: [face({ thumbnail: thumb }), face({ quality: 0.2, embedding: embedding(0, 1) }), face({ box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } })] }));

  assert.deepEqual(result, { mediaId: "media-1", faces: 3, people: 2, matches: 2 });
  assert.equal(calls.facesCreated.length, 3);
  const first = calls.facesCreated[0];
  assert.equal(first.eventId, "event-1");
  assert.equal(first.mediaId, "media-1");
  assert.deepEqual(first.box, { x: 0.1235, y: 0.2, w: 0.3, h: 0.4 });
  assert.equal(first.detScore, 0.9);
  assert.equal(first.quality, 0.8);
  assert.deepEqual(first.embedding.create, { eventId: "event-1", model: "buffalo_l", dimension: 512, vector: vectors.encode(embedding()) });
  assert.equal(first.thumbnailKey, "ai-feature/event-1/faceThumbs/desktop.webp", "the desktop's crop is used when it sent one");
  assert.deepEqual(calls.thumbsFromBase64, [thumb]);
  assert.equal(calls.facesCreated[1].thumbnailKey, "ai-feature/event-1/faceThumbs/server.webp", "a face without a crop is cut from the preview");
  assert.equal(calls.previewReads, 1, "the preview is read once for every face that needs it");
  assert.equal(calls.thumbsFromPreview.length, 2);

  assert.equal(calls.assign.length, 1);
  assert.deepEqual(calls.assign[0].faces.map((f) => f.id), ["face-1", "face-3"], "the face below minFaceQuality is stored but never grouped");
  assert.ok(Math.abs(calls.assign[0].faces[0].vector[0] - 0.6) < 1e-6, "the vector handed to clustering is unit-normalised");
  assert.equal(calls.assign[0].settingsUsed.clusterThreshold, 0.55);
  assert.equal(calls.match.length, 1);
  assert.equal(calls.match[0].mediaId, "media-1");
  assert.equal(calls.match[0].faces.length, 2);

  assert.deepEqual(calls.mediaUpdates[0].data.aiStatus, "PROCESSING");
  assert.deepEqual(calls.mediaUpdates[0].data.aiAttempts, { increment: 1 });
  const done = calls.mediaUpdates.at(-1).data;
  assert.equal(done.aiStatus, "COMPLETED");
  assert.equal(done.faceCount, 3);
  assert.equal(done.aiError, null);
  assert.ok(done.aiCompletedAt instanceof Date);
  assert.deepEqual(calls.announce, ["event-1"]);
  assert.equal(calls.activity.length, 1, "the first attempt is announced on the timeline, as the worker's is");
  assert.equal(calls.activity[0][1], "AI_PROCESSING_STARTED");
  assert.deepEqual(calls.failed, []);
});

test("a second hand-off clears the earlier faces, their private crops and recounts their people first", async () => {
  const stale = [{ id: "old-1", thumbnailKey: "ai-feature/event-1/faceThumbs/old.webp", personId: "person-a" }, { id: "old-2", thumbnailKey: null, personId: "person-a" }, { id: "old-3", thumbnailKey: "ai-feature/event-1/faceThumbs/old3.webp", personId: null }];
  const { calls, service } = fakes({ media: { "media-1": { ...PHOTO, aiStatus: "COMPLETED", aiAttempts: 1 } }, staleFaces: stale });
  await service.ingest("event-1", "media-1", body());
  assert.deepEqual(calls.deletedFaces, ["media-1"]);
  assert.deepEqual(calls.deletedKeys, [["ai-feature/event-1/faceThumbs/old.webp", "ai-feature/event-1/faceThumbs/old3.webp"]]);
  assert.deepEqual(calls.recount, [["event-1", ["person-a"]]]);
  assert.equal(calls.activity.length, 0, "not the first attempt, so nothing is announced again");
  assert.equal(calls.facesCreated.length, 1);
});

test("with face recognition off for the event the hand-off is a 409 and the photo is not touched", async () => {
  const { calls, service } = fakes({ media: { "media-1": { ...PHOTO } }, settings: { faceRecognition: false } });
  await assert.rejects(service.ingest("event-1", "media-1", body()), (error) => error.status === 409 && /switched off/.test(error.message));
  assert.deepEqual(calls.mediaUpdates, []);
  assert.deepEqual(calls.facesCreated, []);
});

test("clustering and matching follow the event's settings", async () => {
  const noCluster = fakes({ media: { "media-1": { ...PHOTO } }, settings: { faceClustering: false } });
  const result = await noCluster.service.ingest("event-1", "media-1", body());
  assert.equal(noCluster.calls.assign.length, 0);
  assert.equal(noCluster.calls.match.length, 1);
  assert.deepEqual(result, { mediaId: "media-1", faces: 1, people: 0, matches: 1 });

  const noMatch = fakes({ media: { "media-1": { ...PHOTO } }, settings: { automaticMatching: false } });
  await noMatch.service.ingest("event-1", "media-1", body());
  assert.equal(noMatch.calls.assign.length, 1);
  assert.equal(noMatch.calls.match.length, 0);

  const strict = fakes({ media: { "media-1": { ...PHOTO } }, settings: { minFaceQuality: 0.9 } });
  await strict.service.ingest("event-1", "media-1", body());
  assert.equal(strict.calls.assign.length, 0, "nothing usable, so clustering is not asked");
  assert.equal(strict.calls.facesCreated.length, 1, "the face is still stored");
});

test("an unknown, deleted, other-event or non-photo media is a 404 before anything is written", async () => {
  const { calls, service } = fakes({ media: {
    "gone": { ...PHOTO, id: "gone", deletedAt: new Date() },
    "video": { ...PHOTO, id: "video", kind: "VIDEO" },
    "elsewhere": { ...PHOTO, id: "elsewhere", eventId: "event-2" },
  } });
  for (const mediaId of ["gone", "video", "elsewhere", "missing"]) {
    await assert.rejects(service.ingest("event-1", mediaId, body()), (error) => error.status === 404, mediaId);
  }
  await assert.rejects(service.ingest("event-9", "media-1", body()), (error) => error.status === 404, "unknown event");
  assert.deepEqual(calls.mediaUpdates, []);
  assert.deepEqual(calls.facesCreated, []);
});

test("descriptors from another model or width are refused before the media is looked up", async () => {
  const { calls, service } = fakes({ media: { "media-1": { ...PHOTO } } });
  await assert.rejects(service.ingest("event-1", "media-1", body({ model: "antelopev2" })), (error) => error.status === 409);
  await assert.rejects(service.ingest("event-1", "media-1", body({ dimension: 256 })), (error) => error.status === 400);
  assert.deepEqual(calls.mediaUpdates, []);
});

test("a failure after PROCESSING is handed to failMedia and surfaced", async () => {
  const { calls, deps } = fakes({ media: { "media-1": { ...PHOTO } } });
  const broken = createIngest({ ...deps, people: { recount: async () => {}, assignFaces: async () => { throw new Error("database away"); } } });
  await assert.rejects(broken.ingest("event-1", "media-1", body()), /database away/);
  assert.deepEqual(calls.failed, [["media-1", "database away"]]);
  assert.equal(calls.mediaUpdates.at(-1).data.aiStatus, "PROCESSING", "the completion write never happened");
});

test("a preview that cannot be read costs the crop, never the hand-off", async () => {
  const { calls, deps } = fakes({ media: { "media-1": { ...PHOTO } } });
  const service = createIngest({ ...deps, readPreview: async () => { calls.previewReads += 1; throw new Error("storage away"); } });
  const result = await service.ingest("event-1", "media-1", body({ faces: [face(), face()] }));
  assert.equal(result.faces, 2);
  assert.equal(calls.facesCreated[0].thumbnailKey, null);
  assert.equal(calls.previewReads, 1, "asked once, not once per face");
  assert.deepEqual(calls.failed, []);
});
