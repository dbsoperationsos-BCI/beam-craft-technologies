/**
 * Scores one run's rows with a learned-ranker bundle: the global model's probability of Keep,
 * moved by the studio and photographer layers (shrunk toward global until their evidence earns
 * weight, and bounded), the burst ranker's order inside each duplicate or burst group, and then
 * today's own decision code - the mode's thresholds (the bundle's, refitted to its scale), the
 * duplicate and burst rules, and Target Count's coverage - so the learned path changes the
 * numbers, never the rules. Pure: no database, no clock.
 */
const { extractFeatures, groupContext, groupIdOf, FEATURE_NAMES } = require("./featureSet");
const { loadTreeModel } = require("./treeModel");

const logit = (p) => Math.log(Math.max(1e-6, Math.min(1 - 1e-6, p)) / (1 - Math.max(1e-6, Math.min(1 - 1e-6, p))));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Loads a bundle's models once: { global, burst } tree models. */
function prepareBundle(bundle) {
  if (!bundle?.global) throw new Error("The bundle has no global model.");
  if (JSON.stringify(bundle.featureNames || []) !== JSON.stringify(FEATURE_NAMES)) throw new Error("The bundle's feature names do not match this feature set.");
  return { ...bundle, globalModel: loadTreeModel(bundle.global), burstModel: bundle.burst ? loadTreeModel(bundle.burst) : null };
}

/**
 * One layer's offset (logit units) for a feature vector: shrinkage n / (n + k) times the layer's
 * bias plus its trait weights on the features it names.
 */
function layerOffset(layer, vector, shrinkK) {
  if (!layer || !layer.n) return 0;
  const shrink = layer.n / (layer.n + shrinkK);
  let z = layer.bias || 0;
  for (const [name, weight] of Object.entries(layer.traits || {})) {
    const index = FEATURE_NAMES.indexOf(name);
    const value = index >= 0 ? vector[index] : null;
    if (value !== null && value !== undefined) z += weight * value;
  }
  return shrink * z;
}

/**
 * Learned scores, group order and per-photo contributions for one run.
 * `photographerKey`: the run starter's pseudonym (null = global and studio only).
 * Returns { byId: Map(id -> { score, base, contributions, vector }), groupOrder: Map(groupId -> [ids best first]) }.
 */
function scoreRun(rows, prepared, { photographerKey = null } = {}) {
  const context = groupContext(rows);
  const personal = prepared.personalization || {};
  const shrinkK = personal.shrinkK ?? 50;
  const maxAdjust = personal.maxAdjust ?? 8;
  const photographer = photographerKey ? personal.photographers?.[photographerKey] : null;
  const byId = new Map();
  for (const row of rows) {
    const vector = extractFeatures(row, context);
    const p = prepared.globalModel.predict(vector);
    const base = 100 * p;
    const z = logit(p) + layerOffset(personal.studio, vector, shrinkK) + layerOffset(photographer, vector, shrinkK);
    const score = clamp(base + clamp(100 * sigmoid(z) - base, -maxAdjust, maxAdjust), 0, 100);
    byId.set(row.id, { score, base, vector });
  }
  const groupOrder = new Map();
  const members = new Map();
  for (const row of rows) {
    const id = groupIdOf(row);
    if (!id) continue;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(row);
  }
  for (const [id, list] of members) {
    const rank = prepared.burstModel
      ? (row) => prepared.burstModel.raw(byId.get(row.id).vector)
      : (row) => byId.get(row.id).score;
    groupOrder.set(id, [...list].sort((a, b) => rank(b) - rank(a) || String(a.id).localeCompare(String(b.id))).map((row) => row.id));
  }
  return { byId, groupOrder };
}

/**
 * Rows as the decision code should see them under the learned ranker: the learned score, the
 * group best and ranks from the learned order, and no Phase 8 nudge (the photographer layer
 * replaces it).
 */
function learnedRows(rows, { byId, groupOrder }) {
  return rows.map((row) => {
    const id = groupIdOf(row);
    const order = id ? groupOrder.get(id) : null;
    const position = order ? order.indexOf(row.id) + 1 : null;
    const next = { ...row, learnedScore: byId.get(row.id).score, preferenceAdjustment: undefined };
    if (order) {
      next.isGroupBest = position === 1;
      if (row.duplicateGroupId) next.duplicateRank = position;
      else next.burstRank = position;
    }
    return next;
  });
}

/**
 * Decisions under the learned ranker, through today's decision code. `mode`, `targetCount` and
 * `accidentalScenes` as the run has them. Returns { updates, counts, rows } - `rows` the learned
 * view, for writing group ranks.
 */
function decideRun(rows, prepared, { mode, targetCount = null, accidentalScenes, photographerKey = null } = {}) {
  const scored = scoreRun(rows, prepared, { photographerKey });
  const view = learnedRows(rows, scored);
  const thresholds = prepared.thresholds || null;
  const decided = mode === "TARGET_COUNT"
    ? require("../analysis/coverage").coverageSession(view.map((row) => ({ ...row, folderId: row.upload?.folderId ?? row.folderId ?? null, capturedAt: row.upload?.capturedAt ?? row.capturedAt ?? null })), targetCount, accidentalScenes ? { accidentalScenes } : {})
    : require("../analysis/scoring").scoreSession(view, mode, { thresholds });
  return { ...decided, rows: view, scored };
}

/** The top `limit` features pushing a photo's score up and down, by name, from its contributions. */
function explain(prepared, vector, limit = 3) {
  const { values } = prepared.globalModel.contributions(vector);
  const named = values.map((value, index) => ({ feature: FEATURE_NAMES[index], value })).filter((entry) => entry.value !== 0);
  return {
    for: named.filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value).slice(0, limit),
    against: named.filter((entry) => entry.value < 0).sort((a, b) => a.value - b.value).slice(0, limit),
  };
}

module.exports = { prepareBundle, scoreRun, learnedRows, decideRun, explain, layerOffset };
