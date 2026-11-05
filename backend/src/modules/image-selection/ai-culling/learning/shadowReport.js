/**
 * Shadow evaluation (phase 9): how a SHADOW model's hidden verdicts compare with what photographers
 * actually decided, on finalized runs, next to the model that really decided those runs.
 *
 * For each finalized run with shadow rows for the model: the shadow call, the real AI call (the
 * baseline) and the photographer's final decision per photo; the best frame each picked in every
 * group whose winner the photographer made clear (their best-of-group choice, or the one Keep).
 * Promotion past SHADOW needs the architecture's rules (PROMOTION below) and a named approver.
 */
// minRunsPerLocation: server-analyzed and desktop-analyzed runs are also judged apart once either
// has this many - one intelligence for both apps, so a model may not help one and hurt the other.
const PROMOTION = Object.freeze({ minRuns: 200, minPhotographers: 10, agreementGain: 0.02, burstTop1Gain: 0.03, minBurstGroups: 30, minRunsPerLocation: 30 });
const LOCATIONS = Object.freeze({ SERVER: "server", DESKTOP: "desktop" });
const CLASSES = ["KEEP", "MAYBE", "REJECT"];

function rates(pairs) {
  const n = pairs.length;
  const keeps = pairs.filter((pair) => pair.final === "KEEP");
  const rejects = pairs.filter((pair) => pair.final === "REJECT");
  return {
    n,
    agreement: n ? pairs.filter((pair) => pair.call === pair.final).length / n : null,
    falseRejectRate: keeps.length ? keeps.filter((pair) => pair.call === "REJECT").length / keeps.length : null,
    falseKeepRate: rejects.length ? rejects.filter((pair) => pair.call === "KEEP").length / rejects.length : null,
  };
}

/** 95% interval of the agreement gain, resampling whole runs (seeded, so a report is repeatable). */
function bootstrapGain(runs, draws = 1000, seed = 7) {
  if (runs.length < 2) return null;
  let state = seed;
  const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const gains = [];
  for (let draw = 0; draw < draws; draw += 1) {
    let shadow = 0; let baseline = 0; let n = 0;
    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[Math.floor(random() * runs.length)];
      shadow += run.shadowCorrect; baseline += run.baselineCorrect; n += run.n;
    }
    gains.push(n ? (shadow - baseline) / n : 0);
  }
  gains.sort((a, b) => a - b);
  return { low: gains[Math.floor(draws * 0.025)], high: gains[Math.floor(draws * 0.975)] };
}

/**
 * The report for one model. `client` is Prisma (or a fake with the same reads); `rules` the
 * promotion rules (PROMOTION).
 */
