/**
 * The learned-ranker registry at run time. A model is a row in image_selection_culling_model plus
 * a bundle file under AI_CULLING_MODEL_DIR (stored relative, so no machine path is written down),
 * checked against its SHA-256 and its feature-set version before use. Anything wrong - a missing
 * file, a checksum mismatch, another feature-set version, a bundle that will not load - means no
 * model: the run uses the fixed formula and records nothing learned. Never a failed run.
 *
 * Switches (all off by default, read at call time):
 * - AI_CULLING_SHADOW_ENABLED=true   score runs with SHADOW models into the shadow table (hidden)
 * - AI_CULLING_LEARNED_RANKER=true   let a PRODUCTION model (or a CANARY one, for
 *                                     AI_CULLING_CANARY_PERCENT of runs) decide
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { FEATURE_SET_VERSION } = require("./featureSet");
const { prepareBundle } = require("./scorer");

const STATUSES = Object.freeze(["CANDIDATE", "SHADOW", "CANARY", "PRODUCTION", "RETIRED"]);
const CACHE_MS = 60000;

const modelDir = (env = process.env) => path.resolve(env.AI_CULLING_MODEL_DIR || path.join(os.homedir(), ".dbs-culling-models"));
const shadowEnabled = (env = process.env) => env.AI_CULLING_SHADOW_ENABLED === "true";
const learnedEnabled = (env = process.env) => env.AI_CULLING_LEARNED_RANKER === "true";
function canaryPercent(env = process.env) {
  const value = Number(env.AI_CULLING_CANARY_PERCENT ?? 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 10;
}
/** A run's stable 0-99 bucket, so a canary run is canary on every retry. */
const bucketOf = (sessionId) => parseInt(crypto.createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 8), 16) % 100;

/** `name@version` - how a run records the model that scored it. */
const labelOf = (model) => `${model.name}@${model.version}`;

function createRegistry({ client, env = process.env, readFile = (file) => fs.readFileSync(file), log = console } = {}) {
  const cache = new Map();
  let listCache = null;

  async function modelsWith(statuses) {
    if (!listCache || Date.now() - listCache.at > CACHE_MS) {
      const rows = await client.imageSelectionCullingModel.findMany({ where: { status: { in: ["SHADOW", "CANARY", "PRODUCTION"] } }, orderBy: { promotedAt: "desc" } });
      listCache = { at: Date.now(), rows };
    }
    return listCache.rows.filter((row) => statuses.includes(row.status));
  }

  /** The prepared bundle of a model row, or null (logged) when it cannot be trusted. */
  function load(model) {
    const key = `${model.id}:${new Date(model.updatedAt || 0).getTime()}`;
    if (cache.has(key)) return cache.get(key);
    let prepared = null;
    try {
      if (model.featureSetVersion !== FEATURE_SET_VERSION) throw new Error(`trained on ${model.featureSetVersion}, runs compute ${FEATURE_SET_VERSION}`);
      const file = path.resolve(modelDir(env), model.artifactPath);
      if (!file.startsWith(modelDir(env) + path.sep)) throw new Error("artifact path leaves the model directory");
      const bytes = readFile(file);
      const sha = crypto.createHash("sha256").update(bytes).digest("hex");
      if (sha !== model.artifactSha256) throw new Error("artifact checksum mismatch");
      const bundle = JSON.parse(bytes.toString("utf8"));
      if (bundle.featureSetVersion !== FEATURE_SET_VERSION) throw new Error("bundle feature-set version mismatch");
      prepared = { ...prepareBundle(bundle), model };
    } catch (error) {
      log.warn?.(`[culling-learning] ${labelOf(model)} not used: ${error.message}`);
      prepared = null;
    }
    cache.set(key, prepared);
    return prepared;
  }

  return {
    /** Shadow models to score a run with (none unless the shadow switch is on). */
    async shadowModels() {
      if (!shadowEnabled(env)) return [];
      return (await modelsWith(["SHADOW"])).map(load).filter(Boolean);
    },
    /** The model that decides this run, or null for the fixed formula. */
    async servingModel(sessionId) {
      if (!learnedEnabled(env)) return null;
      const [canary] = await modelsWith(["CANARY"]);
      if (canary && bucketOf(sessionId) < canaryPercent(env)) {
        const prepared = load(canary);
        if (prepared) return prepared;
      }
      const [production] = await modelsWith(["PRODUCTION"]);
      return production ? load(production) : null;
    },
    clear() { cache.clear(); listCache = null; },
  };
}

module.exports = { createRegistry, STATUSES, modelDir, shadowEnabled, learnedEnabled, canaryPercent, bucketOf, labelOf };
