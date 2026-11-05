/**
 * What a question actually needs, decided before any of it is done.
 *
 * Nebula did the same work for every question: fetch the module summaries, embed the question, run
 * a retrieval - then answer. Measured, that is 885ms of tools and RAG spent on "give me ideas to
 * improve wedding photography sales", which needs neither. Worse than the time, the CRM summary
 * then sat in front of the model while it answered a question about brainstorming, which is why
 * general questions came back business-flavoured and slightly beside the point.
 *
 * Three kinds of question, three amounts of work:
 *
 *   DATA       "how many overdue leads" - needs a tool, and a figure without one is a guess
 *   KNOWLEDGE  "what is our leave policy" - needs the studio's own documents
 *   GENERAL    "how do I win back a client" - needs neither; the model already knows this
 *
 * Decided in code, in about a millisecond, for the same reason the language, the scope and the
 * verticals are: a small model is unreliable at deciding *about* a question, and asking it to
 * classify first would add a whole generation - roughly 800ms measured - to every request, which is
 * the opposite of the problem being solved.
 *
 * Deliberately biased toward doing less. A general question wrongly sent to a tool is slow and
 * off-target; a data question wrongly answered without one is caught by the rule that a figure must
 * come from a tool, so the model says it cannot see rather than inventing.
 */

/*
 * Live data: the studio's own records, as they are right now.
 *
 * Two halves, and both must be present. "How many" alone is a question about arithmetic; "leads"
 * alone is a question about the trade. Together they are a question about the database.
 */
const ASKS_QUANTITY = /\b(how many|how much|count|total|number of|list|show me|which|who is|who are|any\b)\b/i;
const NAMES_RECORDS = new RegExp([
  "leads?", "enquir", "pipeline", "follow.?ups?", "overdue", "converted", "conversions?",
  "employees?", "staff", "headcount", "attendance",
  "assets?", "inspections?",
  "cash", "entries", "payments?", "invoices?",
  "projects?", "selections?", "galler",
  "transcripts?", "call logs?", "remarks?", "meetings?",
].join("|"), "i");

/*
 * Anything that is plainly about the current state of things, whatever shape the sentence takes.
 *
 * "Anything overdue?" has no quantity word and is unmistakably a data question.
 */
