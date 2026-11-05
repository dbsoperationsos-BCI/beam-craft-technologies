const test = require("node:test");
const assert = require("node:assert/strict");
const { createSceneBackfill, PAGE } = require("../src/modules/image-selection/ai-culling/scene/backfill");
const { MAX_BATCH } = require("../src/modules/image-selection/ai-culling/scene/engine");
const { cullEligible } = require("../src/modules/image-selection/gallery/repository");

/*
 * The client gallery's Scene filter reads the scene cache the culling run leaves on each photo. A
 * project whose photos never went through a culling run has none, so the first ask reads them in
 * the background through the same engine and the same cache writes. These pin that lifecycle with
 * a fake engine, database and repository: what is read, what is written, what is skipped, what is
 * left alone after a failure, and what the gallery is told meanwhile.
 */

const VERSION = "clip/event@2";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = async (backfill, projectId) => { for (let i = 0; i < 200 && backfill.isRunning(projectId); i += 1) await sleep(5); assert.equal(backfill.isRunning(projectId), false, "the pass ended"); };

function fakeWorld({ photos, enabled = true, status = "ready", version = VERSION, failBytesFor = [], refuse = [], throwOn = 0, throwMessage = "Storage unreachable.", live = () => true, maxPasses }) {
  // uploadId -> engineVersion of the stored reading (a seed may put an older version on a photo).
  const read = new Map(photos.filter((p) => p.readAt).map((p) => [p.id, p.readAt]));
  const wheres = [];
  const matches = (p, where) => {
    const skip = where.id?.notIn || [];
    return p.projectId === where.projectId && read.get(p.id) !== where.sceneCache.none.engineVersion && !skip.includes(p.id) && (!where.id?.gt || p.id > where.id.gt) && p.status !== "HELD";
  };
  const prisma = {
    imageSelectionUpload: {
      findMany: async ({ where, take }) => { wheres.push(where); return photos.filter((p) => matches(p, where)).slice(0, take).map((p) => ({ id: p.id, previewKey: p.previewKey || null, processedName: p.processedName || null })); },
      count: async ({ where }) => { wheres.push(where); return photos.filter((p) => matches(p, where)).length; },
    },
    imageSelectionProject: { findFirst: async ({ where }) => (live(where.id) ? { id: where.id } : null) },
  };
  const writes = [];
  const prunes = [];
  const repository = {
    saveSceneCache: async (rows) => { writes.push(...rows); rows.forEach((row) => read.set(row.uploadId, row.engineVersion)); },
    pruneSceneCache: async (ids, v) => { prunes.push([ids, v]); },
  };
  const batches = [];
  let calls = 0;
  let starts = 0;
  const engine = {
    isReady: async () => { starts += 1; return status === "ready"; },
    health: () => ({ status }),
    version: () => version,
    describeBatch: async (buffers) => {
      calls += 1;
      if (throwOn && calls === throwOn) throw new Error(throwMessage);
      batches.push(buffers.length);
      return buffers.map((buffer) => (refuse.includes(buffer.toString()) ? { error: "unreadable" } : { scene: `S_${buffer}`, confidence: 0.9, accidental: false, aesthetic: 5.5, embedding: null }));
    },
  };
  const loads = [];
  const loadBytes = async (upload) => { loads.push(upload.id); if (failBytesFor.includes(upload.id)) throw new Error("no preview"); return Buffer.from(upload.id); };
  const log = { lines: [], log: (line) => log.lines.push(line), warn: (line) => log.lines.push(line) };
  let clock = 1_000_000;
  const world = { writes, prunes, batches, loads, wheres, read, log, starts: () => starts, tick: (ms) => { clock += ms; } };
  world.backfill = createSceneBackfill({ prisma, repository, engine, loadBytes, enabled: () => enabled, eligible: cullEligible, failedCooldownMs: 1000, startRetryMs: 1000, maxPasses, now: () => clock, log });
  return world;
}

const photos = (projectId, count) => Array.from({ length: count }, (_, i) => ({ id: `${projectId}-${String(i + 1).padStart(3, "0")}`, projectId, previewKey: `k${i}` }));

