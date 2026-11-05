const { REASON_CODES } = require("../constants");

/**
 * Who is in the frame, and how much each face asks of the photo - the subject stage's maths, pure
 * so every rule is pinned by tests against hand-built faces.
 *
 * Identity comes from the People filter's clusters (one row per person per photo, with the face's
 * box as fractions). How much a face matters is read from THIS photograph alone: how large it is
 * and how central (`presenceOf`). Nobody is weighed by a label given to them or by how often they
 * appear across the shoot - a guest's best portrait is judged exactly as the couple's is, and the
 * person in the most frames is not assumed to be the one who matters in every frame.
 *
 * The group-photo rule: eyes are weighted by prominence cubed, so a large, central face blinking
 * drags the frame and a tiny face at the edge blinking barely registers - the same spread (≈11×)
 * the stage used to keep between a main subject and a guest, now taken from the frame itself. A
 * face nobody is mapped to (a stranger, a face the People filter had not clustered yet) is judged
 * by its own box the same way. A blink is named (`IMPORTANT_SUBJECT_BLINK`) only for a prominent
 * face, so one small closed pair of eyes in a group never marks the photo; the weighted eye score
 * is what the ranking reads, one bounded term among the others.
 */
// Every person counts the same: the weight the most-photographed person used to get by default.
const SUBJECT_IMPORTANCE = 0.8;
// A face this prominent (size and centrality, 0-1) is the photo's clear subject: its blink is
// named and its presence is a key person's.
const PROMINENT_PRESENCE = 0.55;
const MATCH_IOU = 0.3;
// A face this wide (as a fraction of the frame) is "full size"; eye and attribute claims need the
// same confidence the face stage demands before they earn a badge.
const FULL_FACE_EDGE = 0.35;
const MIN_ATTRIBUTE_CONFIDENCE = 85;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Any provider's box as `{ x, y, w, h }` fractions: Rekognition's Left/Top/Width/Height, the People filter's own, or [x1, y1, x2, y2]. */
function normalizeBox(box) {
  if (!box) return null;
  if (Array.isArray(box)) return { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] };
  if (box.Left !== undefined) return { x: box.Left, y: box.Top, w: box.Width, h: box.Height };
  return { x: Number(box.x) || 0, y: Number(box.y) || 0, w: Number(box.w) || 0, h: Number(box.h) || 0 };
}

function boxIou(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** How much a face asks for the eye: its size (full at 35% of the frame) and how central it is. */
function presenceOf(box) {
  const size = clamp(Math.sqrt(Math.max(0, box.w * box.h)) / FULL_FACE_EDGE, 0.2, 1);
  const centreDistance = Math.hypot(box.x + box.w / 2 - 0.5, box.y + box.h / 2 - 0.5);
  const centrality = 1 - clamp(centreDistance / 0.7, 0, 1) * 0.5;
  return 0.6 * size + 0.4 * centrality;
}

/** An eye attribute as the face stage scores it: the claim's confidence when sure, neutral 50 otherwise. */
function eyesScoreOf(eyesOpen) {
  if (!eyesOpen || (eyesOpen.confidence ?? 0) < MIN_ATTRIBUTE_CONFIDENCE) return 50;
  return eyesOpen.value ? Math.round(eyesOpen.confidence) : Math.round(100 - eyesOpen.confidence);
}

/**
 * One photo's subject verdict. `mappings`: the People filter's rows for the photo; `faceDetails`:
 * the face stage's per-face list (box, eyesOpen or measured openness) or null when no provider
 * ran. Returns { peopleCount,
 * subjectPersonId, subjectScore, eyesOpenScore, reasonCodes } - eyesOpenScore null when there is
 * nothing to weigh, so the face stage's own number stands.
 */
function subjectSignals({ mappings = [], faceDetails = null }) {
  const people = (mappings || []).map((mapping) => ({ personId: mapping.personId, box: normalizeBox(mapping.box) })).filter((entry) => entry.box).map((entry) => ({ ...entry, presence: presenceOf(entry.box) }));
  if (!people.length) return { peopleCount: 0, subjectPersonId: null, subjectScore: null, eyesOpenScore: null, reasonCodes: [] };

  // The subject is the most prominent person in this frame.
  const contributions = people.map((person) => ({ ...person, contribution: SUBJECT_IMPORTANCE * person.presence }));
  contributions.sort((a, b) => b.contribution - a.contribution);
  const subject = contributions[0];
  const others = contributions.slice(1).reduce((sum, entry) => sum + entry.contribution, 0);
  const subjectScore = Math.round(100 * clamp(subject.contribution + 0.15 * others, 0, 1));
  const reasonCodes = [];
  if (subject.presence >= PROMINENT_PRESENCE) reasonCodes.push(REASON_CODES.KEY_PEOPLE_PRESENT);

  let eyesOpenScore = null;
  if (Array.isArray(faceDetails) && faceDetails.length) {
    let weighted = 0;
    let weights = 0;
    let prominentBlink = false;
    for (const face of faceDetails) {
      const box = normalizeBox(face.box);
      if (!box) continue;
      // Measured openness (the local engine's landmarks) or a provider's claim; a face with
      // neither (unreadable, turned away) says nothing about eyes and neither lifts nor drags.
      const measured = typeof face.openness === "number";
      if (!measured && !face.eyesOpen) continue;
      const match = people.reduce((best, person) => { const iou = boxIou(box, person.box); return iou >= MATCH_IOU && iou > (best?.iou || 0) ? { person, iou } : best; }, null);
      const presence = match ? match.person.presence : presenceOf(box);
      const score = measured ? face.openness : eyesScoreOf(face.eyesOpen);
      const weight = presence ** 3;
      weighted += weight * score;
      weights += weight;
      const blinked = measured ? face.openness < 25 : face.eyesOpen.value === false && (face.eyesOpen.confidence ?? 0) >= MIN_ATTRIBUTE_CONFIDENCE;
      if (blinked && presence >= PROMINENT_PRESENCE) prominentBlink = true;
    }
    if (weights > 0) eyesOpenScore = Math.round(weighted / weights);
    if (prominentBlink) reasonCodes.push(REASON_CODES.IMPORTANT_SUBJECT_BLINK);
  }

  return { peopleCount: people.length, subjectPersonId: subject.personId, subjectScore, eyesOpenScore, reasonCodes };
}

module.exports = { SUBJECT_IMPORTANCE, PROMINENT_PRESENCE, normalizeBox, boxIou, presenceOf, subjectSignals };
