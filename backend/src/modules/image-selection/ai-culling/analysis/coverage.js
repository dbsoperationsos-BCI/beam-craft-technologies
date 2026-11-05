const { scorePhoto } = require("./scoring");
const { REASON_CODES, DECISIONS, CONFIDENCE_LINES } = require("../constants");

/**
 * Story coverage — the layer that makes TARGET_COUNT honest. The failure it exists to prevent:
 * portraits score high, so a global top-1200 keeps every portrait and drops the ceremony. The
 * answer is quotas, derived dynamically, never hardcoded:
 *
 * 1. Redundant duplicates are settled first (REJECT, exactly as every mode does) and never
 *    count toward anything — a burst of twelve is one moment, not twelve chances.
 * 2. The target is split across folders (the shoots: Bride Prep, Ceremony, Reception…) in
 *    proportion to how many distinct candidate photos each holds, by largest-remainder rounding
 *    so the quotas sum exactly to the target. Every folder with candidates is floored at one —
 *    a 40-photo Groom Prep cannot be starved to zero by a 2,700-photo Reception.
 * 3. Inside each folder, capture time is bucketed into hour segments and every non-empty
 *    segment is guaranteed its best frame first, while quota lasts — the story beats survive
 *    even when their photos score modestly. A frame kept by this guarantee rather than raw
 *    score is badged UNIQUE_FRAME so the photographer can see why it is there.
 * 3b. Story coverage v2 (Phase 7), ahead of the hours: every KEY person (a role or a frequent
 *    face, the subject stage's KEY_PEOPLE_PRESENT) keeps their best frame across the whole run,
 *    badged COVERS_PERSON; then every scene of the folder the engine is sure of (confidence
 *    >= 0.4, never the accidental scene, never an ACCIDENTAL_FRAME) keeps its best frame, badged
 *    COVERS_SCENE. When the quota is smaller than the guarantees, people come first, then scenes,
 *    then hours. Rows with no scene and no person behave exactly as before.
 * 4. What quota remains goes to the folder's best remaining scores. The next-best few land in
 *    MAYBE (the "one more pass" queue); the rest are REJECT, with confidence growing with the
 *    distance from the cut.
 *
 * Culling V2 (story coverage v3):
 *  - Moments replace clock hours: a moment is a run of a folder's photos with no capture gap
 *    longer than `momentGapSeconds`, so the guarantee follows how the event actually unfolded
 *    (the arrival, the stage, the portraits) rather than where the hour hand was. Each moment
 *    keeps its best frame unless an earlier guarantee already covers it; when the target is
 *    smaller than the moments, larger moments come first. Photos with no capture time are one
 *    moment. This is time structure, not invented event semantics.
 *  - Variety: the rest of the quota is filled best-first with a penalty of `similarPenalty`
 *    points for every frame already picked from the same visually similar series, so the
 *    selection spreads across poses and set-ups instead of spending itself on one.
 *  - The photographer's decisions stand: their Keeps take slots of the target first, and their
 *    Rejects are never picked.
 *
 * Pure over plain rows; the pipeline hands it the same rows ranking uses plus folder and
 * capture time, and gets back the same update shape every other mode produces.
 */

// The MAYBE band after the quota line: a slice of the target, small but never trivial.
const MAYBE_FRACTION = 0.1;
const MAYBE_MINIMUM = 3;
const STORY_RULES = Object.freeze({ momentGapSeconds: 180, similarPenalty: 6 });
const SCENE_SURE = 0.4;
const DEFAULT_ACCIDENTAL_SCENES = ["ACCIDENTAL"];
const hasCode = (row, code) => Array.isArray(row.reasonCodes) && row.reasonCodes.includes(code);

const byScoreDesc = (a, b) => b.finalScore - a.finalScore || (a.id < b.id ? -1 : 1);

/** Largest-remainder allocation of `target` across folders, floored at 1 per non-empty folder. */
function folderQuotas(candidateCountByFolder, target) {
  const folders = [...candidateCountByFolder.entries()].filter(([, count]) => count > 0);
  const total = folders.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return new Map();
  const quotas = new Map();
  const remainders = [];
  let allocated = 0;
  for (const [folder, count] of folders) {
    const exact = (target * count) / total;
    const base = Math.max(1, Math.floor(exact));
    const quota = Math.min(count, base);
    quotas.set(folder, quota);
    allocated += quota;
    remainders.push({ folder, remainder: exact - Math.floor(exact), count });
  }
  // Hand out what the floors left over, biggest remainder first; trim overshoot (the floor of 1
  // on many tiny folders) from the largest quotas, never below 1.
  remainders.sort((a, b) => b.remainder - a.remainder);
  let index = 0;
  while (allocated < target && remainders.length) {
    const entry = remainders[index % remainders.length];
    if (quotas.get(entry.folder) < entry.count) { quotas.set(entry.folder, quotas.get(entry.folder) + 1); allocated += 1; }
    index += 1;
    if (index > remainders.length * (target + 1)) break; // every folder saturated
  }
  const shrinkable = () => [...quotas.entries()].filter(([, quota]) => quota > 1).sort((a, b) => b[1] - a[1]);
  while (allocated > target) {
    const candidates = shrinkable();
    if (!candidates.length) break;
    quotas.set(candidates[0][0], candidates[0][1] - 1);
    allocated -= 1;
  }
  return quotas;
}

