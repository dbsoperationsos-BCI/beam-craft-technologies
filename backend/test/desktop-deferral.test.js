const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const flags = require("../src/modules/desktop/flags");
const { createHook } = require("../src/modules/image-selection/faces/hook");
const facesService = require("../src/modules/image-selection/faces/service");
const aiQueue = require("../src/modules/ai-feature/processing/queue");

/*
 * Deferral: a Virtual Curation desktop that will describe its own uploads' faces asks the server
 * not to queue them, so the two engines never race over one photo - and the workers' sweeps take
 * any photo the desktop never came back for. With the desktop switches off the field means nothing
 * and every upload is queued exactly as before.
 */
const ENV = ["DESKTOP_VIRTUAL_CURATION_ENABLED", "DESKTOP_AI_ENABLED", "AI_FACE_ENGINE_ENABLED", "IMAGE_SELECTION_FACE_RECOGNITION_ENABLED"];
async function withEnv(values, run) {
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) { if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name]; }
  try { return await run(); } finally { for (const name of ENV) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
}
const ON = { DESKTOP_VIRTUAL_CURATION_ENABLED: "true", DESKTOP_AI_ENABLED: "true", AI_FACE_ENGINE_ENABLED: "true" };
const src = (relative) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", relative), "utf8");

test("the field is honoured only with both desktop switches on, and only when it says true", async () => {
  await withEnv(ON, () => {
    assert.equal(flags.deferralRequested("true"), true);
    assert.equal(flags.deferralRequested(" TRUE "), true);
    assert.equal(flags.deferralRequested("false"), false);
    assert.equal(flags.deferralRequested("1"), false);
    assert.equal(flags.deferralRequested(undefined), false);
  });
  await withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: "true" }, () => assert.equal(flags.deferralRequested("true"), false, "the AI switch is off"));
  await withEnv({ DESKTOP_AI_ENABLED: "true" }, () => assert.equal(flags.deferralRequested("true"), false, "the desktop switch is off"));
  await withEnv({}, () => assert.equal(flags.deferralRequested("true"), false));
});

function fakeHook({ image = { id: "img-1", projectId: "project-1", status: "READY", project: { albumProofing: false, deletedAt: null } }, enabled = true } = {}) {
  const calls = { upserts: [], enqueued: [] };
  const prisma = {
    imageSelectionUpload: { findUnique: async () => image },
    imageSelectionFaceScan: { upsert: async (args) => { calls.upserts.push(args); return { id: "scan-1", imageId: args.where.imageId, ...args.update }; } },
  };
  const hook = createHook({ prisma, config: { enabled: () => enabled }, queue: { enqueueImage: async (imageId) => { calls.enqueued.push(imageId); return { id: `face-${imageId}` }; } } });
  return { calls, hook };
}

test("recordDeferred writes the waiting scan with no attempts and puts nothing on the queue; queueImage still queues", async () => {
  const { calls, hook } = fakeHook();
  const scan = await hook.recordDeferred("img-1");
  assert.equal(scan.imageId, "img-1");
  assert.equal(calls.upserts.length, 1);
  assert.deepEqual(calls.upserts[0].where, { imageId: "img-1" });
  assert.deepEqual(calls.upserts[0].create, { imageId: "img-1", projectId: "project-1", status: "NOT_PROCESSED" });
  assert.deepEqual(calls.upserts[0].update, { status: "NOT_PROCESSED", attempts: 0, error: null });
  assert.deepEqual(calls.enqueued, [], "deferred means not queued");
  await hook.queueImage("img-1");
  assert.deepEqual(calls.enqueued, ["img-1"]);
});

test("recordDeferred does nothing for a photo that is not a READY gallery photo, and nothing at all with the filter off", async () => {
  const spread = fakeHook({ image: { id: "img-1", projectId: "p", status: "READY", project: { albumProofing: true, deletedAt: null } } });
  assert.equal(await spread.hook.recordDeferred("img-1"), null);
  assert.deepEqual(spread.calls.upserts, []);
  const off = fakeHook({ enabled: false });
  assert.equal(await off.hook.recordDeferred("img-1"), null);
  assert.deepEqual(off.calls.upserts, []);
  assert.equal(off.hook.enqueueAfterReady("img-1"), undefined);
  assert.deepEqual(off.calls.enqueued, []);
});

