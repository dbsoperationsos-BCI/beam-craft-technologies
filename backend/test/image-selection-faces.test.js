const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { personWhere, MAX_PEOPLE } = require("../src/modules/image-selection/faces/filter");
const { decide, recount, sweepEmptyPeople } = require("../src/modules/image-selection/faces/clustering");
const { peopleIndex, searchPeople, withCovers } = require("../src/modules/image-selection/faces/service");
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

test("several people, as the query carries them or as a list, mean photos every one of them is in together", () => {
  // One condition per person, all of which the photo has to meet: Person 1 AND Person 2 AND
  // Person 3 in the same frame, never any one of them.
  assert.deepEqual(personWhere("p1,p2, p3"), { AND: [{ faceMappings: { some: { personId: "p1" } } }, { faceMappings: { some: { personId: "p2" } } }, { faceMappings: { some: { personId: "p3" } } }] });
  assert.deepEqual(personWhere(["p2", "p2", ""]), { faceMappings: { some: { personId: "p2" } } }, "the same person twice is one condition, so nothing is asked for twice");
  assert.deepEqual(personWhere(","), {});
  assert.equal(MAX_PEOPLE, 10, "the gallery's rail stops at the same number the query accepts");
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
const detail = (id, extra = {}) => ({ id, coverBox: { x: 0.1, y: 0.2, w: 0.1, h: 0.15 }, coverImage: image(`img-${id}`), mappings: [{ box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, image: image(`best-${id}`) }], ...extra });
/** The two lists the database answers with: every person in creation order, and the counts in scope. */
const ids = (...list) => list.map((id) => ({ id }));
const counts = (map) => Object.entries(map).map(([personId, total]) => ({ personId, _count: { _all: total } }));

test("people are numbered by how many photographs they are in, and only those with photos in scope are offered", () => {
  const people = peopleIndex(ids("p1", "p2", "p3"), counts({ p1: 4, p3: 2 }));
  // Person 1 is whoever is in the most of them, and the one nobody is in is not offered at all -
  // the ranks close up around them, because a rank is a place in what is being shown.
  assert.deepEqual(people.map((p) => [p.id, p.label, p.photoCount]), [["p1", "Person 1", 4], ["p3", "Person 2", 2]]);
  const cover = withCovers(people, [detail("p1"), detail("p3")], "/g/tok/images");
  assert.equal(cover[0].cover.thumbnailUrl, "/g/tok/images/img-p1/thumbnail");
  assert.deepEqual(cover[0].cover.box, { x: 0.1, y: 0.2, w: 0.1, h: 0.15 });
  assert.equal(cover[0].cover.width, 1600);
});

test("a person whose cover photo was deleted is drawn from their clearest remaining face, and one with no image at all from nothing", () => {
  const people = peopleIndex(ids("p1"), counts({ p1: 2 }));
  const [fallback] = withCovers(people, [detail("p1", { coverImage: null })], "/g/tok/images");
  assert.equal(fallback.cover.thumbnailUrl, "/g/tok/images/best-p1/thumbnail");
  assert.deepEqual(fallback.cover.box, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  const [bare] = withCovers(people, [detail("p1", { coverImage: null, mappings: [] })], "/g/tok/images");
  assert.equal(bare.cover, null);
  assert.equal(bare.label, "Person 1");
  // A page whose faces were not asked for still names and counts everybody on it.
  const [none] = withCovers(people, [], "/g/tok/images");
  assert.equal(none.cover, null);
  assert.equal(none.photoCount, 2);
});

test("the most photographed leads, ties are settled, and the number is never an identity", () => {
  // The brief's own example: the biggest cluster is Person 1, down to the smallest.
  const ranked = peopleIndex(ids("a", "b", "c", "d"), counts({ a: 92, b: 488, c: 210, d: 420 }));
  assert.deepEqual(ranked.map((person) => [person.label, person.photoCount]), [["Person 1", 488], ["Person 2", 420], ["Person 3", 210], ["Person 4", 92]]);
  // The label moved; the cluster's own id did not, and that is what every filter carries.
  assert.deepEqual(ranked.map((person) => person.id), ["b", "d", "c", "a"]);

  // Two people in as many photographs are settled by which was found first, so two reads of the
  // same gallery cannot disagree about who is Person 2.
  const tied = peopleIndex(ids("first", "second"), counts({ first: 40, second: 40 }));
  assert.deepEqual(tied.map((person) => [person.id, person.label]), [["first", "Person 1"], ["second", "Person 2"]]);
  assert.deepEqual(peopleIndex(ids("first", "second"), counts({ first: 40, second: 40 })), tied, "the same answer twice");

  // A rank is a place in the scope being looked at: the same face leads one shoot and not another.
  const elsewhere = peopleIndex(ids("a", "b"), counts({ a: 300, b: 10 }));
  assert.equal(elsewhere.find((person) => person.id === "a").label, "Person 1");
  assert.equal(ranked.find((person) => person.id === "a").label, "Person 4");
});

test("the picker searches the only name a person has - the number the gallery shows them under", () => {
  const people = peopleIndex(ids(...Array.from({ length: 405 }, (_, index) => `p${index + 1}`)), counts(Object.fromEntries(Array.from({ length: 405 }, (_, index) => [`p${index + 1}`, 1]))));
  assert.equal(people.length, 405);
  // "40" is Person 40 and Person 400 to 405 - the number as it is written, not a range.
  assert.deepEqual(searchPeople(people, "40").map((person) => person.label), ["Person 40", "Person 400", "Person 401", "Person 402", "Person 403", "Person 404", "Person 405"]);
  assert.deepEqual(searchPeople(people, " Person 405 ").map((person) => person.label), ["Person 405"]);
  // Case is not a question a number asks, and an empty search is everybody.
  assert.equal(searchPeople(people, "PERSON").length, 405);
  assert.equal(searchPeople(people, "").length, 405);
  assert.equal(searchPeople(people, "nobody").length, 0);
});

test("a named person is found by every word typed, in any order (Word Chunk Search)", () => {
  const named = [{ id: "a", label: "Lokesh Naidu" }, { id: "b", label: "Lokesh Rao" }];
  assert.deepEqual(searchPeople(named, "naidu lok").map((person) => person.id), ["a"]);
  assert.equal(searchPeople(named, "lok xyz").length, 0);
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

test("the People tab is told whether photos are still being looked at, and nothing at all with the switch off", async () => {
  const repository = require("../src/modules/image-selection/faces/repository");
  const service = require("../src/modules/image-selection/faces/service");
  const previous = { own: process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED, engine: process.env.AI_FACE_ENGINE_ENABLED };
  const restore = (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
  const original = { listPersonIds: repository.listPersonIds, countPhotosByPerson: repository.countPhotosByPerson, listPeopleDetails: repository.listPeopleDetails, countPending: repository.countPending, countUnscanned: repository.countUnscanned };
  // The service reads the repository at call time, so the database is stood in for here: two
  // people, nothing left for the worker to queue, and a pending count the test moves.
  let pending = 3;
  repository.listPersonIds = async () => ids("p1", "p2");
  repository.countPhotosByPerson = async () => counts({ p1: 4, p2: 1 });
  repository.listPeopleDetails = async (projectId, list) => list.map((id) => detail(id));
  repository.countPending = async () => pending;
  repository.countUnscanned = async () => 0;
  try {
    process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED = "true";
    const busy = await service.listPeople("proj", { base: "/g/tok/images" });
    assert.equal(busy.available, true);
    assert.equal(busy.processing, true, "photos still waiting or being scanned read as organising");
    assert.deepEqual(busy.people.map((p) => p.label), ["Person 1", "Person 2"], "people already found are offered while more are looked for");
    pending = 0;
    const done = await service.listPeople("proj", { base: "/g/tok/images" });
    assert.equal(done.processing, false);
    // A page of one: the count is everybody the search matched, not everybody on the page, and
    // `hasMore` is what tells the picker there is another page to fetch.
    const first = await service.listPeople("proj", { base: "/g/tok/images", page: 1, pageSize: 1 });
    assert.deepEqual(first.people.map((p) => p.label), ["Person 1"]);
    assert.equal(first.total, 2);
    assert.equal(first.hasMore, true);
    const second = await service.listPeople("proj", { base: "/g/tok/images", page: 2, pageSize: 1 });
    assert.deepEqual(second.people.map((p) => p.label), ["Person 2"]);
    assert.equal(second.hasMore, false);
    process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED = "false";
    // `total` and `hasMore` are the picker's, and an answer that runs no query still carries them
    // so the dialog reads "nobody" rather than reading undefined as a page still to come.
    assert.deepEqual(await service.listPeople("proj", { base: "/g/tok/images" }), { available: false, processing: false, people: [], total: 0, hasMore: false }, "off, the tab is told so and no query runs");
  } finally {
    Object.assign(repository, original);
    restore("IMAGE_SELECTION_FACE_RECOGNITION_ENABLED", previous.own);
    restore("AI_FACE_ENGINE_ENABLED", previous.engine);
  }
});

test("a person the photographer gave a role outlives a moment with no photos; an unlabelled one does not", async () => {
  // A photo being re-described clears its mappings first: for a one-photo person that is an empty moment.
  const calls = [];
  const client = {
    imageSelectionFaceMapping: { findMany: async () => [] },
    imageSelectionFacePerson: {
      deleteMany: async (args) => { calls.push(args.where); return { count: 0 }; },
      findFirst: async () => null,
      update: async () => {},
    },
  };
  await recount("p1", ["person1"], client);
  assert.deepEqual(calls, [{ id: "person1", projectId: "p1", role: null }], "only a person without a role is removed");
  calls.length = 0;
  await sweepEmptyPeople("p1", client);
  assert.deepEqual(calls, [{ projectId: "p1", mappings: { none: {} }, role: null }], "the sweep keeps a roled person too");
});