const PLAINLY_DATA = /\b(overdue|due today|pending|outstanding|assigned to|unassigned|this month|today'?s|right now|currently)\b/i;

/*
 * A standing request for the current state, in the words people actually use for it.
 *
 * "What needs my attention today?" names no record and asks no quantity, and it is the single most
 * likely thing a Super Admin opens the assistant to ask. Routed as general it produced "attention to
 * equipment checks, client appointments, and workflow efficiency" - true of any studio on any day,
 * and worth nothing. It is a question about the business right now, so it needs the figures.
 */
const ASKS_FOR_STATE = new RegExp([
  "what needs (my |our )?attention",
  "what should i (look at|focus on|do)( today| first| next)?\\b",
  "\\b(business |overall |today'?s )?(status|summary|overview|briefing|update)\\b",
  "how (are|is) (we|things|business|it) (doing|going)",
  "where do (we|i) stand",
  "anything (i should know|urgent|important)",
].join("|"), "i");

/*
 * Company knowledge: how the studio does things, as written down.
 *
 * "Our" and "we" are the strongest signal there is - they distinguish "what is the policy" (which
 * policy? whose?) from "what is our policy", which is a question about a document that exists.
 */
const ASKS_KNOWLEDGE = new RegExp([
  "\\b(our|we|company|studio'?s|internal|dbs)\\b.{0,30}\\b(policy|policies|sop|process|procedure|rule|guideline|workflow|standard)",
  "\\b(policy|policies|sop|procedure|guideline|workflow)\\b.{0,30}\\b(for|on|about|regarding)",
  "\\bwhat (is|are) (our|the company|the studio)",
  "\\bhow do we\\b",
  "\\baccording to (our|the) (policy|sop|process)",
].join("|"), "i");

/*
 * Advice, reasoning, drafting - the things a language model is for.
 *
 * Listed so a question that mentions leads while plainly asking for ideas - "how do I get more
 * leads" - is not dragged into a database lookup it does not need.
 */
const ASKS_ADVICE = /\b(how (do|can|should) (i|we|you)|ideas?|suggest|suggestions?|recommend|advice|improve|better|best way|tips?|strategy|strategies|help me|draft|write|explain|why|compare|difference between|should i|worth it|opinion|brainstorm)\b/i;

const INTENT = { DATA: "DATA", KNOWLEDGE: "KNOWLEDGE", GENERAL: "GENERAL" };

/**
 * What this question needs, judged on its own words.
 *
 * `decided` says whether a rule actually matched or whether this is the fallthrough. That
 * distinction is what makes follow-up inheritance safe: only a question with no signal of its own
 * should borrow the previous turn's.
 */
function classifyAlone(asked) {
  // Knowledge first: "what is our refund policy" also matches the advice pattern on "what is".
  if (ASKS_KNOWLEDGE.test(asked)) {
    return { intent: INTENT.KNOWLEDGE, needsTools: false, needsKnowledge: true, decided: true, reason: "asks about a written process" };
  }

  /*
   * A request for the state of things needs the figures, whatever else it looks like.
   *
   * Checked before the advice rule: "what should I focus on today" matches both, and answering it
   * with generic advice instead of what is actually outstanding is the failure this exists to stop.
   */
  if (ASKS_FOR_STATE.test(asked)) {
    return { intent: INTENT.DATA, needsTools: true, needsKnowledge: false, decided: true, reason: "asks for the current state of the business" };
  }

  const wantsQuantity = ASKS_QUANTITY.test(asked) || PLAINLY_DATA.test(asked);
  const namesRecords = NAMES_RECORDS.test(asked);

  /*
   * Advice wins over a record word.
   *
   * "How can I reduce overdue leads?" names records and asks for quantity, and it is a request for
   * ideas. Answering it with a count is technically responsive and useless.
   */
  if (ASKS_ADVICE.test(asked) && !(wantsQuantity && namesRecords && !ASKS_ADVICE.test(asked.split(/[?.]/)[0] || ""))) {
    // Unless it is plainly a lookup dressed as a request - "show me the overdue leads".
    if (!(PLAINLY_DATA.test(asked) && /\b(show|list|give me the)\b/i.test(asked))) {
      return { intent: INTENT.GENERAL, needsTools: false, needsKnowledge: false, decided: true, reason: "asks for advice or reasoning" };
    }
  }

  if (wantsQuantity && namesRecords) {
    return { intent: INTENT.DATA, needsTools: true, needsKnowledge: false, decided: true, reason: "asks about records as they are now" };
  }
  if (PLAINLY_DATA.test(asked) && namesRecords) {
    return { intent: INTENT.DATA, needsTools: true, needsKnowledge: false, decided: true, reason: "asks about current state" };
  }

  // Nothing matched. Not an assertion that this is chit-chat - only that these rules saw no signal.
  return { intent: INTENT.GENERAL, needsTools: false, needsKnowledge: false, decided: false, reason: "neither records nor a written process" };
}

/*
 * How short a question has to be before it is treated as leaning on the one before it.
 *
 * "which one first?", "and the second?", "why?" - none of them carry a subject. Something longer
 * that still matched no rule is more likely to be a new topic than a continuation.
 */
const FOLLOW_UP_WORDS = 8;

/**
 * What this question needs.
 *
 * `history` matters for a bare follow-up: "which one should we do first?" carries no signal of its
 * own, and restarting from scratch on it is how an assistant loses the thread.
 *
 * The order here is the whole point, and it was wrong the first time. Inheritance used to be
 * checked *first*, for anything under seven words - so "how many leads are pending today", which is
 * exactly six words and could hardly be a clearer request for a figure, inherited GENERAL from a
 * preceding "Hello" and came back "I am unable to provide real-time data". A question that
 * classifies on its own must never be overridden by what came before it; only one that says nothing
 * on its own should borrow.
 */
function classify(question, history = []) {
  const asked = String(question || "").trim();
  if (!asked) return { intent: INTENT.GENERAL, needsTools: false, needsKnowledge: false, reason: "empty" };

  const own = classifyAlone(asked);
  if (own.decided) {
    const { decided, ...settled } = own;
    return settled;
  }

  const words = asked.split(/\s+/).filter(Boolean).length;
  if (words <= FOLLOW_UP_WORDS && history.length) {
    const previous = [...history].reverse().find((turn) => turn.role === "user");
    if (previous && String(previous.content || "").trim()) {
      const inherited = classifyAlone(String(previous.content));
      /*
       * Only a previous question that itself decided something is worth inheriting. Two vague turns
       * in a row should not compound into a confident answer about nothing.
       */
      if (inherited.decided) {
        const { decided, ...settled } = inherited;
        return { ...settled, reason: "follow-up, inherited from the previous question" };
      }
    }
  }

  const { decided, ...settled } = own;
  return settled;
}

module.exports = { classify, classifyAlone, INTENT, FOLLOW_UP_WORDS };