async function shadowReport(client, modelId, rules = PROMOTION) {
  const sessions = await client.imageSelectionCullingShadowResult.findMany({ where: { modelId, session: { status: "FINALIZED" } }, distinct: ["sessionId"], select: { sessionId: true } });
  const runs = [];
  const photographers = new Set();
  const shadowPairs = [];
  const baselinePairs = [];
  let burstGroups = 0; let shadowBest = 0; let baselineBest = 0;
  const byLocation = Object.fromEntries(Object.keys(LOCATIONS).map((location) => [location, { runs: 0, shadowPairs: [], baselinePairs: [] }]));
  for (const { sessionId } of sessions) {
    const session = await client.imageSelectionCullingSession.findUnique({ where: { id: sessionId }, select: { createdByUserId: true, mode: true, analysisSource: true } });
    const shadows = await client.imageSelectionCullingShadowResult.findMany({ where: { modelId, sessionId }, select: { resultId: true, decision: true, isGroupBest: true } });
    const results = await client.imageSelectionCullingResult.findMany({ where: { sessionId }, select: { id: true, aiDecision: true, effectiveDecision: true, duplicateGroupId: true, burstGroupId: true, isGroupBest: true } });
    const events = await client.imageSelectionCullingDecisionEvent.findMany({ where: { sessionId, kind: "GROUP_BEST" }, orderBy: { createdAt: "asc" }, select: { groupId: true, groupOrder: true } });
    const shadowOf = new Map(shadows.map((row) => [row.resultId, row]));
    if (session?.createdByUserId) photographers.add(session.createdByUserId);
    const where = byLocation[session?.analysisSource === "DESKTOP" ? "DESKTOP" : "SERVER"];
    let n = 0; let shadowCorrect = 0; let baselineCorrect = 0;
    for (const result of results) {
      const shadow = shadowOf.get(result.id);
      if (!shadow || !CLASSES.includes(result.effectiveDecision) || !result.aiDecision) continue;
      n += 1;
      shadowPairs.push({ call: shadow.decision, final: result.effectiveDecision });
      baselinePairs.push({ call: result.aiDecision, final: result.effectiveDecision });
      where.shadowPairs.push({ call: shadow.decision, final: result.effectiveDecision });
      where.baselinePairs.push({ call: result.aiDecision, final: result.effectiveDecision });
      if (shadow.decision === result.effectiveDecision) shadowCorrect += 1;
      if (result.aiDecision === result.effectiveDecision) baselineCorrect += 1;
    }
    if (n) { runs.push({ n, shadowCorrect, baselineCorrect }); where.runs += 1; }
    // Groups with a clear winner: the photographer's chosen best, else the one Keep.
    const firstOrder = new Map(); const chosen = new Map();
    for (const event of events) {
      if (!firstOrder.has(event.groupId) && Array.isArray(event.groupOrder?.before)) firstOrder.set(event.groupId, event.groupOrder.before[0]);
      if (Array.isArray(event.groupOrder?.after)) chosen.set(event.groupId, event.groupOrder.after[0]);
    }
    const members = new Map();
    for (const result of results) {
      const groupId = result.duplicateGroupId || result.burstGroupId;
      if (groupId) { if (!members.has(groupId)) members.set(groupId, []); members.get(groupId).push(result); }
    }
    for (const [groupId, list] of members) {
      const keeps = list.filter((result) => result.effectiveDecision === "KEEP");
      const winner = chosen.get(groupId) || (keeps.length === 1 ? keeps[0].id : null);
      if (!winner) continue;
      const shadowPick = list.find((result) => shadowOf.get(result.id)?.isGroupBest)?.id;
      const aiPick = firstOrder.get(groupId) || list.find((result) => result.isGroupBest)?.id;
      burstGroups += 1;
      if (shadowPick === winner) shadowBest += 1;
      if (aiPick === winner) baselineBest += 1;
    }
  }
  const shadow = rates(shadowPairs);
  const baseline = rates(baselinePairs);
  const burst = { groups: burstGroups, shadowTop1: burstGroups ? shadowBest / burstGroups : null, baselineTop1: burstGroups ? baselineBest / burstGroups : null };
  const gainCi = bootstrapGain(runs);
  const reasons = [];
  if (runs.length < rules.minRuns) reasons.push(`${runs.length} finalized shadow runs; ${rules.minRuns} needed`);
  if (photographers.size < rules.minPhotographers) reasons.push(`${photographers.size} photographers; ${rules.minPhotographers} needed`);
  const gain = shadow.agreement !== null && baseline.agreement !== null ? shadow.agreement - baseline.agreement : null;
  if (gain === null || gain < rules.agreementGain) reasons.push(`agreement gain ${gain === null ? "unknown" : gain.toFixed(3)} < ${rules.agreementGain}`);
  if (!gainCi || gainCi.low <= 0) reasons.push("agreement gain's 95% interval is not above 0");
  if (shadow.falseRejectRate !== null && baseline.falseRejectRate !== null && shadow.falseRejectRate > baseline.falseRejectRate) reasons.push(`false reject rate rose (${baseline.falseRejectRate.toFixed(3)} -> ${shadow.falseRejectRate.toFixed(3)})`);
  if (burst.groups >= rules.minBurstGroups && burst.shadowTop1 - burst.baselineTop1 < rules.burstTop1Gain) reasons.push(`burst top-1 gain ${(burst.shadowTop1 - burst.baselineTop1).toFixed(3)} < ${rules.burstTop1Gain}`);
  // Each environment on its own, once it has enough runs to say anything.
  const byInferenceLocation = {};
  for (const [location, word] of Object.entries(LOCATIONS)) {
    const part = byLocation[location];
    const here = { runs: part.runs, shadow: rates(part.shadowPairs), baseline: rates(part.baselinePairs) };
    byInferenceLocation[location] = here;
    if (part.runs < rules.minRunsPerLocation) continue;
    if (here.shadow.agreement < here.baseline.agreement) reasons.push(`${word}-analyzed runs: agreement fell (${here.baseline.agreement.toFixed(3)} -> ${here.shadow.agreement.toFixed(3)})`);
    if (here.shadow.falseRejectRate !== null && here.baseline.falseRejectRate !== null && here.shadow.falseRejectRate > here.baseline.falseRejectRate) reasons.push(`${word}-analyzed runs: false reject rate rose (${here.baseline.falseRejectRate.toFixed(3)} -> ${here.shadow.falseRejectRate.toFixed(3)})`);
  }
  return { runs: runs.length, photographers: photographers.size, shadow, baseline, gain, gainCi, burst, byInferenceLocation, promotable: reasons.length === 0, reasons };
}

module.exports = { shadowReport, PROMOTION, rates, bootstrapGain };