/**
 * The derivatives controller with its collaborators stood in for: the modules it calls through are
 * replaced on their exports for the test and restored after, the way image-selection-faces.test.js
 * stands in for the repository.
 */
// The route stores what arrives as a WebP and a JPEG, whole and made only of the image's own
// chunks and segments, so the fixtures are real encodes rather than signatures.
let derivativeBytes = null;
async function fixtures() {
  if (!derivativeBytes) {
    const sharp = require("sharp");
    const webp = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#336699" } }).webp({ quality: 76 }).toBuffer();
    const jpeg = await sharp({ create: { width: 160, height: 100, channels: 3, background: "#996633" } }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    derivativeBytes = { webp, jpeg };
  }
  return derivativeBytes;
}
async function receive({ body, env, files }) {
  const { webp, jpeg } = await fixtures();
  const controller = require("../src/modules/image-selection/uploads/derivativeController");
  const repository = require("../src/modules/image-selection/uploads/repository");
  const processingRepository = require("../src/modules/image-selection/processing/repository");
  const r2 = require("../src/modules/image-selection/storage/r2");
  const faceHook = require("../src/modules/image-selection/faces/hook");
  const originals = { repository: { ...repository }, processingRepository: { ...processingRepository }, r2: { ...r2 }, faceHook: { ...faceHook } };
  const calls = { enqueued: [], deferred: [] };
  Object.assign(repository, {
    findProject: async (id) => ({ id, projectName: "Wedding" }),
    findByOriginalPath: async () => null,
    createUpload: async (data) => ({ id: "upload-1", ...data }),
  });
  Object.assign(processingRepository, { markReady: async () => ({ width: 6000, height: 4000 }) });
  Object.assign(r2, { isConfigured: () => true, putObject: async () => {} });
  Object.assign(faceHook, { enqueueAfterReady: (id) => { calls.enqueued.push(id); }, recordDeferred: (id) => { calls.deferred.push(id); return Promise.resolve(null); } });
  const req = { params: { projectId: "project-1" }, user: { id: "user-1" }, body: { fileName: "DSC_0001.JPG", relativePath: "DSC_0001.JPG", mimeType: "image/jpeg", sizeBytes: "1000", width: "6000", height: "4000", ...body }, files: files || { thumbnail: [{ buffer: webp, size: webp.length }], preview: [{ buffer: jpeg, size: jpeg.length }] } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  try {
    await withEnv(env, () => controller.receiveDerivatives(req, res));
  } finally {
    Object.assign(repository, originals.repository);
    Object.assign(processingRepository, originals.processingRepository);
    Object.assign(r2, originals.r2);
    Object.assign(faceHook, originals.faceHook);
  }
  return { res, calls };
}

test("derivatives with deferFaceScan=true and the switches on record the scan for the desktop and queue nothing", async () => {
  const { res, calls } = await receive({ body: { deferFaceScan: "true" }, env: ON });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { data: { id: "upload-1", status: "READY" } });
  assert.deepEqual(calls.deferred, ["upload-1"]);
  assert.deepEqual(calls.enqueued, []);
});

test("a thumbnail that is not a plain WebP, or a preview that is not a plain JPEG, is refused before anything is stored", async () => {
  const { webp, jpeg } = await fixtures();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const swapped = await receive({ body: {}, env: ON, files: { thumbnail: [{ buffer: jpeg, size: jpeg.length }], preview: [{ buffer: webp, size: webp.length }] } });
  assert.equal(swapped.res.statusCode, 400);
  assert.deepEqual(swapped.calls.enqueued, []);
  const pngThumb = await receive({ body: {}, env: ON, files: { thumbnail: [{ buffer: png, size: png.length }], preview: [{ buffer: jpeg, size: jpeg.length }] } });
  assert.equal(pngThumb.res.statusCode, 400);
  const trailing = Buffer.concat([jpeg, Buffer.from("payload")]);
  const polyglot = await receive({ body: {}, env: ON, files: { thumbnail: [{ buffer: webp, size: webp.length }], preview: [{ buffer: trailing, size: trailing.length }] } });
  assert.equal(polyglot.res.statusCode, 400, "bytes after EOI are refused");
});

test("with the switches off the same field is ignored and the photo is queued as every upload is", async () => {
  const off = await receive({ body: { deferFaceScan: "true" }, env: { AI_FACE_ENGINE_ENABLED: "true" } });
  assert.equal(off.res.statusCode, 201);
  assert.deepEqual(off.calls.enqueued, ["upload-1"]);
  assert.deepEqual(off.calls.deferred, []);
  const plain = await receive({ body: {}, env: ON });
  assert.deepEqual(plain.calls.enqueued, ["upload-1"], "switches on but nothing asked: queued as before");
  assert.deepEqual(plain.calls.deferred, []);
});

test("the AI Feature upload reads deferAi through the same switch and skips the queue for a deferred photo", () => {
  // The upload's text fields live in uploadIntake.js (deferAi beside the optimized-upload fields); the controller reads deferAi through the switch.
  assert.match(src("ai-feature/media/uploadIntake.js"), /deferAi: z\.string\(\)\.trim\(\)\.max\(10\)\.optional\(\)/);
  assert.match(src("ai-feature/media/controller.js"), /deferAi: deferralRequested\(fields\.deferAi\)/);
  const service = src("ai-feature/media/service.js");
  assert.match(service, /async function upload\(eventId, file, \{ folderId = null, userId = null, guestId = null, deferAi = false, source = null, thumbnail = null \} = \{\}\)/);
  assert.match(service, /aiStatus: ai\.faceRecognition \? "QUEUED" : "SKIPPED"/, "the row is still recorded QUEUED");
  assert.match(service, /if \(ai\.faceRecognition && !deferAi\) queue\.enqueueMedia\(row\.id\)/);
  // The web's own field count stays under multer's limit with the new field; the desktop's `checksum` made it `fields: 13`.
  assert.match(src("image-selection/uploads/routes.js"), /fields: 13/);
  assert.match(src("image-selection/uploads/validation.js"), /deferFaceScan: z\.string\(\)\.trim\(\)\.max\(10\)\.optional\(\)/);
});

const MINUTE = 60 * 1000;
const NOW = Date.parse("2026-09-29T12:00:00Z");

test("the Image Selection sweep queues only waiting, never-tried scans older than the grace, through the idempotent queueImage", async () => {
  const rows = [
    { id: "s1", imageId: "old-deferred", status: "NOT_PROCESSED", attempts: 0, updatedAt: new Date(NOW - 16 * MINUTE) },
    { id: "s2", imageId: "fresh-deferred", status: "NOT_PROCESSED", attempts: 0, updatedAt: new Date(NOW - 5 * MINUTE) },
    { id: "s3", imageId: "engine-was-down", status: "NOT_PROCESSED", attempts: 1, updatedAt: new Date(NOW - 60 * MINUTE) },
    { id: "s4", imageId: "done", status: "COMPLETED", attempts: 1, updatedAt: new Date(NOW - 60 * MINUTE) },
    { id: "s5", imageId: "not-a-gallery-photo", status: "NOT_PROCESSED", attempts: 0, updatedAt: new Date(NOW - 20 * MINUTE) },
  ];
  const asked = [];
  const listStale = async (olderThan, take, cursor) => {
    asked.push({ olderThan, take, cursor });
    return rows.filter((row) => row.status === "NOT_PROCESSED" && row.attempts === 0 && row.updatedAt < olderThan).map(({ id, imageId }) => ({ id, imageId }));
  };
  const queued = [];
  const queueImage = async (imageId) => { queued.push(imageId); return imageId === "not-a-gallery-photo" ? null : { id: `face-${imageId}` }; };
  await withEnv(ON, async () => {
    const count = await facesService.requeueStaleDeferred({ now: NOW, listStale, queueImage });
    assert.equal(count, 1, "counted as queueImage counts: the spread it refused is not a queued photo");
    assert.deepEqual(queued, ["old-deferred", "not-a-gallery-photo"]);
    assert.deepEqual(asked, [{ olderThan: new Date(NOW - 15 * MINUTE), take: 500, cursor: undefined }]);
  });
  await withEnv({}, async () => {
    queued.length = 0;
    assert.equal(await facesService.requeueStaleDeferred({ now: NOW, listStale, queueImage }), 0, "nothing with the filter off");
    assert.deepEqual(queued, []);
  });
  // The query itself: the repository asks the database for exactly that shape.
  assert.match(src("image-selection/faces/repository.js"), /where: \{ status: "NOT_PROCESSED", attempts: 0, updatedAt: \{ lt: olderThan \} \}/);
});

test("the AI Feature sweep re-adds only QUEUED, never-attempted photos older than the grace, page by page", async () => {
  const rows = [
    { id: "m1", aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: null, createdAt: new Date(NOW - 16 * MINUTE) },
    { id: "m2", aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: null, createdAt: new Date(NOW - 2 * MINUTE) },
    { id: "m3", aiStatus: "QUEUED", aiAttempts: 1, kind: "PHOTO", deletedAt: null, createdAt: new Date(NOW - 60 * MINUTE) },
    { id: "m4", aiStatus: "COMPLETED", aiAttempts: 1, kind: "PHOTO", deletedAt: null, createdAt: new Date(NOW - 60 * MINUTE) },
    { id: "m5", aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: new Date(), createdAt: new Date(NOW - 60 * MINUTE) },
    { id: "m6", aiStatus: "QUEUED", aiAttempts: 0, kind: "VIDEO", deletedAt: null, createdAt: new Date(NOW - 60 * MINUTE) },
    ...Array.from({ length: 500 }, (_, index) => ({ id: `p${String(index).padStart(3, "0")}`, aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: null, createdAt: new Date(NOW - 30 * MINUTE) })),
  ];
  const queries = [];
  const db = { aiEventMedia: { findMany: async ({ where, take, cursor, skip }) => {
    queries.push(where);
    const matching = rows
      .filter((row) => row.aiStatus === where.aiStatus && row.aiAttempts === where.aiAttempts && row.kind === where.kind && row.deletedAt === where.deletedAt && row.createdAt < where.createdAt.lt)
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    const from = cursor ? matching.findIndex((row) => row.id === cursor.id) + (skip || 0) : 0;
    return matching.slice(from, from + take).map(({ id }) => ({ id }));
  } } };
  const enqueued = [];
  const count = await aiQueue.requeueStaleDeferred({ now: NOW, db, enqueue: async (id) => { enqueued.push(id); } });
  assert.equal(count, 501);
  assert.equal(enqueued.length, 501);
  assert.ok(enqueued.includes("m1"));
  for (const left of ["m2", "m3", "m4", "m5", "m6"]) assert.ok(!enqueued.includes(left), `${left} is not a stale deferred photo`);
  assert.equal(new Set(enqueued).size, 501, "the cursor moves: no photo is queued twice across pages");
  assert.equal(queries.length, 2, "501 rows are two pages of 500");
  assert.deepEqual(queries[0], { aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: null, createdAt: { lt: new Date(NOW - 15 * MINUTE) } });
});

test("restart recovery leaves a freshly deferred AI photo to its desktop and takes the rest; with the switches off every waiting row is recovered", async () => {
  const rows = [
    { id: "fresh-deferred", aiStatus: "QUEUED", aiAttempts: 0, createdAt: new Date(NOW - 2 * MINUTE) },
    { id: "old-deferred", aiStatus: "QUEUED", aiAttempts: 0, createdAt: new Date(NOW - 16 * MINUTE) },
    { id: "tried", aiStatus: "QUEUED", aiAttempts: 1, createdAt: new Date(NOW - 2 * MINUTE) },
    { id: "mid-run", aiStatus: "PROCESSING", aiAttempts: 1, createdAt: new Date(NOW - 2 * MINUTE) },
    { id: "done", aiStatus: "COMPLETED", aiAttempts: 1, createdAt: new Date(NOW - 2 * MINUTE) },
  ];
  const excluded = (row, not) => Boolean(not) && row.aiStatus === not.aiStatus && row.aiAttempts === not.aiAttempts && row.createdAt >= not.createdAt.gte;
  const db = { aiEventMedia: { findMany: async ({ where }) => rows.filter((row) => where.aiStatus.in.includes(row.aiStatus) && !excluded(row, where.NOT)).map(({ id }) => ({ id })) } };
  const recover = async () => { const enqueued = []; const count = await aiQueue.recoverPending({ db, now: NOW, enqueue: async (id) => { enqueued.push(id); } }); return { count, enqueued: enqueued.sort() }; };
  await withEnv(ON, async () => {
    const { count, enqueued } = await recover();
    assert.deepEqual(enqueued, ["mid-run", "old-deferred", "tried"], "a never-attempted photo inside the grace is the desktop's, not the worker's");
    assert.equal(count, 3);
  });
  await withEnv({}, async () => {
    assert.deepEqual((await recover()).enqueued, ["fresh-deferred", "mid-run", "old-deferred", "tried"], "nothing is deferred with the switches off, so every waiting row is recovered as before");
  });
});

test("the same at a restart for the client gallery: a freshly deferred scan is left to its desktop", async () => {
  const facesQueue = require("../src/modules/image-selection/faces/queue");
  const rows = [
    { id: "s1", imageId: "fresh-deferred", status: "NOT_PROCESSED", attempts: 0, updatedAt: new Date(NOW - 2 * MINUTE) },
    { id: "s2", imageId: "old-deferred", status: "NOT_PROCESSED", attempts: 0, updatedAt: new Date(NOW - 16 * MINUTE) },
    { id: "s3", imageId: "tried", status: "NOT_PROCESSED", attempts: 2, updatedAt: new Date(NOW - 2 * MINUTE) },
    { id: "s4", imageId: "mid-run", status: "PROCESSING", attempts: 1, updatedAt: new Date(NOW - 2 * MINUTE) },
    { id: "s5", imageId: "done", status: "COMPLETED", attempts: 1, updatedAt: new Date(NOW - 2 * MINUTE) },
  ];
  const excluded = (row, not) => Boolean(not) && row.status === not.status && row.attempts === not.attempts && row.updatedAt >= not.updatedAt.gte;
  const db = { imageSelectionFaceScan: { findMany: async ({ where }) => rows.filter((row) => where.status.in.includes(row.status) && !excluded(row, where.NOT)).map(({ id, imageId }) => ({ id, imageId })) } };
  const recover = async () => { const queued = []; const count = await facesQueue.recoverPending({ db, now: NOW, enqueue: async (imageId) => { queued.push(imageId); } }); return { count, queued: queued.sort() }; };
  await withEnv({ ...ON, IMAGE_SELECTION_FACE_RECOGNITION_ENABLED: "true" }, async () => {
    assert.deepEqual((await recover()).queued, ["mid-run", "old-deferred", "tried"]);
  });
  await withEnv({ IMAGE_SELECTION_FACE_RECOGNITION_ENABLED: "true" }, async () => {
    assert.deepEqual((await recover()).queued, ["fresh-deferred", "mid-run", "old-deferred", "tried"], "every waiting scan with the desktop switches off");
  });
  await withEnv({}, async () => { assert.equal((await recover()).count, 0, "nothing with the filter off"); });
  assert.equal(facesService.DEFERRED_GRACE_MS, facesQueue.DEFERRED_GRACE_MS, "one grace, read by the sweep and the recovery alike");
});

test("both workers run their sweep every ten minutes without keeping the process alive, and only once started", () => {
  for (const [file, call] of [["image-selection/faces/worker.js", "service.requeueStaleDeferred()"], ["ai-feature/processing/worker.js", "requeueStaleDeferred()"]]) {
    const worker = src(file);
    assert.match(worker, /const DEFERRED_SWEEP_MS = 10 \* 60 \* 1000;/);
    assert.ok(worker.includes(call), `${file} calls ${call}`);
    assert.match(worker, /const sweep = setInterval\(/);
    assert.match(worker, /sweep\.unref\?\.\(\);/);
    // Inside startWorker, after the worker exists: the sweep starts with the worker and never without it.
    assert.ok(worker.indexOf("const sweep = setInterval(") > worker.indexOf("worker = new Worker("), `${file} sweeps only once the worker has started`);
    assert.ok(worker.indexOf("const sweep = setInterval(") < worker.indexOf("return worker;\n}"), `${file} starts the sweep inside startWorker`);
  }
  assert.equal(facesService.DEFERRED_GRACE_MS, 15 * MINUTE);
  assert.equal(aiQueue.DEFERRED_GRACE_MS, 15 * MINUTE);
});