test("the first ask reads every unread photo in the engine's own batches and writes the culling run's cache rows", async () => {
  const world = fakeWorld({ photos: photos("p1", 20) });
  assert.equal(await world.backfill.pending("p1"), true, "there is work to come, and the gallery is told so");
  assert.equal(world.backfill.isRunning("p1"), true);
  assert.equal(await world.backfill.pending("p1"), true, "asked again while running, nothing is started twice");
  await settled(world.backfill, "p1");
  assert.equal(world.writes.length, 20);
  assert.deepEqual(world.writes[0], { uploadId: "p1-001", engineVersion: VERSION, sceneLabel: "S_p1-001", sceneConfidence: 0.9, accidental: false, aestheticRaw: 5.5, embedding: null }, "the same row shape the culling run's scene stage writes");
  assert.ok(world.batches.every((size) => size <= MAX_BATCH), `never more than the engine's batch: ${world.batches}`);
  assert.equal(world.prunes.length, world.batches.length, "older engine versions are pruned for the photos just read, as the run does");
  assert.equal(await world.backfill.pending("p1"), false, "once every photo is read there is nothing to come");
  assert.match(world.log.lines.join("\n"), /read 20 photos of project p1/);
});

test("only the photos the gallery can show, without a reading at this engine version, are read", async () => {
  const list = [...photos("p2", 4), { id: "p2-held", projectId: "p2", status: "HELD" }, { id: "p2-old", projectId: "p2", readAt: "clip/event@1" }, { id: "p2-done", projectId: "p2", readAt: VERSION }];
  const world = fakeWorld({ photos: list });
  await world.backfill.describeProject("p2", VERSION);
  const where = world.wheres[0];
  assert.equal(where.status, "READY");
  assert.deepEqual({ cullRejectedAt: where.cullRejectedAt, cullingHoldAt: where.cullingHoldAt, editingHoldAt: where.editingHoldAt }, cullEligible, "the listing's own eligibility: a held or rejected photo is never read for the gallery");
  assert.deepEqual(where.sceneCache, { none: { engineVersion: VERSION } });
  assert.deepEqual(world.writes.map((row) => row.uploadId).sort(), ["p2-001", "p2-002", "p2-003", "p2-004", "p2-old"], "a reading from an older engine version counts as unread; one at this version does not");
});

test("a photo without a readable preview, or one the engine refuses, is left alone for the cooldown and then tried again", async () => {
  const world = fakeWorld({ photos: photos("p3", 5), failBytesFor: ["p3-002"], refuse: ["p3-004"] });
  assert.equal(await world.backfill.pending("p3"), true);
  await settled(world.backfill, "p3");
  assert.deepEqual(world.writes.map((row) => row.uploadId), ["p3-001", "p3-003", "p3-005"]);
  assert.match(world.log.lines.join("\n"), /read 3 photos of project p3 .*\(2 could not be read; tried again in 0 min\)/);
  assert.deepEqual(world.backfill.parkedPhotos("p3").sort(), ["p3-002", "p3-004"]);
  const loadsBefore = world.loads.length;
  assert.equal(await world.backfill.pending("p3"), false, "nothing to come while the two are parked: the gallery stops saying 'organising'");
  assert.equal(world.loads.length, loadsBefore, "and their previews are not fetched again on every poll");
  world.tick(1001);
  assert.equal(await world.backfill.pending("p3"), true, "after the cooldown they are tried once more");
  await settled(world.backfill, "p3");
  assert.deepEqual(world.backfill.parkedPhotos("p3").sort(), ["p3-002", "p3-004"], "still unreadable, parked again");
});

