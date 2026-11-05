const provider = require("./provider");
const { LEAD_ANALYSIS_SCHEMA, validateLeadAnalysis } = require("./schemas");
const { buildLeadContext, renderLeadContext } = require("./leadContext");

/**
 * What the CRM should notice about one lead.
 *
 * The model reads what is already recorded and says what a careful person would say after reading
 * it: where this is going, what has been missed, what to do next. It is a second pair of eyes, and
 * the panel presents it as one - nothing here writes to the lead.
 */

const SYSTEM = [
  "You are a sales assistant for a photography studio's CRM in India. You write in English only.",
  "You are given everything recorded about one lead: its fields, remarks, calls, transcripts and WhatsApp messages.",
  "",
  "Judge only from what you are given. If the record does not say something, it is not known - say so rather than filling the gap.",
  "Never invent a budget, a date or a requirement that is not in the record.",
  "Budget figures are already calculated and given to you; repeat them, never recompute them.",
  "",
  "Be concrete and short. 'Call back on Friday to confirm the December date' is useful; 'follow up with the client' is not.",
  "Write in plain English. Do not explain your reasoning; return only the requested fields.",
].join("\n");

/**
 * Analyse one lead.
 *
 * Throws on failure rather than returning an empty shape: the panel needs to say "the AI could not
 * analyse this" and offer a retry, which it cannot do if a failure looks like an analysis with
 * nothing in it.
 */
async function analyzeLead(enquiryId) {
  const context = await buildLeadContext(enquiryId);
  const rendered = renderLeadContext(context);

  const raw = await provider.completeJson({
    system: SYSTEM,
    schema: LEAD_ANALYSIS_SCHEMA,
    prompt: [
      "Analyse this lead and return the fields you were asked for.",
      "",
      rendered,
      "",
      // Said explicitly, because a thin record is the case where a small model invents most.
      context.counts.callLogs || context.counts.whatsapp || context.remarks.length
        ? ""
        : "There is very little recorded about this lead. Say so plainly rather than inferring.",
    ].filter(Boolean).join("\n"),
  });

  return {
    ...validateLeadAnalysis(raw),
    // Handed back so the panel can say what the reading was based on, and so a thin analysis is
    // visibly thin rather than looking authoritative.
    basedOn: context.counts,
    money: context.money.formatted,
  };
}

module.exports = { analyzeLead, SYSTEM };
