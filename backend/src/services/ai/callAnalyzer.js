const provider = require("./provider");
const { CALL_ANALYSIS_SCHEMA, validateCallAnalysis } = require("./schemas");

/**
 * What one call was about.
 *
 * Replaces the Anthropic call that `call-transcripts/analyst.js` used to make itself, so there is
 * one AI path in the codebase rather than two. Whichever engine `AI_PROVIDER` names answers this.
 *
 * The transcript arrives in English however the call was held - faster-whisper translates - so the
 * model is told when it is reading a translation, because translated speech reads stiffly and that
 * is the translator's doing rather than the client's.
 */

const SYSTEM = [
  "You are reading a transcript of a phone call between a photography studio's sales team and a client.",
  "The transcript is machine-generated, and where the call was not in English it is machine-translated, so expect mis-heard words and stilted phrasing.",
  "",
  "Speaker labels are inferred from the call's direction, not measured - they may be swapped. Judge who is who from what is said.",
  "",
  "Record only what the call contains. If a budget, date or location was not discussed, use null.",
  "Never turn a vague phrase into a specific date, and never infer a figure that was not said.",
  "Set confidence to low when the transcript is short, garbled or mostly silence.",
  "Return only the requested fields, with no explanation.",
].join("\n");

async function analyzeCall({ fullText, callType, durationSeconds, clientName, language, translated } = {}) {
  const text = String(fullText || "").trim();
  if (!text) throw new Error("There is no transcript to analyse.");

  const raw = await provider.completeJson({
    system: SYSTEM,
    schema: CALL_ANALYSIS_SCHEMA,
    prompt: [
      `Call direction: ${callType || "unknown"}`,
      translated ? `Spoken language: ${language} (transcript machine-translated into English)` : null,
      `Duration: ${durationSeconds || 0} seconds`,
      clientName ? `Client name on the lead: ${clientName}` : null,
      "",
      "Transcript:",
      // A cap, because a long call on a small model is a prompt that silently loses its own tail.
      text.slice(0, Number(process.env.CALL_TRANSCRIPT_MAX_CHARS || 12000)),
    ].filter(Boolean).join("\n"),
  });

  return validateCallAnalysis(raw);
}

module.exports = { analyzeCall, SYSTEM };
