const repository = require("./repository");
const config = require("./config");
const engine = require("./engine");
const hook = require("./hook");
const r2 = require("../storage/r2");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/**
 * What the gallery's People row is drawn from. Pure over the rows it is given, so the numbering
 * and the cover fallback can be checked without a database.
 *
 * People are numbered in creation order across the whole project - "Person 3" is the same person
 * in every folder - and a person with no photo in the folder in view is left out rather than
 * offered as a circle that filters to nothing. The circle is cut from the cover photo's existing
 * thumbnail, so the response carries where in that frame the face is.
 */
function serializePeople(rows, base) {
  const people = [];
  rows.forEach((row, index) => {
    const photoCount = row._count?.mappings || 0;
    if (!photoCount) return;
    const fallback = row.mappings?.[0] || null;
    const image = row.coverImage || fallback?.image || null;
    const box = row.coverImage ? row.coverBox : fallback?.box || null;
    people.push({
      id: row.id,
      label: `Person ${index + 1}`,
      photoCount,
      cover: image ? { thumbnailUrl: r2.publicUrl(image.thumbnailKey) || `${base}/${image.id}/thumbnail`, box, width: image.width, height: image.height } : null,
    });
  });
  return people;
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

/** The People row for one gallery folder. Empty - and the row absent - whenever the filter is off or nothing has been found. */
async function listPeople(projectId, { folderId, base }) {
  if (!config.enabled()) return { available: false, people: [] };
  ensureQueued(projectId).catch((error) => console.warn(`[image-selection faces] could not check project ${projectId}: ${error.message}`));
  const rows = await repository.listPeople(projectId, { folderId });
  return { available: true, people: serializePeople(rows, base) };
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

module.exports = { listPeople, serializePeople, status, queueProject };
