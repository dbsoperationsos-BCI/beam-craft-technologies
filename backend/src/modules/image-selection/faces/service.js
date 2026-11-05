const repository = require("./repository");
const { matchesWordChunks } = require("../../../services/wordChunks");
const config = require("./config");
const engine = require("./engine");
const hook = require("./hook");
// The grace a deferred photo is left to its desktop: declared beside the queue, read by the sweep here and by the restart recovery there.
const { DEFERRED_GRACE_MS } = require("./queue");
const r2 = require("../storage/r2");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/**
 * The circle drawn for one person: the photo that stands for them and where in that frame their
 * face is, so it is cut from the photo's existing thumbnail rather than from a stored crop. Their
 * clearest remaining face steps in when the cover photo has been deleted, and a person with no
 * photo left at all has no circle.
 */
function coverOf(row, base) {
  const fallback = row?.mappings?.[0] || null;
  const image = row?.coverImage || fallback?.image || null;
  if (!image) return null;
  const box = row.coverImage ? row.coverBox : fallback?.box || null;
  return { thumbnailUrl: r2.publicUrl(image.thumbnailKey) || `${base}/${image.id}/thumbnail`, box, width: image.width, height: image.height };
}

/**
 * The people of the scope asked for, ranked and numbered, out of the two lists the database
 * answers with.
 *
 * **The number follows the photographs.** Person 1 is whoever is in the most of them, Person 2 the
 * next, and so on down, so the first faces a client meets are the ones their gallery is actually
 * about. It used to be the order the worker happened to find them in, which put a guest who walked
 * past one frame first and the bride eleventh.
 *
 * Two people in as many photographs are settled by which was found first, so the order is decided
 * rather than left to chance, and it does not shuffle between two reads of the same gallery.
 *
 * The number is a **label**, never an identity: it is the person's rank in the scope being looked
 * at, so the same face is Person 1 in the shoot they dominate and Person 6 in another. Everything
 * that means a particular person - the filter, the picker, the rail - carries `id`, which is the
 * cluster's own and never changes. Somebody with no photograph in scope is left out rather than
 * offered as a circle that filters to nothing, and the ranks close up around them.
 *
 * A count is of *photographs*, not of faces: `image_selection_face_mapping` holds one row per
 * person per photo (`@@unique([personId, imageId])`), so a frame this person appears in twice is
 * counted once by the grouped count that feeds this.
 *
 * Pure over its arguments, so the ranking and the skipping can be checked without a database.
 */
function peopleIndex(personIds = [], counts = []) {
  const photoCounts = new Map(counts.map((row) => [row.personId, row._count?._all || 0]));
  return personIds
    .map((row, found) => ({ id: row.id, photoCount: photoCounts.get(row.id) || 0, found }))
    .filter((person) => person.photoCount > 0)
    .sort((left, right) => right.photoCount - left.photoCount || left.found - right.found)
    .map(({ id, photoCount }, rank) => ({ id, label: `Person ${rank + 1}`, photoCount }));
}

/**
 * The people whose name the client typed. Phase 1 gives nobody a name, so the only thing there is
 * to match is the number the gallery shows them under.
 *
 * A number is matched from its start - "40" is Person 40 and Person 400, not Person 140 - because
 * somebody typing a number is typing the one they are looking for, and a plain "contains" buried
 * it under every number that happens to hold those digits. "Person" and the space before the
 * number are optional, so both "405" and "Person 405" find the same one. Anything that is not a
 * number falls back to matching the label as written, and an empty search is everybody.
 *
 * Matched here rather than in SQL because the number is the person's place in the project's list,
 * which the database does not store.
 */
function searchPeople(people = [], search = "") {
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) return people;
  const typed = needle.replace(/^person/, "").trim();
  // Word Chunk Search for a name: every word typed, any order.
  if (!/^\d+$/.test(typed)) return people.filter((person) => matchesWordChunks(person.label, needle));
  return people.filter((person) => String(person.label.match(/\d+/)?.[0] || "").startsWith(typed));
}

/** The page's people with their circles, in the order the numbering put them. */
function withCovers(people = [], rows = [], base) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return people.map((person) => ({ ...person, cover: coverOf(byId.get(person.id), base) }));
}

/**
 * A gallery from before the filter existed, or one whose photos were never handed over, is queued
 * the first time a client looks at it: one count, and only when something is unscanned does the
 * queueing run - in the background, never awaited by the request, and never twice at once for the
 * same project. Idempotent underneath (one job per photo), so a client reloading changes nothing.
 * The click still runs no face recognition: the worker does that, and only once per photo.
 */
