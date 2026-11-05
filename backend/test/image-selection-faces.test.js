const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { personWhere } = require("../src/modules/image-selection/faces/filter");
const { decide } = require("../src/modules/image-selection/faces/clustering");
const { serializePeople } = require("../src/modules/image-selection/faces/service");
const { toFractions } = require("../src/modules/image-selection/faces/processing");
const config = require("../src/modules/image-selection/faces/config");
const hook = require("../src/modules/image-selection/faces/hook");

/*
 * The client gallery's People filter is a layer beside Image Selection, not a change to it. These
 * tests pin the pieces that decide things without a database: how a person is chosen for a face,
 * how the People row is numbered and drawn, and that with the switch off nothing happens at all.
 */

// A handful of unit vectors that are plainly "the same face" or plainly not.
const unit = (values) => { const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)); return Float32Array.from(values.map((v) => v / norm)); };
const A = unit([1, 0, 0, 0]);
const A_AGAIN = unit([0.95, 0.1, 0.05, 0]);
const B = unit([0, 1, 0, 0]);
const face = (vector, quality = 0.8, box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }) => ({ vector, quality, box });

test("the person filter is one more condition on the listing, and nothing when nobody is asked for", () => {
  assert.deepEqual(personWhere(undefined), {});
  assert.deepEqual(personWhere(""), {});
  assert.deepEqual(personWhere("p1"), { faceMappings: { some: { personId: "p1" } } });
});

test("several people, as the query carries them or as a list, mean photos any of them is in", () => {
  assert.deepEqual(personWhere("p1,p2, p3"), { faceMappings: { some: { personId: { in: ["p1", "p2", "p3"] } } } });
  assert.deepEqual(personWhere(["p2", "p2", ""]), { faceMappings: { some: { personId: "p2" } } });
  assert.deepEqual(personWhere(","), {});
});

test("a face joins the person it resembles and a stranger starts a new one", () => {
  const people = [{ id: "p-a", vector: A, faceCount: 3, coverQuality: 0.5 }];
  const decisions = decide([face(A_AGAIN), face(B)], people, { threshold: 0.55 });
  const joined = decisions.find((d) => d.face.vector === A_AGAIN);
  const started = decisions.find((d) => d.face.vector === B);
  assert.equal(joined.person.id, "p-a");
  assert.equal(joined.isNew, false);
  assert.ok(joined.score > 0.9);
  assert.equal(started.person.id, null);
  assert.equal(started.isNew, true);
  assert.equal(started.score, 1);
  assert.equal(people.length, 2);
  // The centroid moved and the count went up, so the next photo is compared with four faces' worth.
  assert.equal(people[0].faceCount, 4);
});

test("two faces in one photo are never the same person, however alike", () => {
  const people = [{ id: "p-a", vector: A, faceCount: 1, coverQuality: 0.5 }];
  const decisions = decide([face(A, 0.9), face(A_AGAIN, 0.7)], people, { threshold: 0.55 });
  const ids = decisions.map((d) => d.person);
  assert.notEqual(ids[0], ids[1]);
  // The clearer face is placed first and takes the person it matches; the other starts its own.
  assert.equal(decisions[0].face.quality, 0.9);
  assert.equal(decisions[0].person.id, "p-a");
  assert.equal(decisions[1].isNew, true);
});

test("the engine's pixel box becomes fractions of the frame that survive a resize", () => {
  assert.deepEqual(toFractions([100, 50, 300, 250], 1000, 500), { x: 0.1, y: 0.1, w: 0.2, h: 0.4 });
});

const image = (id) => ({ id, thumbnailKey: null, width: 1600, height: 1067 });
const row = (id, count, extra = {}) => ({ id, coverBox: { x: 0.1, y: 0.2, w: 0.1, h: 0.15 }, coverImage: image(`img-${id}`), mappings: [{ box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, image: image(`best-${id}`) }], _count: { mappings: count }, ...extra });

