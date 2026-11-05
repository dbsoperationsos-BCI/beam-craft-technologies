/**
 * The records a question is about, found by looking them up rather than by guessing.
 *
 * "I need details about client shivani" used to come back with a list of wedding services. The
 * question named a real person in the CRM and the assistant answered from general experience,
 * because nothing had looked her up: deciding to search is the model's job, and this model does not
 * reliably decide to. The same weakness the standing summary exists to work around.
 *
 * So the search is taken away from the model, exactly as the summary was. Any word in the question
 * that could plausibly be a name is handed to the CRM's own search, and **the database decides**
 * whether it was one. That is the part worth keeping: there is no list of names here, no heuristic
 * about capitalisation, and nothing to maintain as clients come and go. A word either matches a lead
 * or it does not, and a word that matches a lead was a name.
 *
 * Two consequences follow from doing it that way. A misspelling that the CRM's own `contains` search
 * would still match is still found - the search is the studio's, so it behaves like the screens do.
 * And a question with no name in it costs one bounded query that returns nothing, which is cheaper
 * than a generation.
 */

/*
 * Words that are never a client's name.
 *
 * Ordinary English plus the vocabulary of this business. It does not have to be complete: a word
 * that slips through is one extra bounded search that returns nothing, which is a rounding error
 * next to a model generation. Being too aggressive here is the expensive mistake - it would drop a
 * real name and put the assistant back to answering from imagination.
 */
const NEVER_A_NAME = new Set([
  // Structure
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "for", "from", "with", "without", "about", "into", "onto", "over", "under", "between",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "have", "has", "had", "will", "would", "can", "could", "shall", "should", "may", "might", "must",
  "i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers", "they", "them", "their", "theirs", "it", "its",
  "who", "whom", "whose", "what", "which", "when", "where", "why", "how", "all", "any", "some",
  "no", "not", "yes", "please", "give", "get", "got", "need", "want", "tell", "show", "list",
  "up", "ups", "out", "off", "one", "two", "new", "old", "last", "next", "first", "still",
  "many", "much", "more", "most", "less", "least", "very", "just", "only", "also", "too",
  "now", "today", "yesterday", "tomorrow", "week", "month", "year", "day", "days", "time",
  // The business
  "lead", "leads", "client", "clients", "customer", "customers", "enquiry", "enquiries",
  "detail", "details", "record", "records", "info", "information", "status", "update",
  "follow", "followup", "followups", "pipeline", "remark", "remarks", "note", "notes",
  "call", "calls", "meeting", "meetings", "message", "messages", "whatsapp", "transcript",
  "project", "projects", "shoot", "shoots", "event", "events", "wedding", "engagement",
  "photo", "photos", "photography", "album", "albums", "package", "budget", "price", "quote",
  "branch", "vertical", "source", "owner", "assigned", "converted", "interested", "pending",
  "overdue", "employee", "employees", "staff", "asset", "assets", "cash", "payment",
  "dum", "qua", "corp", "crm", "nebula",
  // The fields of a record, which are asked about constantly and are never somebody's name.
  "city", "town", "location", "address", "phone", "number", "email", "budget", "name",
  "profile", "date", "dates", "type", "types", "stage", "reason", "value", "amount",
]);

/*
 * Bounded hard.
 *
 * A question is one sentence; if three words in it look like names, two of them are not, and
 * searching every token would turn a cheap lookup into a scan per word.
 */
const MAX_CANDIDATES = 3;

/** Words from a question that could be somebody's name. */
function candidateNames(question) {
  /*
   * `\p{M}` matters here and its absence was a real bug.
   *
   * Tamil vowel signs are combining marks, not letters, so stripping everything that was not a
   * letter turned "ஷிவானி" into "ஷ வ ன" - three single characters, each too short to be a
   * candidate, and the name vanished. In a studio in Tamil Nadu that is not an edge case.
   */
  const words = String(question || "")
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const word of words) {
    const clean = word.trim();
    const lower = clean.toLowerCase();
    // Two letters is an initial or a typo, not something worth a query.
    if (clean.length < 3) continue;
    if (NEVER_A_NAME.has(lower)) continue;
    // A pure number is an id, and ids are matched by the search anyway - but not as a name.
    if (/^\d+$/.test(clean)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(clean);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Whether a question is asking about a particular record rather than about totals.
 *
 * Deliberately loose. "Tell me about Shivani", "did she convert", "what did we quote her" - all of
 * them are about one person, and none of them contains a word that a counting-question detector
 * would notice.
 */
const ASKS_ABOUT_SOMEONE = new RegExp([
  "\\b(details?|detail|about|info|information|record|profile|status)\\b",
  "\\b(who is|who's|tell me|what about|how about|any update|anything on)\\b",
  // Third person, which is how a follow-up refers back to a person.
  "\\b(she|her|he|him|his|hers|they|them|their)\\b",
].join("|"), "i");

function looksLikeAboutSomeone(question) {
  return ASKS_ABOUT_SOMEONE.test(String(question || ""));
}

module.exports = { candidateNames, looksLikeAboutSomeone, NEVER_A_NAME, MAX_CANDIDATES };
