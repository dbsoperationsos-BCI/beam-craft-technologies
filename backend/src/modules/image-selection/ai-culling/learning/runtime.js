/**
 * Where the learning layer meets a culling run (phases 9 and 10), called from the ranking stage.
 *
 * - servingFor(session): the learned model that decides this run, or null for today's formula.
 *   Null unless AI_CULLING_LEARNED_RANKER=true and a PRODUCTION (or, for a share of runs, a
 *   CANARY) model loads cleanly. With null, the run is exactly what it was.
 * - decide(rows, prepared, session): the learned decisions through today's decision code, plus
 *   the group order the burst ranker chose, as writes for the ranking stage.
 * - shadow(session, rows, repo): every SHADOW model's verdict on every photo, into the shadow
 *   table only. Never shown, counted or used; any failure is logged and swallowed, so a shadow
 *   model can never fail or slow a run beyond its own scoring.
 */
const { REASON_CODES } = require("../constants");
const { groupIdOf } = require("./featureSet");
const { decideRun } = require("./scorer");
const { pseudonym, trainingKey } = require("./pseudonym");
const { createRegistry, labelOf } = require("./registry");

/** The run starter's pseudonym (personalization is keyed by it), or null when no key is configured. */
// Without the training key a learned run still decides, on the global model alone; said once.
let warnedNoKey = false;
function photographerKeyOf(session, env = process.env) {
  if (!session?.createdByUserId) return null;
  try { return pseudonym("photographer", session.createdByUserId, trainingKey(env)); } catch (error) {
    if (!warnedNoKey) { warnedNoKey = true; console.warn(`[culling-learning] photographer personalization off: ${error.message}`); }
    return null;
  }
}

/**
 * The group writes a learned order implies: each moved member's best flag, rank and group codes
 * (DUPLICATE on a non-best duplicate, BEST_IN_BURST on a burst's best - the grouping stage's own
 * rule), and each group's new representative. `rows` as stored, `view` as the learned ranker
 * sees them (scorer.learnedRows).
 */
function groupChanges(rows, view) {
  const before = new Map(rows.map((row) => [row.id, row]));
  const results = new Map();
  const representatives = new Map();
  for (const row of view) {
    const groupId = groupIdOf(row);
    if (!groupId) continue;
    const old = before.get(row.id);
    if (row.isGroupBest) representatives.set(groupId, row.upload?.id || row.uploadId);
    const rankKey = row.duplicateGroupId ? "duplicateRank" : "burstRank";
    if (old.isGroupBest === row.isGroupBest && old[rankKey] === row[rankKey]) continue;
    const codes = (Array.isArray(old.reasonCodes) ? old.reasonCodes : []).filter((code) => code !== REASON_CODES.DUPLICATE && code !== REASON_CODES.BEST_IN_BURST);
    if (row.duplicateGroupId && !row.isGroupBest) codes.push(REASON_CODES.DUPLICATE);
    if (!row.duplicateGroupId && row.burstGroupId && row.isGroupBest) codes.push(REASON_CODES.BEST_IN_BURST);
    results.set(row.id, { isGroupBest: row.isGroupBest, [rankKey]: row[rankKey], reasonCodes: codes });
  }
  return { results, representatives };
}

function createLearningRuntime({ registry, env = process.env, log = console } = {}) {
  return {
    async servingFor(session) {
      try { return await registry.servingModel(session.id); } catch (error) { log.warn?.(`[culling-learning] serving lookup failed: ${error.message}`); return null; }
    },
    // `personalize: false` - the starter switched learned preferences off ("Use it in my runs"):
    // the global model decides alone, without their photographer layer, as the panel promises.
    decide(rows, prepared, session, { accidentalScenes, personalize = true } = {}) {
      const decided = decideRun(rows, prepared, { mode: session.mode, targetCount: session.targetCount, accidentalScenes, photographerKey: personalize ? photographerKeyOf(session, env) : null });
      return { ...decided, groups: groupChanges(rows, decided.rows), label: labelOf(prepared.model) };
    },
    async shadow(session, rows, repo, { accidentalScenes } = {}) {
      let models = [];
      try { models = await registry.shadowModels(); } catch (error) { log.warn?.(`[culling-learning] shadow lookup failed: ${error.message}`); return 0; }
      let written = 0;
      for (const prepared of models) {
        try {
          const decided = decideRun(rows, prepared, { mode: session.mode, targetCount: session.targetCount, accidentalScenes, photographerKey: photographerKeyOf(session, env) });
          const decisionOf = new Map(decided.updates.map((update) => [update.id, update.aiDecision]));
          const records = decided.rows.map((row) => ({
            resultId: row.id,
            score: decided.scored.byId.get(row.id).score,
            decision: decisionOf.get(row.id) ?? null,
            groupRank: (row.duplicateGroupId ? row.duplicateRank : row.burstRank) ?? null,
            isGroupBest: Boolean(groupIdOf(row) && row.isGroupBest),
          }));
          await repo.replaceShadowResults(session.id, prepared.model.id, records);
          written += records.length;
        } catch (error) {
          log.warn?.(`[culling-learning] shadow ${labelOf(prepared.model)} skipped for run ${session.id}: ${error.message}`);
        }
      }
      return written;
    },
  };
}

let defaultRuntime = null;
/** The process-wide runtime over the real registry (lazy, so tests never touch Prisma). */
function learningRuntime() {
  if (!defaultRuntime) defaultRuntime = createLearningRuntime({ registry: createRegistry({ client: require("../../../../config/db") }) });
  return defaultRuntime;
}

module.exports = { createLearningRuntime, learningRuntime, groupChanges, photographerKeyOf };