test("people are numbered by the order they were found, across the whole project, and only those in the folder are offered", () => {
  const people = serializePeople([row("p1", 4), row("p2", 0), row("p3", 2)], "/g/tok/images");
  assert.deepEqual(people.map((p) => [p.id, p.label, p.photoCount]), [["p1", "Person 1", 4], ["p3", "Person 3", 2]]);
  assert.equal(people[0].cover.thumbnailUrl, "/g/tok/images/img-p1/thumbnail");
  assert.deepEqual(people[0].cover.box, { x: 0.1, y: 0.2, w: 0.1, h: 0.15 });
  assert.equal(people[0].cover.width, 1600);
});

test("a person whose cover photo was deleted is drawn from their clearest remaining face, and one with no image at all from nothing", () => {
  const [fallback] = serializePeople([row("p1", 2, { coverImage: null })], "/g/tok/images");
  assert.equal(fallback.cover.thumbnailUrl, "/g/tok/images/best-p1/thumbnail");
  assert.deepEqual(fallback.cover.box, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  const [bare] = serializePeople([row("p1", 1, { coverImage: null, mappings: [] })], "/g/tok/images");
  assert.equal(bare.cover, null);
  assert.equal(bare.label, "Person 1");
});

test("the filter follows the face engine's switch unless told otherwise, and off, the upload hook does nothing at all", () => {
  const previous = { own: process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED, engine: process.env.AI_FACE_ENGINE_ENABLED };
  const restore = (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
  delete process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED;
  delete process.env.AI_FACE_ENGINE_ENABLED;
  try {
    assert.equal(config.enabled(), false);
    // Returns synchronously with nothing queued: no promise, no database call, nothing awaited.
    assert.equal(hook.enqueueAfterReady("upload-1"), undefined);
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    assert.equal(config.enabled(), true, "a studio that switched the engine on gets faces in its galleries");
    process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED = "false";
    assert.equal(config.enabled(), false, "the engine can be kept for the AI Feature alone");
    delete process.env.AI_FACE_ENGINE_ENABLED;
    process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED = "true";
    assert.equal(config.enabled(), true);
  } finally {
    restore("IMAGE_SELECTION_FACE_RECOGNITION_ENABLED", previous.own);
    restore("AI_FACE_ENGINE_ENABLED", previous.engine);
  }
});

test("the thresholds default to the AI Feature's and are clamped when set", () => {
  const previous = process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD;
  delete process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD;
  try {
    assert.equal(config.clusterThreshold(), 0.55);
    assert.equal(config.minFaceQuality(), 0.35);
    process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD = "5";
    assert.equal(config.clusterThreshold(), 0.95);
    process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD = "nonsense";
    assert.equal(config.clusterThreshold(), 0.55);
  } finally {
    if (previous === undefined) delete process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD; else process.env.IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD = previous;
  }
});

test("the three face tables arrive by migration, cascading from the photo and the project", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260922130000_image_selection_face_people", "migration.sql"), "utf8");
  for (const table of ["image_selection_face_scan", "image_selection_face_person", "image_selection_face_mapping"]) assert.match(sql, new RegExp(`CREATE TABLE \`${table}\``));
  assert.match(sql, /`image_selection_face_mapping_image_id_fkey` FOREIGN KEY \(`image_id`\) REFERENCES `image_selection_upload`\(`id`\) ON DELETE CASCADE/);
  assert.match(sql, /`image_selection_face_scan_image_id_fkey` FOREIGN KEY \(`image_id`\) REFERENCES `image_selection_upload`\(`id`\) ON DELETE CASCADE/);
  assert.match(sql, /`image_selection_face_person_cover_image_id_fkey` FOREIGN KEY \(`cover_image_id`\) REFERENCES `image_selection_upload`\(`id`\) ON DELETE SET NULL/);
  // Not a column on an existing table.
  assert.doesNotMatch(sql, /ALTER TABLE `image_selection_upload` ADD COLUMN/);
  assert.doesNotMatch(sql, /ALTER TABLE `image_selection_project` ADD COLUMN/);
});
