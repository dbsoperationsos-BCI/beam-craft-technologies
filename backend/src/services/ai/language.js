/**
 * Tidying up what the model actually produces.
 *
 * This file used to carry a whole language layer - detection, a second model, validation and a
 * retry - because Nebula answered in Tanglish when asked in Tanglish. That is gone: the studio works
 * in English, and carrying a 3.3GB second model for a language nobody asked it to use cost a model
 * reload on every alternating question (47 seconds to first token, measured) and a great deal of
 * code to keep correct.
 *
 * What is left is the part that was never about language at all: a small model produces artefacts -
 * it signs its answers, echoes the question back, and repeats itself when it runs out of things to
 * say - and these clean that up. Every one of them exists because of an answer somebody actually
 * saw.
 */

/*
 * The sign-offs a model adds after it has finished answering.
 *
 * It was told not to name the language it used and responded by writing "The language used is
 * English." thirty times. Instructions did not stop it; removing the text does.
 */
const TRAILING_META = [
  // "Language: English", "Language - Tanglish", on its own line at the end.
  /\n\s*language\s*[:\-]\s*(english|tanglish|tamil)\s*[.!]?\s*$/i,
  // The bare name, with nothing else on the line.
  /\n\s*(english|tanglish|tamil)\s*[.!]?\s*$/i,
  // Or trailing straight onto the last sentence.
  /\s*\b(tanglish|english|tamil)\b[\s.!]*$/i,
  // A "Language:" left with nothing after it, once the name on the next line has been taken.
  /\n\s*language\s*[:\-]\s*$/i,
];

/**
 * Removes a trailing label the model added to its own answer.
 *
 * Run repeatedly - a model that signs off once will sometimes sign off twice.
 */
function stripLanguageLabel(text) {
  let out = String(text || "");
  // Repeated: a model that signs off twice is not unusual.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = out;
    for (const pattern of TRAILING_META) out = out.replace(pattern, "");
    if (out === before) break;
  }
  return out.trim();
}

/**
 * Removes the question when the model has repeated it before answering.
 *
 * Only an exact echo, so an answer that merely opens with similar words is left alone.
 */
function stripEchoedQuestion(text, question) {
  const answer = String(text || "").trim();
  const asked = String(question || "").trim().replace(/[?.!]+$/, "").toLowerCase();
  if (!answer || asked.length < 8) return answer;

  const [first, ...rest] = answer.split("\n");
  const head = first.trim().replace(/[?.!]+$/, "").toLowerCase();
  if (head === asked && rest.length) return rest.join("\n").trim();

  /*
   * The same echo, run together with the answer on one line - "indha client ku enna message
   * anupalam? Priya, konjam..." - which the line test above cannot see. Only an exact prefix is
   * removed, so an answer that merely opens with similar words is left alone.
   */
  const lowered = answer.toLowerCase();
  if (lowered.startsWith(asked)) {
    /*
     * Whatever separator it chose.
     *
     * A fixed list of separators missed the one the model actually used: asked a question in Tamil
     * it replied "Enna panalam indha lead ku - I am Nebula...", separating with an en dash rather
     * than the hyphen the list knew about. Matching the separator by shape rather than by
     * enumeration means the next punctuation mark it picks is covered too.
     */
    const rest = answer.slice(asked.length);
    const trimmed = rest.replace(/^[\s?.!:;,\u2010-\u2015-]+/, "").trim();
    if (trimmed && trimmed.length < answer.length) return trimmed;
  }
  return answer;
}

/**
 * Cuts an answer at the point it starts repeating itself.
 *
 * A small model that has run out of things to say does not stop; it says the same sentence again.
 */
function trimRepetition(text) {
  const answer = String(text || "").trim();
  if (!answer) return answer;

  const pieces = answer.split(/(?<=[.!?])\s+/);
  const seen = new Set();
  const kept = [];
  for (const piece of pieces) {
    const key = piece.trim().toLowerCase().replace(/\s+/g, " ");
    // Short fragments repeat innocently - "Yes." or a name on its own line.
    if (key.length >= 12 && seen.has(key)) break;
    seen.add(key);
    kept.push(piece);
  }
  return kept.join(" ").trim();
}

/**
 * The question, as the last line of the prompt.
 *
 * Last on purpose: an instruction placed in the system prompt is competing with everything else in
 * it, and this model follows what it read most recently far more reliably.
 */
function askLine(question) {
  return `User (do not repeat the question): ${String(question || "").trim()}`;
}

/**
 * How long an answer may be.
 *
 * Told "two or three sentences" it produced 1,361 characters, because nothing stopped it - and
 * every character is time somebody spends watching a cursor.
 */
function maxTokens() {
  return Number(process.env.AI_MAX_ANSWER_TOKENS || 200);
}

module.exports = {
  askLine,
  maxTokens,
  trimRepetition,
  stripLanguageLabel,
  stripEchoedQuestion,
};