const queueing = new Set();
async function ensureQueued(projectId) {
  if (queueing.has(projectId)) return;
  const unscanned = await repository.countUnscanned(projectId);
  if (!unscanned) return;
  queueing.add(projectId);
  queueProject(projectId)
    .then((result) => { if (result.queued) console.log(`[image-selection faces] queued ${result.queued} photos of project ${projectId} for the People filter`); })
    .catch((error) => console.warn(`[image-selection faces] could not queue project ${projectId}: ${error.message}`))
    .finally(() => queueing.delete(projectId));
}

/**
 * The gallery's People tab and its picker: who was found, in the scope asked for - the whole
 * gallery, one folder (`folderId`), or one shoot's cards (`folderGroupId`).
 *
 * `search` and `page` are the picker's: a gallery with thousands of faces cannot hand them all to
 * a browser at once, so the rail asks for the first few and the picker asks for a page at a time.
 * Asked without a page the answer is the whole list, as it always was. `total` is how many there
 * are to be paged through after the search, which is what the picker counts its scrolling against.
 *
 * Empty whenever the filter is off or nothing has been found; `processing` says the worker still
 * has photos to look at, so an empty list can read as "still organising" rather than "nobody here".
 */
async function listPeople(projectId, { folderId, folderGroupId, search, page, pageSize, base }) {
  if (!config.enabled()) return { available: false, processing: false, people: [], total: 0, hasMore: false };
  ensureQueued(projectId).catch((error) => console.warn(`[image-selection faces] could not check project ${projectId}: ${error.message}`));
  const [personIds, counts, pending] = await Promise.all([
    repository.listPersonIds(projectId),
    repository.countPhotosByPerson(projectId, { folderId, folderGroupId }),
    repository.countPending(projectId),
  ]);
  const matched = searchPeople(peopleIndex(personIds, counts), search);
  // Only the page's faces are looked up, and the whole list when nobody asked for a page.
  const from = page ? (page - 1) * (pageSize || 40) : 0;
  const shown = page ? matched.slice(from, from + (pageSize || 40)) : matched;
  const rows = await repository.listPeopleDetails(projectId, shown.map((person) => person.id));
  return { available: true, processing: pending > 0, people: withCovers(shown, rows, base), total: matched.length, hasMore: from + shown.length < matched.length };
}

async function status(projectId) {
  if (!(await repository.findLiveProject(projectId))) throw httpError(404, "Image Selection project not found.");
  const summary = await repository.scanSummary(projectId);
  return { enabled: config.enabled(), engine: { ready: config.enabled() ? await engine.isReady() : false, reason: config.enabled() ? engine.unavailableReason() : "Face recognition is switched off (AI_FACE_ENGINE_ENABLED / IMAGE_SELECTION_FACE_RECOGNITION_ENABLED)." }, ...summary };
}

/**
 * Hands the worker every READY photo of the project it has not seen, or gave up on. This is how a
 * gallery that existed before the People filter gets its people, and how a failed photo is tried
 * again; photos uploaded from now on are queued as they become READY and need no asking.
 */
async function queueProject(projectId) {
  if (!config.enabled()) throw httpError(409, "Face recognition is switched off on this server (AI_FACE_ENGINE_ENABLED / IMAGE_SELECTION_FACE_RECOGNITION_ENABLED).");
  if (!(await repository.findLiveProject(projectId))) throw httpError(404, "Image Selection project not found.");
  let cursor; let queued = 0;
  for (;;) {
    const batch = await repository.listUnscannedImageIds(projectId, 500, cursor);
    if (!batch.length) break;
    for (const image of batch) { if (await hook.queueImage(image.id)) queued += 1; }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 500) break;
  }
  return { projectId, queued };
}

/**
 * The backstop under deferral (`hook.recordDeferred`): a photo the desktop said it would describe
 * and has not, after the grace, is handed to the worker as any upload is. Through `queueImage`,
 * whose job ids are the photo's, so a hand-off that lands in the meantime and a sweep that fires
 * twice each queue nothing new. `attempts: 0` is the filter - a photo the worker has tried is
 * already in its hands, or failed and the concern of `queueProject`. Nothing when the filter is off.
 * The arguments stand in for the database and the queue in tests.
 */
async function requeueStaleDeferred({ graceMs = DEFERRED_GRACE_MS, now = Date.now(), listStale = repository.listStaleDeferredScans, queueImage = hook.queueImage } = {}) {
  if (!config.enabled()) return 0;
  const olderThan = new Date(now - graceMs);
  let cursor; let queued = 0;
  for (;;) {
    const batch = await listStale(olderThan, 500, cursor);
    if (!batch.length) break;
    for (const scan of batch) { if (await queueImage(scan.imageId)) queued += 1; }
    cursor = batch[batch.length - 1].id;
    if (batch.length < 500) break;
  }
  return queued;
}

module.exports = { listPeople, peopleIndex, searchPeople, withCovers, coverOf, status, queueProject, requeueStaleDeferred, DEFERRED_GRACE_MS };