test("a pass that fails outright parks the project for the cooldown instead of being restarted by the next poll", async () => {
  const world = fakeWorld({ photos: photos("p4", 3), throwOn: 1 });
  assert.equal(await world.backfill.pending("p4"), true);
  await settled(world.backfill, "p4");
  assert.match(world.log.lines.join("\n"), /could not read project p4: Storage unreachable\./);
  assert.equal(world.writes.length, 0);
  assert.equal(await world.backfill.pending("p4"), false, "parked");
  world.tick(1001);
  assert.equal(await world.backfill.pending("p4"), true, "and tried again after the cooldown");
  await settled(world.backfill, "p4");
  assert.equal(world.writes.length, 3);
  // The engine stopped under another caller is the one failure tried once more at once, as the run does.
  const stopped = fakeWorld({ photos: photos("p4b", 3), throwOn: 1, throwMessage: "The scene engine stopped." });
  assert.equal(await stopped.backfill.pending("p4b"), true);
  await settled(stopped.backfill, "p4b");
  assert.equal(stopped.writes.length, 3, "retried once, nothing parked");
  assert.equal(await stopped.backfill.pending("p4b"), false);
});

test("nothing happens with the engine off; a starting engine is 'organising', an offline one is started once per cooldown, a disabled one never", async () => {
  const off = fakeWorld({ photos: photos("p5", 3), enabled: false });
  assert.equal(await off.backfill.pending("p5"), false);
  assert.equal(off.writes.length, 0);
  const starting = fakeWorld({ photos: photos("p6", 3), status: "starting" });
  assert.equal(await starting.backfill.pending("p6"), true, "the model is still loading: the answer will come");
  assert.equal(starting.writes.length, 0);
  const offline = fakeWorld({ photos: photos("p7", 3), status: "offline" });
  assert.equal(await offline.backfill.pending("p7"), false);
  assert.equal(await offline.backfill.pending("p7"), false);
  assert.equal(offline.starts(), 1, "one start asked for, not one per poll");
  offline.tick(1001);
  await offline.backfill.pending("p7");
  assert.equal(offline.starts(), 2, "and again after the cooldown");
  const disabled = fakeWorld({ photos: photos("p8", 3), status: "disabled" });
  assert.equal(await disabled.backfill.pending("p8"), false);
  assert.equal(disabled.starts(), 0);
  const empty = fakeWorld({ photos: [] });
  assert.equal(await empty.backfill.pending("p9"), false);
});

test("at most MAX_PASSES projects are read at once; the rest are told to ask again, and a project no longer live is stopped", async () => {
  const world = fakeWorld({ photos: [...photos("q1", PAGE + 1), ...photos("q2", PAGE + 1), ...photos("q3", 2)], maxPasses: 2 });
  assert.equal(await world.backfill.pending("q1"), true);
  assert.equal(await world.backfill.pending("q2"), true);
  assert.equal(await world.backfill.pending("q3"), true, "still to come");
  assert.equal(world.backfill.isRunning("q3"), false, "but not started while two passes run");
  await settled(world.backfill, "q1"); await settled(world.backfill, "q2");
  assert.equal(await world.backfill.pending("q3"), true);
  await settled(world.backfill, "q3");
  assert.equal(world.writes.length, PAGE * 2 + 4);
  const gone = fakeWorld({ photos: photos("q4", PAGE * 2), live: () => false });
  assert.deepEqual(await gone.backfill.describeProject("q4", VERSION), { described: 0, failed: 0 }, "a deleted project is not read");
});

test("a large gallery is read a page at a time, in id order, to the end", async () => {
  const world = fakeWorld({ photos: photos("p10", PAGE * 2 + 3) });
  const result = await world.backfill.describeProject("p10", VERSION);
  assert.equal(result.described, PAGE * 2 + 3);
  assert.equal(new Set(world.writes.map((row) => row.uploadId)).size, PAGE * 2 + 3, "each photo once");
});

test("the import's reader is the same backfill over the photos held for culling, with its own words in the log", () => {
  const backfill = require("../src/modules/image-selection/ai-culling/scene/backfill");
  assert.equal(typeof backfill.heldForCulling.pending, "function");
  assert.equal(typeof backfill.heldForCulling.describeProject, "function");
  assert.notEqual(backfill.heldForCulling, backfill, "its own pass and its own parking, beside the gallery's");
  const source = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/ai-culling/scene/backfill"), "utf8");
  assert.match(source, /const heldForCulling = createSceneBackfill\(\{ \.\.\.realDeps, eligible: \{ cullingHoldAt: \{ not: null \} \}, purpose: "ahead of their culling run" \}\);/);
});
