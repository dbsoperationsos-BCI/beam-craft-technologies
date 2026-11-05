const provider = require("./provider");
const { validateCallAnalysis, CALL_ANALYSIS_SCHEMA } = require("./schemas");
const { buildLeadContext } = require("./leadContext");

/**
 * A written conversation, read the way a call is.
 *
 * The WhatsApp thread and the remarks on a lead carry as much as the calls do - often more, since
 * a price sent as a message is written down exactly. This reads them into the same shape the call
 * analyser produces, so the panel renders one kind of thing whatever it came from.
 */

const SYSTEM = [
  "You are reading a written conversation between a photography studio and a client - WhatsApp messages and the notes staff have added.",
  "",
  "Judge only from the messages. Do not infer a budget, date or requirement that was never written.",
  "Messages may be in Tamil, English, or a mix; answer in English.",
  "Return only the requested fields, with no explanation.",
].join("\n");

/** Summarise the written conversation on one lead. */
async function analyzeConversation(enquiryId) {
  const context = await buildLeadContext(enquiryId);
  const messages = context.whatsapp.map((message) => `${message.from}: ${message.text}`);
  const remarks = context.remarks.map((entry) => `note: ${entry.text}`);
  const body = [...remarks, ...messages].join("\n").trim();

  if (!body) {
    // Nothing written is not a failure and not an empty analysis - it is an answer in itself.
    return { empty: true, reason: "There are no messages or notes on this lead yet." };
  }

  const raw = await provider.completeJson({
    system: SYSTEM,
    schema: CALL_ANALYSIS_SCHEMA,
    prompt: `Client: ${context.lead.name || "unknown"}\n\nConversation:\n${body.slice(0, 12000)}`,
  });
  return { empty: false, ...validateCallAnalysis(raw) };
}

module.exports = { analyzeConversation, SYSTEM };
