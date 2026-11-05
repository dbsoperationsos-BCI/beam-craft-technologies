const { analyzeCall } = require("../../../services/ai/callAnalyzer");
const { isConfigured: providerConfigured, providerName } = require("../../../services/ai/provider");

/**
 * What the call was about, read by whichever engine `AI_PROVIDER` names.
 *
 * This used to call Anthropic itself. It now goes through `services/ai`, so there is one AI path
 * in the codebase and switching engines is an environment variable rather than an edit here.
 *
 * The important property is unchanged and worth restating: **transcription does not depend on the
 * AI**. A model that is down, slow or absent leaves a stored transcript with no summary, which the
 * panel shows plainly. Throwing here would fail the whole job and re-transcribe minutes of audio
 * to retry a paragraph.
 */

/**
 * Claude's or Ollama's reading of one transcript, or null.
 *
 * Null rather than an exception on every failure: the transcript is the valuable part and it is
 * already saved. The caller treats null as "no summary yet", not as a lost call.
 */
async function analyseTranscript({ fullText, callType, durationSeconds, clientName, language, translated }) {
  const text = String(fullText || "").trim();
  if (!text) return null;

  try {
    const analysis = await analyzeCall({ fullText: text, callType, durationSeconds, clientName, language, translated });
    /*
     * Mapped back to the names the transcript table and the panel already use. The shared analyser
     * speaks the CRM's newer vocabulary - requirements, actionItems - and those ride along in the
     * suggestions JSON rather than needing columns of their own.
     */
    return {
      summary: analysis.summary,
      sentiment: analysis.sentiment ? analysis.sentiment.toUpperCase() : null,
      callOutcome: analysis.callOutcome,
      nextAction: analysis.nextAction,
      intent: analysis.leadIntent,
      budget: analysis.budget,
      eventType: analysis.eventType,
      eventDate: analysis.eventDate,
      location: analysis.location,
      followUpDate: analysis.followUpDate,
      suggestedStatus: analysis.suggestedStatus,
      requirements: analysis.requirements,
      actionItems: analysis.actionItems,
      confidence: analysis.confidence ? analysis.confidence.toUpperCase() : "LOW",
    };
  } catch (error) {
    // Named, so a run of these in the log points at the model rather than at the transcript.
    console.warn(`[call-transcript] ${providerName()} analysis failed:`, error?.code || "", error?.message || error);
    return null;
  }
}

/** Whether an engine is configured at all - Ollama needs no key, so this is nearly always true. */
function isConfigured() {
  return providerConfigured ? providerConfigured() : true;
}

module.exports = { analyseTranscript, isConfigured };
