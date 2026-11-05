/**
 * The client gallery's Scene filter, as a Prisma `where` fragment on `ImageSelectionUpload`,
 * spread into the gallery's own listing beside its folder, selection and People conditions -
 * the same shape as `faces/filter.js`. Nothing is loaded and no copy is made: "Family in this
 * shoot" is the same photo query with one more condition.
 *
 * What it reads is the per-photo scene cache (`ImageSelectionUploadScene`, `upload.sceneCache`)
 * the culling run's scene stage leaves behind: one reading per photo, because a run prunes every
 * other engine version for the photos it reads. No engine runs on a request - a gallery whose
 * photos were never culled simply has no scenes to offer.
 */

// A scene is the AI's guess: below this confidence the review shows nothing rather than a likely
// wrong label, and the gallery follows the same line, so a photo is in a scene only where the
// review would say it is.
const SCENE_MIN_CONFIDENCE = 0.4;

// A profile id as the engine writes it - `FAMILY`, `GETTING_READY` - and nothing else, so a
// public query can only ever ask for a label shape the column can hold (VarChar(30)).
const SCENE_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

/** The condition for one scene, or nothing when no scene is asked for. */
function sceneWhere(sceneId) {
  const id = String(sceneId || "").trim();
  if (!id) return {};
  return { sceneCache: { some: { sceneLabel: id, sceneConfidence: { gte: SCENE_MIN_CONFIDENCE } } } };
}

/**
 * `{ SCENE_ID: photos }` from the readings of a scope - one row per (photo, label) as the
 * repository lists them. A photo counts once per scene it was read as, never twice in one scene,
 * so what each row of the dropdown says is exactly what choosing it lists.
 */
function sceneCounts(rows = []) {
  const seen = new Set();
  const counts = {};
  for (const row of rows) {
    if (!row?.uploadId || !row.sceneLabel) continue;
    const key = `${row.uploadId}\u0000${row.sceneLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[row.sceneLabel] = (counts[row.sceneLabel] || 0) + 1;
  }
  return counts;
}

module.exports = { sceneWhere, sceneCounts, SCENE_MIN_CONFIDENCE, SCENE_ID_PATTERN };
