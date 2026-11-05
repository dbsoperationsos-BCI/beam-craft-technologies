const fs = require("node:fs");
const path = require("node:path");

/**
 * The scene profile the review speaks in: ids and the studio's words, in the profile's own order
 * (scene/profiles/<AI_SCENE_PROFILE>.json, default `event`) — the same file the engine's vectors
 * were built from, so a label is written once. Read once per process.
 */
let cached = null;
function sceneCatalogue() {
  if (cached) return cached;
  const id = String(process.env.AI_SCENE_PROFILE || "event").replace(/[^a-z0-9_-]/gi, "");
  try {
    const profile = JSON.parse(fs.readFileSync(path.join(__dirname, "profiles", `${id}.json`), "utf8"));
    cached = profile.scenes.map((scene) => ({ id: scene.id, label: scene.label, accidental: Boolean(scene.accidental), validated: scene.validated === true }));
  } catch {
    cached = [];
  }
  return cached;
}

/** `{ SCENE_ID: count }` → `[{ id, label, count }]` in profile order; unknown ids (an older profile) last, by id. */
function scenesOf(counts = {}) {
  const catalogue = sceneCatalogue();
  const known = catalogue.filter((scene) => counts[scene.id]).map(({ id, label }) => ({ id, label, count: counts[id] }));
  const unknown = Object.keys(counts).filter((id) => counts[id] && !catalogue.some((scene) => scene.id === id)).sort().map((id) => ({ id, label: id, count: counts[id] }));
  return [...known, ...unknown];
}

/** The profile's accidental-frame scenes: never guaranteed by story coverage, never a "moment". */
const accidentalSceneIds = () => sceneCatalogue().filter((scene) => scene.accidental).map((scene) => scene.id);
/**
 * The scenes the profile's calibration did not validate (see `calibration` in the profile): shown
 * as the AI's guess and filterable, never counted toward a decision - no Target Count guarantee,
 * no place in the coverage line, no learned taste. Their confidence is stored as measured.
 */
const unvalidatedSceneIds = () => sceneCatalogue().filter((scene) => !scene.accidental && !scene.validated).map((scene) => scene.id);
/** Everything the coverage line and the guarantees leave out: the accidental and the unvalidated scenes. */
const uncountedSceneIds = () => [...unvalidatedSceneIds(), ...accidentalSceneIds()];

/**
 * Story coverage of a settled run, from the effective decisions (so it follows the photographer's
 * overrides): how many of the run's moments — scenes the engine was sure of, never the accidental
 * one — have at least one Keep, which are missing, and how many key people appear in a Keep.
 * `counts` is the repository's { scenes: { ID: { total, kept } }, people: { total, kept } }.
 * Null when there is nothing to say (no scenes ran and no key people).
 */
function coverageOf(counts) {
  const scenes = Object.entries(counts?.scenes || {}).filter(([, value]) => value.total > 0);
  const people = counts?.people || { total: 0, kept: 0 };
  if (!scenes.length && !people.total) return null;
  const order = new Map(sceneCatalogue().map((scene, index) => [scene.id, index]));
  const labelOf = (id) => sceneCatalogue().find((scene) => scene.id === id)?.label || id;
  const missing = scenes.filter(([, value]) => !value.kept).sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999)).map(([id]) => ({ id, label: labelOf(id) }));
  return {
    moments: scenes.length ? { total: scenes.length, kept: scenes.length - missing.length, missing } : null,
    keyPeople: { total: people.total, kept: people.kept },
  };
}

module.exports = { sceneCatalogue, scenesOf, accidentalSceneIds, unvalidatedSceneIds, uncountedSceneIds, coverageOf };
