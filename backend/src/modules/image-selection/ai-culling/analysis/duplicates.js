const { activeSimilarityProvider } = require("./similarity");
const { structureDistance } = require("./structure");
const { GROUP_TYPES } = require("../constants");

/**
 * Duplicate and burst grouping — the staged design that keeps 50,000 photos tractable. Never
 * all-pairs: photos are partitioned by folder, ordered by capture time (filename sequence when
 * EXIF gave no time), and candidates are chained neighbour-to-neighbour — a photo joins the
 * chain in front of it when the time gap is inside the window AND the perceptual hashes agree.
 * Each pass is O(N) with one hash comparison per neighbour, and only photos that were actually
 * shot together can ever meet.
 *
 * Two passes with different meanings:
 * - DUPLICATE: near-identical frames — seconds apart, hashes almost equal. The engine will
 *   recommend keeping the best; the others are the classic cull.
 * - BURST: a rapid sequence of one moment — sub-3-second gaps, hashes clearly related but
 *   allowed to vary (expressions change inside a burst). Best-of-burst gets a boost later;
 *   nothing is condemned just for being in a burst.
 *
 * A photo with no capture time can still form DUPLICATE chains through its filename sequence,
 * but at a tighter hash threshold (time cannot vouch for it, so the pixels must). Bursts
 * require real timestamps — a burst is a fact about time.
 *
 * Pure and side-effect free: takes plain rows, returns group plans. The pipeline writes them.
 */

const DUPLICATE_WINDOW_SECONDS = 10;
const DUPLICATE_MAX_DISTANCE = 6;
const DUPLICATE_MAX_DISTANCE_NO_TIME = 4;
const BURST_WINDOW_SECONDS = 3;
const BURST_MAX_DISTANCE = 18;
// The second signal (similarity v2). Structure distance is 0-100 (analysis/structure.js);
// unrelated real frames measure 17-28 on it, a small pan 2-16. So the layout only ever narrows or
// loosens the hash, never replaces it: a DUPLICATE needs the layout not to disagree (<= 12), and a
// BURST whose hash bits flipped past 18 is still accepted up to 26 bits when the layout is close
// (<= 12) and the known people overlap. People are the People filter's clusters per photo.
const DUPLICATE_MAX_STRUCTURE = 12;
const BURST_MAX_STRUCTURE = 12;
const BURST_LOOSE_DISTANCE = 26;

// Natural comparison so IMG_9 sorts before IMG_10 — filename sequence is the capture order
// every camera's counter provides when EXIF time is missing.
const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function sortedFolderPartitions(photos) {
  const folders = new Map();
  for (const photo of photos) {
    if (!photo.perceptualHash) continue; // unanalyzed or failed photos cannot be grouped
    const key = photo.folderId || "unfiled";
    if (!folders.has(key)) folders.set(key, []);
    folders.get(key).push(photo);
  }
  for (const list of folders.values()) {
    list.sort((a, b) => {
      if (a.capturedAt && b.capturedAt) return new Date(a.capturedAt) - new Date(b.capturedAt) || byName.compare(a.fileName || "", b.fileName || "");
      if (a.capturedAt) return -1;
      if (b.capturedAt) return 1;
      return byName.compare(a.fileName || "", b.fileName || "");
    });
  }
  return folders;
}

const gapSeconds = (a, b) => (a.capturedAt && b.capturedAt ? Math.abs(new Date(b.capturedAt) - new Date(a.capturedAt)) / 1000 : null);

const knownPeople = (photo) => (Array.isArray(photo.personIds) && photo.personIds.length ? new Set(photo.personIds) : null);
// "The same people" allows one side to have seen one face more: the scan missing a face in one
// frame of a pair must not make the pair strangers. Disjoint or partly different sets do.
const samePeople = (a, b) => { const left = knownPeople(a); const right = knownPeople(b); if (!left || !right) return true; const [small, large] = left.size <= right.size ? [left, right] : [right, left]; return [...small].every((id) => large.has(id)); };
const sharePeople = (a, b) => { const left = knownPeople(a); const right = knownPeople(b); if (!left || !right) return true; return [...left].some((id) => right.has(id)); };

/**
 * Whether two neighbours are one moment. The hash says "near-identical" (DUPLICATE) or "related"
 * (BURST); the structure signature and the people in the frame then confirm or veto:
 * - DUPLICATE: hash within range AND (no structure on either side OR structure within range) AND
 *   the same known people. Different people, or a different layout, is not the same frame twice.
 * - BURST: hash within range, OR a hash within the looser range with a close layout and somebody
 *   in common. People never veto a hash-confirmed burst: a guest walking into a sequence is still
 *   that sequence. A missing signature or unknown people never confirm anything by themselves.
 */