/** A folder's entries as moments: capture-time runs with no gap over `momentGapSeconds`; the untimed are one more. */
function momentsOf(entries) {
  const timed = entries.filter((entry) => entry.row.capturedAt).sort((a, b) => new Date(a.row.capturedAt) - new Date(b.row.capturedAt) || (a.row.id < b.row.id ? -1 : 1));
  const moments = [];
  let current = [];
  for (const entry of timed) {
    const previous = current[current.length - 1];
    if (previous && (new Date(entry.row.capturedAt) - new Date(previous.row.capturedAt)) / 1000 > STORY_RULES.momentGapSeconds) { moments.push(current); current = []; }
    current.push(entry);
  }
  if (current.length) moments.push(current);
  const untimed = entries.filter((entry) => !entry.row.capturedAt);
  if (untimed.length) moments.push(untimed);
  return moments;
}

/**
 * Best-first with a variety penalty: each pick from a similar series makes the series' next frame
 * worth `similarPenalty` less. Lazy re-evaluation over a max-heap - a penalty only ever grows, so
 * a popped entry whose value fell is pushed back with its new value.
 */
function pickWithVariety(candidates, count, picked) {
  const seriesCount = new Map();
  for (const entry of picked) if (entry.row.similarGroupId) seriesCount.set(entry.row.similarGroupId, (seriesCount.get(entry.row.similarGroupId) || 0) + 1);
  const valueOf = (entry) => entry.finalScore - STORY_RULES.similarPenalty * (entry.row.similarGroupId ? seriesCount.get(entry.row.similarGroupId) || 0 : 0);
  const heap = [];
  const better = (a, b) => a.value > b.value || (a.value === b.value && byScoreDesc(a.entry, b.entry) < 0);
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (!better(heap[i], heap[parent])) break; [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && better(heap[l], heap[m])) m = l; if (r < heap.length && better(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  for (const entry of candidates) push({ entry, value: valueOf(entry) });
  const chosen = [];
  while (chosen.length < count && heap.length) {
    const item = pop();
    const value = valueOf(item.entry);
    if (value < item.value) { push({ entry: item.entry, value }); continue; }
    chosen.push(item.entry);
    if (item.entry.row.similarGroupId) seriesCount.set(item.entry.row.similarGroupId, (seriesCount.get(item.entry.row.similarGroupId) || 0) + 1);
  }
  return chosen;
}

/**
 * The whole TARGET_COUNT verdict for one session. Same return shape as scoring's scoreSession:
 * { updates, counts }, counts following the EFFECTIVE decision.
 */
function coverageSession(rows, targetCount, { accidentalScenes = DEFAULT_ACCIDENTAL_SCENES, unvalidatedScenes = [] } = {}) {
  const scored = rows.map((row) => ({ row, ...scorePhoto(row, "BALANCED") }));
  const updates = new Map();
  const put = (entry, aiDecision, confidence, extraCodes = []) => {
    updates.set(entry.row.id, {
      id: entry.row.id,
      finalScore: entry.finalScore,
      qualityScore: entry.qualityScore,
      preferenceAdjustment: typeof entry.row.preferenceAdjustment === "number" ? entry.row.preferenceAdjustment : null,
      uniquenessScore: entry.uniquenessScore,
      aiDecision,
      confidence,
      rankingCodes: [...(confidence < CONFIDENCE_LINES.LOW ? [REASON_CODES.LOW_CONFIDENCE] : []), ...extraCodes],
    });
  };

  // 1. Redundant duplicates are out before quotas exist.
  const redundant = scored.filter((entry) => entry.row.duplicateGroupId && !entry.row.isGroupBest);
  for (const entry of redundant) put(entry, DECISIONS.REJECT, 0.9);
  const candidates = scored.filter((entry) => !updates.has(entry.row.id));

  // 2. Quotas per folder.
  const byFolder = new Map();
  for (const entry of candidates) {
    const key = entry.row.folderId || "unfiled";
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(entry);
  }
  const quotas = folderQuotas(new Map([...byFolder.entries()].map(([folder, list]) => [folder, list.length])), Math.max(1, targetCount));

  // 3b. Key people, across the whole run: each one's best usable frame.
  const usable = (entry) => !hasCode(entry.row, REASON_CODES.ACCIDENTAL_FRAME);
  const personBest = new Map();
  for (const entry of candidates) {
    const person = entry.row.subjectPersonId;
    if (!person || !hasCode(entry.row, REASON_CODES.KEY_PEOPLE_PRESENT) || !usable(entry)) continue;
    const current = personBest.get(person);
    if (!current || byScoreDesc(entry, current) < 0) personBest.set(person, entry);
  }
  const personGuarantees = new Set(personBest.values());

  for (const [folder, list] of byFolder.entries()) {
    const quota = quotas.get(folder) || 0;
    const picked = new Set();
    const why = new Map();
    // The photographer's own Keeps take their slots first; their Rejects are never picked.
    for (const entry of list) if (entry.row.userDecision === DECISIONS.KEEP) picked.add(entry);
    const pickable = list.filter((entry) => entry.row.userDecision !== DECISIONS.REJECT && entry.row.userDecision !== DECISIONS.KEEP);
    const guarantee = (entries, code) => { for (const entry of entries) { if (picked.size >= quota) break; if (picked.has(entry)) continue; picked.add(entry); why.set(entry, code); } };
    // 3b. People first, then the folder's scenes.
    guarantee(pickable.filter((entry) => personGuarantees.has(entry)).sort(byScoreDesc), REASON_CODES.COVERS_PERSON);
    const scenes = new Map();
    for (const entry of pickable) {
      const { sceneLabel, sceneConfidence } = entry.row;
      // An unvalidated scene (scene/profile.js) is a guess, not a moment the story must hold.
      if (!sceneLabel || accidentalScenes.includes(sceneLabel) || unvalidatedScenes.includes(sceneLabel) || !(sceneConfidence >= SCENE_SURE) || !usable(entry)) continue;
      if (!scenes.has(sceneLabel) || byScoreDesc(entry, scenes.get(sceneLabel)) < 0) scenes.set(sceneLabel, entry);
    }
    guarantee([...scenes.values()].sort(byScoreDesc), REASON_CODES.COVERS_SCENE);
    // 3. Moments: every run of the story keeps its best frame unless a pick already covers it;
    // larger moments first when the quota is tight, then in the order they happened.
    const pickableSet = new Set(pickable);
    const moments = momentsOf(list).map((moment, order) => ({ moment, order })).sort((a, b) => b.moment.length - a.moment.length || a.order - b.order);
    for (const { moment } of moments) {
      if (picked.size >= quota) break;
      if (moment.some((entry) => picked.has(entry))) continue;
      const best = moment.filter((entry) => pickableSet.has(entry)).sort(byScoreDesc)[0];
      if (best) { picked.add(best); why.set(best, REASON_CODES.UNIQUE_FRAME); }
    }
    // 4. The rest of the quota best-first, spread across similar series.
    for (const entry of pickWithVariety(pickable.filter((entry) => !picked.has(entry)), Math.max(0, quota - picked.size), picked)) picked.add(entry);
    // A guarantee that would NOT have made the folder's pure score cut is there for coverage.
    const pureCut = new Set([...list].sort(byScoreDesc).slice(0, quota));
    for (const entry of picked) put(entry, DECISIONS.KEEP, 0.8, pureCut.has(entry) || !why.has(entry) ? [] : [why.get(entry)]);

    const leftovers = list.filter((entry) => !picked.has(entry)).sort((a, b) => (a.row.userDecision === DECISIONS.REJECT) - (b.row.userDecision === DECISIONS.REJECT) || byScoreDesc(a, b));
    const maybeCount = Math.min(leftovers.length, Math.max(MAYBE_MINIMUM, Math.round(quota * MAYBE_FRACTION)));
    leftovers.slice(0, maybeCount).forEach((entry) => put(entry, DECISIONS.MAYBE, 0.5));
    leftovers.slice(maybeCount).forEach((entry, position) => put(entry, DECISIONS.REJECT, Math.min(0.9, 0.6 + (position / Math.max(1, leftovers.length)) * 0.3)));
  }

  const counts = { keep: 0, maybe: 0, reject: 0, pending: 0 };
  const finished = rows.map((row) => {
    const update = updates.get(row.id);
    const effectiveDecision = row.userDecision || update.aiDecision || DECISIONS.PENDING;
    if (effectiveDecision === DECISIONS.KEEP) counts.keep += 1;
    else if (effectiveDecision === DECISIONS.MAYBE) counts.maybe += 1;
    else if (effectiveDecision === DECISIONS.REJECT) counts.reject += 1;
    else counts.pending += 1;
    return { ...update, effectiveDecision };
  });
  return { updates: finished, counts };
}

module.exports = { coverageSession, folderQuotas, momentsOf, STORY_RULES, MAYBE_FRACTION, MAYBE_MINIMUM };
