/**
 * What a deliverable's No. of Count, Image Selection and Remarks answers mean, now that they are
 * typed words rather than a Yes/No pair.
 *
 * The rule, and the reasoning behind it, is written out once in
 * `backend/src/services/deliverableAnswers.js`. In short: an answer starting with "no" is No,
 * anything else typed is Yes, and blank is unanswered - which leaves every `Yes` and `No` written
 * before this reading exactly as it did.
 *
 * Here because the screens decide what to show before the server is asked: the Deliverables table
 * prints the words, and a project's deliverable line asks whether it may be given a photo count.
 * `deliverableAnswerNotOff` is the backend's alone - nothing on this side reads an answer whose
 * blank means yes, now that Remarks is a note rather than a switch.
 * Kept free of React so `node --test` can hold it.
 */

/** The answer as typed: the words, or the Yes/No a boolean used to mean, or "" for unanswered. */
export function deliverableAnswerText(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Whether anything was answered at all - blank is a real state, and it is not No. */
export function deliverableAnswered(value) {
  return deliverableAnswerText(value) !== "";
}

/** On, where blank counts as off - every `=== true` this used to be read with. */
export function deliverableAnswerOn(value) {
  const text = deliverableAnswerText(value).toLowerCase();
  return text !== "" && !text.startsWith("no");
}