function linked(previous, photo, { type, maxDistance, similarity }) {
  const distance = similarity.distance(previous.perceptualHash, photo.perceptualHash);
  const structure = structureDistance(previous.structureSignature, photo.structureSignature);
  if (type === GROUP_TYPES.DUPLICATE) {
    return distance <= maxDistance && (structure === null || structure <= DUPLICATE_MAX_STRUCTURE) && samePeople(previous, photo);
  }
  if (distance <= maxDistance) return true;
  return distance <= BURST_LOOSE_DISTANCE && structure !== null && structure <= BURST_MAX_STRUCTURE && sharePeople(previous, photo);
}

/** Neighbour-chains inside one sorted folder; chains of 2+ become groups. */
function chainsOf(sorted, { type = GROUP_TYPES.DUPLICATE, windowSeconds, maxDistance, noTimeDistance = null, similarity = activeSimilarityProvider() }) {
  const chains = [];
  let current = [];
  for (const photo of sorted) {
    const previous = current[current.length - 1];
    if (!previous) { current = [photo]; continue; }
    const gap = gapSeconds(previous, photo);
    const joined = gap === null
      ? noTimeDistance !== null && linked(previous, photo, { type, maxDistance: noTimeDistance, similarity })
      : gap <= windowSeconds && linked(previous, photo, { type, maxDistance, similarity });
    if (joined) { current.push(photo); continue; }
    if (current.length > 1) chains.push(current);
    current = [photo];
  }
  if (current.length > 1) chains.push(current);
  return chains;
}

/**
 * How good a frame is AS THE KEEPER of near-identical frames - a balanced merit, not sharpness
 * first. Inside a burst the frames are almost equally sharp, and what tells the keeper apart is
 * the people: open eyes and a good expression decide between frames a point or two apart in
 * sharpness, while a clearly soft frame still loses to a crisp one. With faces: technical 35%,
 * eyes 30%, expression 20%, face quality 15%, plus who is in the frame (±5). Without faces (or
 * face signals): technical quality alone. Missing face signals count as neutral (50).
 * `weights` are the four shares (default MERIT_WEIGHTS); a photographer's learned burst-winner
 * taste may move each by at most 0.1 (preferences.learnGroupTaste), never the no-face case.
 */
const MERIT_WEIGHTS = Object.freeze({ technical: 0.35, eyes: 0.3, expression: 0.2, face: 0.15 });
function groupMeritOf(value, weights = MERIT_WEIGHTS) {
  const technical = value.technicalScore ?? 0;
  // Face signals present (a row read without its face count still counts by its face quality).
  const hasFaces = value.faceQualityScore !== null && value.faceQualityScore !== undefined && (value.faceCount === undefined || value.faceCount === null || value.faceCount > 0);
  if (!hasFaces) return technical;
  const share = weights || MERIT_WEIGHTS;
  let merit = technical * share.technical + (value.eyesOpenScore ?? 50) * share.eyes + (value.expressionScore ?? 50) * share.expression + value.faceQualityScore * share.face;
  if (typeof value.subjectScore === "number") merit += (value.subjectScore - 50) * 0.1;
  // Between near-identical frames, the one facing the camera (bounded, like the quality nudge).
  if (typeof value.headPoseScore === "number") merit += Math.max(-3, Math.min(2, (value.headPoseScore - 60) * 0.05));
  return merit;
}
/**
 * Visually similar frames: the same set-up or pose shot over a minute or two, read from the scene
 * engine's CLIP image embedding (unit, int8-quantized, stored per photo). Calibrated on the real
 * shoots in the test project: consecutive frames of one set-up measure 0.93-0.97 cosine, a change
 * of set-up 0.41-0.80. A frame joins its predecessor's series when it was taken at most
 * `windowSeconds` later in the same folder and its embedding is at least `minCosine` alike.
 * Photos with no capture time (uploaded before the browser sent it) have no window to read: two
 * untimed frames join only when adjacent in file order and at least `untimedMinCosine` alike -
 * stricter, as the untimed duplicate rule is, inside the measured same-set-up range (0.93-0.97)
 * and well above every change of set-up measured (at most 0.80). A timed and an untimed frame
 * never link.
 */
const SIMILAR_RULES = Object.freeze({ windowSeconds: 120, minCosine: 0.92, untimedMinCosine: 0.95 });

