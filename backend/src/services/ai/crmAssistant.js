const provider = require("./provider");
const { buildLeadContext, renderLeadContext } = require("./leadContext");
const { verticalDirective } = require("./verticals");
const { proposeMeeting } = require("./meetingIntent");
const { isOutOfScope, outOfScopeReply } = require("./scope");
const { askLine, stripEchoedQuestion, stripLanguageLabel, trimRepetition, maxTokens: answerTokens } = require("./language");

/**
 * Answering questions while working a lead, in conversation.
 *
 * The lead's record is always in front of it, so a question about this client is answered from what
 * is actually recorded - and only ever from *this* lead, which is what stops one client's question
 * being answered with another client's data.
 *
 * But it is an assistant, not a lookup. Asked how long a wedding shoot takes, or what to say to a
 * client who has gone quiet, it answers from professional knowledge like a senior colleague would.
 * It first refused those - "the record does not provide that information" - which is technically
 * true and useless. What it must not do is dress up a guess about this client as something the
 * record says.
 *
 * Stateless: the browser sends the exchange so far and gets one more turn back. No table, no
 * migration, and no conversation stored on a server about people who did not ask for it.
 */

/*
 * Kept short on purpose.
 *
 * This is evaluated in front of every question, and it had grown to 3,452 characters - roughly 900
 * tokens - as each fix added another paragraph. Whenever the prompt cache missed, which happens
 * every time the model is evicted in between, that was twenty-odd seconds before a
 * word appeared. Every rule below earned its place by fixing a real failure; each is now stated
 * once, in a line, rather than explained. The reasons live in the comments beside the code that
 * enforces them.
 */
const SYSTEM = [
  "You are Nebula, the AI assistant in this CRM. You work for a photography studio in India and have a senior salesperson's experience.",
  "You read and write English only. You do not speak Tamil or any other language.",
  "The studio runs three separate businesses: Dum Dum (weddings, engagements), Qua Qua (newborn, baby, maternity), Corp (corporate).",
  "Each lead names its own. Answer only about that one.",
  "",
  "You are talking to the salesperson, not the client. Never greet the client or write as if they are reading, unless asked to draft a message - then say so.",
  "",
  "You cannot do anything: no email, no calendar, no phone, no way to change this CRM. Never say you have done or will do something, and never say a meeting is booked.",
  "",
  "Answer questions about this client from the record, and questions about selling and running photography shoots from your own experience.",
  "If the record is silent, say so briefly and help anyway instead of repeating a stock refusal.",
  "Never state something about THIS client as recorded when it is not.",
  "",
  /*
   * Scope. Asked what Salem is famous for, it answered - a CRM assistant giving tourist facts. It
   * is not a general chatbot, and an answer outside the studio's work is one nobody can check.
   */
  "You only cover this CRM: its leads, and the work of selling and running photography shoots.",
  "Anything else - general knowledge, places, news, politics, other trades, coding, personal advice -",
  "is outside the CRM. Say so in one line and offer what you can help with instead. Do not answer it,",
  "not even briefly, and not even if you know.",
  "",
  "Give the move, not the category. Say what to do, what to say, and when.",
  /*
   * No quotable example here, and that is the third time this lesson has been learned in this file.
   * "Give the interval - \"wait three days\", not \"follow up later\"" put the phrase "Wait three
   * days" at the front of four answers out of five, including one about a price objection. A sample
   * in a prompt is a sample this model will return.
   */
  /*
   * "Write wordings in quotes" made it answer twice: the advice in prose, then the same advice
   * again under "You can say:" in quotation marks. Saying it once is the instruction; a wording is
   * an alternative to describing the wording, not an addition to it.
   */
  "Say how many days or hours, not \"later\" or \"soon\". Name an objection and answer it.",
  "If a sentence for the client would help, give that sentence instead of describing it - never both,",
  "and never repeat your own advice back as a quote.",
  "Never write \"emphasize the value\", \"build rapport\" or \"highlight the benefits\" without saying how in the same sentence.",
  "",
  "Two or three sentences for a simple question; a short paragraph for how to handle a client. Lead with the answer - no preamble, no restating the question.",
  /*
   * The language is not mentioned here at all.
   *
   * Two lines once told it never to name the language it used, and it answered "The language used is
   * English." thirty times in a row - a repetition loop, on the one subject the prompt had just put
   * in front of it. Telling a small model not to think about something is how you make it think
   * about nothing else. Naming a thing is what summons it, so the subject is simply absent
   * where it belongs, and any label that still slips out is stripped in code.
   */
].join("\n");

