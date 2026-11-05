/**
 * Who said which line.
 *
 * faster-whisper transcribes; it does not diarize. There is no voice-print here telling one person
 * from another, so these labels are inferred from two things the call does tell us: which way it
 * was placed, and where the pauses fall.
 *
 * The rules:
 *   - An outgoing call opens with the employee; an incoming one opens with the client.
 *   - A gap between segments longer than `TURN_GAP_MS` is a change of speaker. Continuous speech
 *     is one person still talking.
 *
 * That is right most of the time and wrong some of the time - two people talking over each other
 * defeats it entirely, and so does one person talking at length with pauses in it - which is why the
 * panel says the labels are inferred rather than presenting them as fact. Real diarization needs `pyannote.audio`, a HuggingFace token and its licence; when
 * that is added, this module is the only thing it has to replace.
 */

/*
 * How long a gap has to be before it counts as the other person starting.
 *
 * 350ms, and the number comes from measuring rather than from intuition. It used to be 1200ms,
 * which reads as a sensible "under a second is a breath" and was wrong by a factor of two: on a real
 * two-speaker recording the gaps between turns are 500-600ms, so nothing ever crossed the
 * threshold, nothing ever flipped, and every line of every transcript was attributed to the
 * employee. A two-person conversation presented as a monologue.
 *
 * Two measurements bracket the answer. The voice-activity filter that produces these segments only
 * splits on silence of 500ms or more, so a genuine turn change always shows as at least 500ms.
 * Whisper also splits mid-sentence for its own reasons, and those boundaries come back effectively
 * contiguous - under 200ms. 350ms sits between the two with room on either side.
 *
 * Raise it for a recording where one person talks at length with pauses in it, which is the case
 * this cannot get right: a long turn broken by a two-second thought becomes two speakers.
 */
const TURN_GAP_MS = Number(process.env.CALL_TRANSCRIPT_TURN_GAP_MS ?? 350);

const EMPLOYEE = "EMPLOYEE";
const CLIENT = "CLIENT";
const UNKNOWN = "UNKNOWN";

/**
 * Which side speaks first, from the direction of the call.
 *
 * A missed call has no conversation to attribute, and a direction Callyzer does not report leaves
 * this unknown rather than guessing - a wrong label reads as fact, an absent one does not.
 */
function opensWith(callType) {
  const type = String(callType || "").trim().toLowerCase();
  if (type === "outgoing") return EMPLOYEE;
  if (type === "incoming") return CLIENT;
  return UNKNOWN;
}

function other(speaker) {
  if (speaker === EMPLOYEE) return CLIENT;
  if (speaker === CLIENT) return EMPLOYEE;
  return UNKNOWN;
}

/**
 * Segments with a speaker against each.
 *
 * When the direction is unknown every segment stays UNKNOWN: alternating from an unknown start
 * would give half the lines the wrong name, which is worse than giving none of them a name.
 */
function assignSpeakers(segments = [], { callType } = {}) {
  const first = opensWith(callType);
  if (first === UNKNOWN) {
    return segments.map((segment, index) => ({ ...segment, sequence: index, speaker: UNKNOWN }));
  }

  let current = first;
  let previousEnd = null;
  return segments.map((segment, index) => {
    const start = Number(segment.startMs) || 0;
    // `previousEnd !== null` keeps the first segment with whoever opened the call; after that, a gap
    // of at least TURN_GAP_MS - zero by default, so any boundary - hands over to the other side.
    if (previousEnd !== null && start - previousEnd >= TURN_GAP_MS) current = other(current);
    previousEnd = Number(segment.endMs) || start;
    return { ...segment, sequence: index, speaker: current };
  });
}

module.exports = { assignSpeakers, opensWith, TURN_GAP_MS, EMPLOYEE, CLIENT, UNKNOWN };