/** A stored embedding (base64 int8) as a unit Float32Array, or null. */
function decodeEmbedding(encoded) {
  if (typeof encoded !== "string" || !encoded) return null;
  let bytes;
  try { bytes = Buffer.from(encoded, "base64"); } catch { return null; }
  if (!bytes.length || bytes.length % 4 !== 0 || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
  const values = new Float32Array(bytes.length);
  let norm = 0;
  for (let index = 0; index < bytes.length; index += 1) { const value = (bytes[index] << 24) >> 24; values[index] = value; norm += value * value; }
  norm = Math.sqrt(norm);
  if (!norm) return null;
  for (let index = 0; index < values.length; index += 1) values[index] /= norm;
  return values;
}

function cosineOf(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function similarChainsOf(sorted) {
  const chains = [];
  let current = [];
  for (const photo of sorted) {
    if (!photo.embedding) { if (current.length > 1) chains.push(current); current = []; continue; }
    const previous = current[current.length - 1];
    let joins = false;
    if (previous && previous.capturedAt && photo.capturedAt) {
      const gap = gapSeconds(previous, photo);
      joins = gap !== null && gap <= SIMILAR_RULES.windowSeconds && cosineOf(previous.embedding, photo.embedding) >= SIMILAR_RULES.minCosine;
    } else if (previous && !previous.capturedAt && !photo.capturedAt) {
      joins = cosineOf(previous.embedding, photo.embedding) >= SIMILAR_RULES.untimedMinCosine;
    }
    if (joins) { current.push(photo); continue; }
    if (current.length > 1) chains.push(current);
    current = [photo];
  }
  if (current.length > 1) chains.push(current);
  return chains;
}

// Stable: equal merit keeps capture order, so rank 1 is `bestOf`.
function rankMembers(members, weights = MERIT_WEIGHTS) {
  return members
    .map((member, index) => ({ member, index, merit: groupMeritOf(member, weights) }))
    .sort((a, b) => (b.merit - a.merit) || (a.index - b.index))
    .map(({ member }) => member);
}
function bestOf(members) { return rankMembers(members)[0]; }

/**
 * Group plans for one session's photos. Each plan: { type, memberResultIds, bestResultId,
 * representativeUploadId, memberCount, groupScore }. A photo can sit in one DUPLICATE and one
 * BURST group at once — they answer different questions.
 */
function buildGroups(photos, similarity = activeSimilarityProvider(), { meritWeights = MERIT_WEIGHTS } = {}) {
  const plans = [];
  for (const sorted of sortedFolderPartitions(photos).values()) {
    const planOf = (type, chain) => {
      const ranked = rankMembers(chain, meritWeights);
      const best = ranked[0];
      return { type, memberResultIds: chain.map((photo) => photo.resultId), rankedResultIds: ranked.map((photo) => photo.resultId), bestResultId: best.resultId, representativeUploadId: best.uploadId, memberCount: chain.length, groupScore: best.technicalScore ?? null };
    };
    for (const chain of chainsOf(sorted, { type: GROUP_TYPES.DUPLICATE, windowSeconds: DUPLICATE_WINDOW_SECONDS, maxDistance: DUPLICATE_MAX_DISTANCE, noTimeDistance: DUPLICATE_MAX_DISTANCE_NO_TIME, similarity })) plans.push(planOf(GROUP_TYPES.DUPLICATE, chain));
    for (const chain of chainsOf(sorted, { type: GROUP_TYPES.BURST, windowSeconds: BURST_WINDOW_SECONDS, maxDistance: BURST_MAX_DISTANCE, similarity })) plans.push(planOf(GROUP_TYPES.BURST, chain));
    for (const chain of similarChainsOf(sorted)) plans.push(planOf(GROUP_TYPES.SIMILAR, chain));
  }
  return plans;
}

module.exports = {
  buildGroups,
  groupMeritOf,
  MERIT_WEIGHTS,
  rankMembers,
  decodeEmbedding,
  cosineOf,
  SIMILAR_RULES,
  chainsOf,
  bestOf,
  rankMembers,
  sortedFolderPartitions,
  DUPLICATE_MAX_STRUCTURE,
  BURST_MAX_STRUCTURE,
  BURST_LOOSE_DISTANCE,
  DUPLICATE_WINDOW_SECONDS,
  DUPLICATE_MAX_DISTANCE,
  DUPLICATE_MAX_DISTANCE_NO_TIME,
  BURST_WINDOW_SECONDS,
  BURST_MAX_DISTANCE,
};