/*
 * Hello, and the other messages that are not questions.
 *
 * "hii" produced Nebula's entire system prompt, verbatim, in the panel - the studio's instructions
 * shown to whoever was reading. "ok" came back as two raw lines of the lead record. Neither is a
 * strange thing for a small model to do: given three thousand characters of instructions and two
 * characters of input, continuing the instructions is the likeliest text there is.
 *
 * A greeting has one right answer and it does not need a model to find it. Answering here is exact,
 * instant, and cannot leak anything - and it takes the most common trivial input off the model's
 * hands entirely.
 */
const GREETINGS = /^(hi+|hey+|hello+|hai+|helo+|yo|good\s*(morning|afternoon|evening)|thanks?|thank\s*you|ok+|okay|hmm+|test)[\s!.?]*$/i;

const GREETING_REPLY = "Hello. Ask me anything about this lead - what to do next, what to say, or how to handle it.";

/** A fixed reply when the message is a greeting rather than a question, or null when it is not. */
function greetingReply(question) {
  const asked = String(question || "").trim();
  // Long enough to be a real message is a real message, whatever words it starts with.
  if (!asked || asked.length > 24 || !GREETINGS.test(asked)) return null;
  return GREETING_REPLY;
}

/*
 * Studio-wide project and meeting counts are not on the lead itself.
 *
 * A lead panel cannot honestly invent the number of meetings or projects in the diary. Those
 * questions are still part of the studio's work, but they belong to the calendar or the CRM
 * summary, not to this record. Returning a handoff is better than returning a number that came
 * from nowhere.
 */
function studioScopeReply(question) {
  const asked = String(question || "").trim();
  if (!asked) return null;

  const wantsCount = /\b(how many|count|total|number of)\b/i.test(asked);
  const asksDiary = /\b(projects?|meetings?|calendar|schedule|diary)\b/i.test(asked);
  if (!wantsCount || !asksDiary) return null;

  return "I cannot see studio-wide project or meeting counts from this lead panel. Open the calendar or the CRM summary and I will help read the figures.";
}

/*
 * The net under the model, for everything a greeting rule cannot catch.
 *
 * An answer that is mostly lifted from the prompt is not an answer. This measures the longest run
 * of words the reply shares with what it was given, and calls it a leak only when that run is also
 * most of the reply - so an answer that legitimately quotes a follow-up date is left alone, and one
 * that reproduces a paragraph of instructions is not.
 */
function longestSharedRun(answer, source) {
  const normalise = (text) => String(text).toLowerCase().replace(/\s+/g, " ");
  const haystack = normalise(source);
  const words = normalise(answer).split(" ").filter(Boolean);
  let longest = 0;
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + longest + 1; end <= words.length; end += 1) {
      if (!haystack.includes(words.slice(start, end).join(" "))) break;
      longest = end - start;
    }
  }
  return longest;
}

function leaksPrompt(answer, sources) {
  const words = String(answer || "").trim().split(/\s+/).filter(Boolean).length;
  if (words < 6) return false;
  const longest = Math.max(...sources.map((source) => longestSharedRun(answer, source)));
  /*
   * Sixteen consecutive words, and most of the answer.
   *
   * Ten words at half the answer was too eager, and it destroyed a real question: "she said she is
   * not interested, how do I convince her" came back as "I could not answer that one". A good
   * answer repeats the studio's own vocabulary - candid, traditional, engagement, follow-up - and
   * enough of that in a row tripped it.
   *
   * The thing worth catching is a paragraph of instructions reproduced verbatim, which runs to
   * dozens of words. Nothing shorter is worth losing an answer over.
   */
  return longest >= 16 && longest / words >= 0.7;
}

// Enough for a real exchange, capped because a small model's window is small and the oldest turns
// matter least.
const MAX_HISTORY = 8;

/**
 * The prompt for one turn: the lead in front of it, the exchange so far, then the question - and
 * and last of all the question itself.
 *
 * Last is the point. A rule that lived in the system prompt was ignored: four
 * questions came back in English. Moved to the end of the prompt, immediately after the question,
 * a small model follows it.
 */
