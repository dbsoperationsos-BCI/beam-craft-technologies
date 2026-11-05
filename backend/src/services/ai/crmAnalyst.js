const provider = require("./provider");
const { buildCrmContext, renderCrmContext } = require("./crmContext");
const { askLine } = require("./language");
const { answerInLanguage } = require("./crmAssistant");

/**
 * Nebula looking at the CRM as a whole.
 *
 * The assistant in the lead popup knows one lead very well and knows nothing else exists. That is
 * right for "what should I say to Priya?" and useless for "how is the pipeline doing?", "who is
 * behind on follow-ups?", "is Callyzer actually bringing anything in?" - the questions about the
 * module rather than a row in it.
 *
 * What it is shown is a page of totals from `crmContext.js`, all of them counted in SQL before the
 * model saw them. It is never shown the leads themselves: thirty thousand rows would not fit, and a
 * question about the pipeline does not need anybody's phone number.
 */

const SYSTEM = [
  "You are Nebula, the AI assistant built into this CRM. You work for a wedding and event photography studio in India, and you have a senior sales manager's experience.",
  // English only, said next to where the studio is. Naming the state - Tamil Nadu - was enough for
  // the model to answer "I know Tamil and English" when asked what languages it spoke.
  "You read and write English only. You do not speak Tamil or any other language.",
  "If someone asks who you are, you are Nebula. Do not mention the model you run on.",
  "",
  "You are looking at the whole CRM module: every lead, their statuses, owners, sources, follow-ups",
  "and conversions, as a set of totals that have already been counted for you.",
  "",
  "How to use them.",
  "",
  "- The numbers you are given are correct. Quote them as they are. Never add, subtract, average or",
  "  recalculate anything - if a figure you want is not listed, say it is not available rather than",
  "  working it out.",
  "- Read what the numbers mean, which is the part that needs you. 'Follow-ups are 1000 days late'",
  "  is a fact; 'these were imported with old dates and are not real follow-ups' is an observation,",
  "  and the second is what the person asking actually needs.",
  "- If a section is missing from what you were given, that part of the CRM has nothing recorded.",
  "  Say so. Do not guess at it.",
  "",
  "Be specific and practical, the way a manager reviewing the board would be. Name the owner, the",
  "source or the status you are talking about. When something looks wrong, say what you would check",
  "first. When asked what to do, give a next step someone can actually take today.",
  "",
  "Two or three short paragraphs. Use a short list only when the answer really is a list.",
  "",
  /*
   * Worded carefully. An earlier version named the language the team writes in, and the model
   * started signing its answers with it, ending one reply with a bare line reading "Tamil".
   * Naming languages in the system
   * prompt is what put them in reach of the output; the instruction at the end of each turn is
   * enough on its own.
   */
  "Answer in English. Never name a language in your answer - no reply ends with the name of one.",
].join("\n");

// The same window as the lead assistant, and for the same reason.
const MAX_HISTORY = 8;

/** The prompt for one module-level turn. */
async function buildPrompt({ question, history = [], verticals = [], scope = null, reader = null }) {
  const context = await buildCrmContext({ verticals, scope, reader });
  const asked = String(question || "").trim();
  const priorTurns = (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY)
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${String(turn.content || "").trim()}`)
    .filter((line) => line.length > 12);


  return {
    context,
    prompt: [
      "Here is the current state of the CRM. Every figure has already been counted.",
      "",
      renderCrmContext(context),
      "",
      priorTurns.length ? `Conversation so far:\n${priorTurns.join("\n")}\n` : "",
      askLine(asked),
    ].filter(Boolean).join("\n"),
  };
}

/** One module-level answer, streamed as it is written. */
async function streamAboutCrm({ question, history = [], verticals = [], scope = null, reader = null } = {}, onToken) {
  const asked = String(question || "").trim();
  if (!asked) throw new Error("Ask a question first.");
  const { context, prompt } = await buildPrompt({ question: asked, history, verticals, scope, reader });
  // Cleaned exactly as the lead panel does.
  const { answer, corrected } = await answerInLanguage({ system: SYSTEM, prompt, question: asked }, onToken);
  return { answer, corrected, basedOn: summarise(context) };
}

/** The same answer, waited for. */
async function askAboutCrm({ question, history = [], verticals = [], scope = null, reader = null } = {}) {
  const asked = String(question || "").trim();
  if (!asked) throw new Error("Ask a question first.");
  const { context, prompt } = await buildPrompt({ question: asked, history, verticals, scope, reader });
  const { answer, corrected } = await answerInLanguage({ system: SYSTEM, prompt, question: asked });
  return { answer, corrected, basedOn: summarise(context) };
}

/** What the answer was based on, small enough to show under it. */
function summarise(context) {
  return {
    leads: context.leads.total,
    followUpsDue: context.followUps.total,
    conversions: context.conversions.projects,
    meetingsToday: context.schedule?.meetings ?? null,
    projectsToday: context.schedule?.projects ?? null,
    scopedTo: context.scopedTo,
  };
}

module.exports = { askAboutCrm, streamAboutCrm, buildPrompt, SYSTEM, MAX_HISTORY };
