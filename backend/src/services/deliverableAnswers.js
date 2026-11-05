/**
 * What a deliverable's No. of Count, Image Selection and Remarks answers mean, now that they are
 * typed words rather than a Yes/No pair.
 *
 * The three were booleans: a dropdown offering Yes and No, and for Image Selection a blank that
 * meant "not answered". A studio wanted to write what it actually does - "50 photos", "2 sets",
 * "only the album" - so the columns hold text and the dialog takes anything. They still decide
 * things, though: Image Selection is the one thing admitting a deliverable to that module, and the
 * other two decide whether a project's allocation stores a photo count and remarks at all. So the
 * words have to be read back into an answer, and the rule is the one the studio asked for:
 *
 *   an answer starting with "no" is No; anything else typed is Yes; blank is unanswered.
 *
 * Which keeps every row written before this exactly as it read - `Yes` is on, `No` is off, blank is
 * unanswered - and makes "N/A" or "50 photos" an answer of Yes with the words kept beside it.
 *
 * Booleans are still understood, so a caller that has not been converted, and the fakes in the test
 * suites, go on working: `true` reads as "Yes" and `false` as "No".
 *
 * The frontend holds the same rule in `frontend/src/lib/deliverableAnswers.mjs`, because the screens
 * decide what to show before the server is asked. The two must agree.
 */

/** The answer as typed: the words, or the Yes/No a boolean used to mean, or "" for unanswered. */
function deliverableAnswerText(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Whether anything was answered at all - blank is a real state, and it is not No. */
function deliverableAnswered(value) {
  return deliverableAnswerText(value) !== "";
}

/**
 * On, where blank counts as off. Replaces every `=== true` this used to be read with: a deliverable
 * nobody has answered for is not admitted to Image Selection and is not asked for a photo count.
 */
function deliverableAnswerOn(value) {
  const text = deliverableAnswerText(value).toLowerCase();
  return text !== "" && !text.startsWith("no");
}

/**
 * On, where blank counts as on. Replaces every `!== false` this used to be read with: an allocation
 * on a deliverable that was never asked about remarks still stores them, as it always did.
 */
function deliverableAnswerNotOff(value) {
  return !deliverableAnswerText(value).toLowerCase().startsWith("no");
}

module.exports = { deliverableAnswerText, deliverableAnswered, deliverableAnswerOn, deliverableAnswerNotOff };