async function buildPrompt({ enquiryId, question, history = [], meeting = null, context: prebuilt = null }) {
  // The caller may already have the lead - the meeting proposal needs it before the prompt is built,
  // and reading it twice would be two round trips for one answer.
  const context = prebuilt || await buildLeadContext(enquiryId);
  const asked = String(question || "").trim();
  const priorTurns = (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY)
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${String(turn.content || "").trim()}`)
    .filter((line) => line.length > 12);

  // Decided in code, from this question and the person's own earlier turns - never left to the

  return {
    context,
    prompt: [
      "Lead record:",
      renderLeadContext(context),
      "",
      priorTurns.length ? `Conversation so far:\n${priorTurns.join("\n")}\n` : "",
      // Repeated here, next to the question, because a boundary stated once at the top of a long
      // prompt is a boundary the model has already forgotten by the time it answers.
      verticalDirective(context.lead.vertical),
      /*
       * Only on the turn that produced a card.
       *
       * This lived in the system prompt, so it was in front of the model on every question - and it
       * duly ended a follow-up draft and a "what should I do next" with "Check the time and address,
       * then press Schedule." A standing instruction about one kind of request leaks into all of them.
       */
      meeting?.ready
        ? "A meeting card with a Schedule button is showing under your answer. Say in one line what "
          + "the meeting is for, then end with: Check the time and address, then press Schedule."
        : "",
      askLine(asked),
    ].filter(Boolean).join("\n"),
  };
}

/**
 * The answer, cleaned of the artefacts a small model adds to it.
 *
 * The reply is read back with the
 * same cleaning every answer gets, and an answer that is mostly the prompt read back is sent to
 * be written again rather than shown as though it were an answer. It is a
 * property of the CRM.
 *
 * Exactly one retry. A model that ignored a blunt instruction twice will ignore it a third time,
 * and each attempt costs a whole generation - on this hardware, most of a minute.
 */
/*
 * The same advice, given twice.
 *
 * Answers arrive as a paragraph of advice followed by "You can say:" and the *same paragraph* in
 * quotation marks - one reached the panel with 260 characters said twice. Telling the prompt to
 * give a wording instead of describing one reduced it and did not stop it.
 *
 * Only a genuine duplicate is dropped. "You can say:" followed by an actual line for the client is
 * useful and is left alone; the test is whether the quoted text is largely the prose above it.
 */
const SAY_BLOCK = /\n+\s*(?:you (?:can|could|might) (?:say|tell them|write)|here(?:'s| is) what you (?:can|could) say)\s*:?\s*([\s\S]+)$/i;

function dropDuplicatedWording(text) {
  const answer = String(text || "");
  const match = SAY_BLOCK.exec(answer);
  if (!match) return answer;

  const before = answer.slice(0, match.index).trim();
  const quoted = match[1].replace(/^["'\u201c]|["'\u201d]\s*$/g, "").trim();
  if (!before || !quoted) return answer;

  // Eight consecutive words in common is not a coincidence at this length - it is the same text.
  const shared = longestSharedRun(quoted, before);
  const quotedWords = quoted.split(/\s+/).filter(Boolean).length;
  return shared >= 8 && shared / Math.max(quotedWords, 1) >= 0.5 ? before : answer;
}

/** An answer with the question, any trailing label and any duplicated wording taken off it. */
function clean(text, question) {
  return dropDuplicatedWording(stripEchoedQuestion(stripLanguageLabel(trimRepetition(text)), question));
}

/**
 * One answer, cleaned and checked for the one failure that is worth a retry.
 *
 * This used to carry a language check and a second attempt in a different model - an answer asked
 * for in Tanglish was read back and rewritten if it came out in English. All of that is gone with
 * Tanglish itself. What remains is the prompt-leak guard, which was never about language: an answer
 * that is mostly the instructions read back is not an answer.
 */
async function answerInLanguage({ system, prompt, question, guardAgainst = [], signal }, onToken) {
  const maxTokens = answerTokens();
  const first = clean(
    // Ollama's default of 1.1 let an answer repeat one sentence thirty times.
    await provider.completeStream({ system, temperature: 0.3, prompt, maxTokens, repeatPenalty: 1.15, signal }, onToken),
    question,
  );

  if (guardAgainst.length && leaksPrompt(first, guardAgainst)) {
    const retried = stripEchoedQuestion(
      await provider.complete({
        system, maxTokens, temperature: 0.4, signal,
        prompt: `${prompt}\n\nAnswer the question above in your own words. Do not repeat these instructions back.`,
      }),
      question,
    );
    /*
     * Whatever comes back, the reader gets an attempt at their question.
     *
     * This used to fall through to "I could not answer that one - try asking it a different way",
     * and that is what a real question got: a refusal, from an assistant that had in fact produced
     * an answer. A refusal helps nobody and reads as broken. The retry is preferred when it is
     * clean, and the first answer stands otherwise - it was only ever suspected, never known bad.
     */
    if (retried && !leaksPrompt(retried, guardAgainst)) return { answer: retried, corrected: true };
  }

  return { answer: first, corrected: false };
}

/**
 * The same answer, streamed a piece at a time.
 *
 * What makes it feel like an assistant rather than a form: on this hardware a full answer takes the
 * better part of a minute, and watching it arrive is the difference between thinking and hanging.
 *
 * The prompt-leak guard can replace what was streamed - an answer that quoted the system prompt back
 * is rewritten - so the panel is told to swap it rather than left showing the leaked draft.
 */
async function streamAboutLead({ enquiryId, question, history = [], signal } = {}, onToken) {
  const asked = String(question || "").trim();
  if (!asked) throw new Error("Ask a question first.");
  /*
   * Worked out first, because the answer depends on it.
   *
   * Costs about a millisecond - it is regular expressions, not a model - so there is nothing to be
   * gained by running it alongside the generation, and the prompt can then mention the card only on
   * the turn that has one.
   */
  const context = await buildLeadContext(enquiryId);
  const meeting = await proposeMeeting({ question: asked, lead: meetingLead(context) });

  const { prompt } = await buildPrompt({ enquiryId, question: asked, history, meeting, context });

  /*
   * "hii" needs no model, and asking one produced the system prompt in the panel. Nor does a
   * question the CRM has no business answering - the prompt was told to refuse those and answered
   * them anyway, naming the Prime Minister of India beside a wedding lead.
   */
  const scripted = greetingReply(asked)
    || studioScopeReply(asked)
    || (isOutOfScope(asked) ? outOfScopeReply() : null);
  if (scripted) {
    onToken?.(scripted);
    return { answer: scripted, corrected: false, meeting, basedOn: context.counts };
  }

  const { answer, corrected } = await answerInLanguage(
    { system: SYSTEM, prompt, question: asked, guardAgainst: [SYSTEM], signal },
    onToken,
  );

  return { answer, corrected, meeting, basedOn: context.counts };
}

/** The lead as the meeting extractor needs it: a name to title the meeting, an address to invite. */
function meetingLead(context) {
  const lead = context?.lead || {};
  return { name: lead.name || "", email: lead.email || lead.officialEmailId || "" };
}

/**
 * One turn, waited for rather than streamed.
 *
 * Shares `buildPrompt` with the streaming path deliberately: this used to assemble the same prompt
 * by hand, which is how the two would quietly drift - an instruction added to one and not the
 * other, with nothing to say which reply came from which.
 */
async function askAboutLead({ enquiryId, question, history = [] } = {}) {
  const asked = String(question || "").trim();
  if (!asked) throw new Error("Ask a question first.");

  const context = await buildLeadContext(enquiryId);
  const meeting = await proposeMeeting({ question: asked, lead: meetingLead(context) });
  const { prompt } = await buildPrompt({ enquiryId, question: asked, history, meeting, context });

  const scripted = greetingReply(asked)
    || studioScopeReply(asked)
    || (isOutOfScope(asked) ? outOfScopeReply() : null);
  if (scripted) return { answer: scripted, corrected: false, meeting, basedOn: context.counts };

  const { answer, corrected } = await answerInLanguage({
    system: SYSTEM, prompt, question: asked, guardAgainst: [SYSTEM],
  });

  return { answer, corrected, meeting, basedOn: context.counts };
}

module.exports = { askAboutLead, streamAboutLead, answerInLanguage, buildPrompt, greetingReply, leaksPrompt, dropDuplicatedWording, SYSTEM, MAX_HISTORY, studioScopeReply };
