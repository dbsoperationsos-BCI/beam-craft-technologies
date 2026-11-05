const provider = require("../../../services/ai/provider");
const dataScope = require("../../../services/dataScope.service");

/**
 * Whose leads the assistant may count: the same grant, on the same columns, as the CRM board -
 * so Nebula and the screen answer about the same rows for the same person.
 */
const leadScope = (req) => dataScope.resolve({
  userId: Number(req.user?.id),
  module: "SALES",
  feature: "CRM Leads",
  columns: { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" },
});
const { analyzeLead } = require("../../../services/ai/leadAnalyzer");
const { analyzeConversation } = require("../../../services/ai/conversationAnalyzer");
const { askAboutLead, streamAboutLead } = require("../../../services/ai/crmAssistant");
const { askAboutCrm, streamAboutCrm } = require("../../../services/ai/crmAnalyst");
const { analyzeCall } = require("../../../services/ai/callAnalyzer");
const transcripts = require("../call-transcripts/repository");

/**
 * The CRM's AI endpoints.
 *
 * The browser never reaches Ollama: it is bound to loopback on the server and has no auth of its
 * own, so exposing it would be exposing an unauthenticated service. Everything goes through here,
 * behind the same JWT as the rest of the CRM.
 */

/**
 * One place to turn an AI failure into an answer a person can act on.
 *
 * The distinction that matters is between "the AI is not available" and "the AI answered badly".
 * The first is a server the studio can start; the second is worth retrying. Both are said plainly
 * rather than as a 500, because a red banner saying "error" teaches nobody anything.
 */
function sendAiError(res, error, fallback) {
  const code = error?.code || "";
  if (code === "AI_UNAVAILABLE" || code === "AI_MODEL_MISSING") {
    return res.status(503).json({ message: error.message, code, retryable: false });
  }
  if (code === "AI_TIMEOUT") {
    return res.status(504).json({ message: error.message, code, retryable: true });
  }
  if (code === "AI_BAD_JSON" || code === "AI_EMPTY" || code === "AI_BAD_RESPONSE") {
    return res.status(502).json({ message: "The AI gave an answer that could not be read. Try again.", code, retryable: true });
  }
  // A missing lead or an empty question - the caller's, and worth naming.
  if (error?.message && /required|no longer exists|no transcript|Ask a question/i.test(error.message)) {
    return res.status(400).json({ message: error.message });
  }
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
}

/** Whether the AI is usable, so the panel can say why not instead of failing on first use. */
async function health(_req, res) {
  try {
    return res.json({ data: await provider.health() });
  } catch (error) {
    return res.status(500).json({ message: "Unable to check the AI service." });
  }
}

async function analyzeLeadHandler(req, res) {
  try {
    return res.json({ data: await analyzeLead(req.body?.enquiryId) });
  } catch (error) {
    return sendAiError(res, error, "Unable to analyse that lead.");
  }
}

/**
 * Analyse one stored transcript.
 *
 * Re-reads a transcript that is already saved, which is what makes this safe to retry: the
 * expensive half - downloading and transcribing minutes of audio - is not repeated.
 */
async function analyzeCallHandler(req, res) {
  try {
    const id = String(req.body?.transcriptId || "").trim();
    if (!id) return res.status(400).json({ message: "A transcript id is required." });
    const row = await transcripts.findById(id);
    if (!row) return res.status(404).json({ message: "That transcript no longer exists." });
    if (!row.fullText) return res.status(400).json({ message: "That call has no transcript text to analyse." });

    const analysis = await analyzeCall({
      fullText: row.fullText,
      durationSeconds: row.durationSeconds,
      language: row.language,
      translated: String(row.provider || "").includes("translate") && row.language && row.language !== "en",
    });
    return res.json({ data: analysis });
  } catch (error) {
    return sendAiError(res, error, "Unable to analyse that call.");
  }
}

async function summarizeHandler(req, res) {
  try {
    return res.json({ data: await analyzeConversation(req.body?.enquiryId) });
  } catch (error) {
    return sendAiError(res, error, "Unable to summarise that conversation.");
  }
}

async function chatHandler(req, res) {
  try {
    const data = await askAboutLead({
      enquiryId: req.body?.enquiryId,
      question: req.body?.question,
      history: req.body?.history,
    });
    return res.json({ data });
  } catch (error) {
    return sendAiError(res, error, "Unable to answer that question.");
  }
}

/**
 * The same answer as `chat`, streamed.
 *
 * Server-sent events, because the browser gets them with one `fetch` and no library, and because a
 * dropped connection is simply a closed stream rather than a half-written JSON body.
 *
 * The headers go out before the model is asked anything: a proxy that buffers would hold the whole
 * answer and undo the point of streaming, so the stream is opened first and kept alive by the
 * tokens themselves.
 */
async function chatStreamHandler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx buffers proxied responses by default, which would defeat the whole thing.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { basedOn, answer, corrected, meeting } = await streamAboutLead({
      enquiryId: req.body?.enquiryId,
      question: req.body?.question,
      history: req.body?.history,
    }, (piece) => send("token", { t: piece }));

    /*
     * The message asked to book something. The panel shows it for confirmation - this never books.
     *
     * A calendar invite emails a real client and cannot be recalled, so the booking itself goes
     * through the CRM's existing meeting endpoint, with its own permission check, after a person
     * has read the details and pressed the button.
     */
    if (meeting) send("meeting", meeting);
    /*
     * The streamed draft was rewritten - it quoted the system prompt back - so what the reader is
     * watching is not the answer. Send the corrected text to replace it.
     */
    if (corrected) send("replace", { text: answer });
    send("done", { basedOn, corrected });
  } catch (error) {
    // The stream is already open, so a failure is an event rather than a status code. The browser
    // shows it in the thread where the half-written answer was.
    send("error", { message: error?.message || "The AI could not answer.", code: error?.code || "" });
  } finally {
    res.end();
  }
}

/**
 * The same conversation, about the module rather than one lead.
 *
 * No `enquiryId`: this reads the CRM's totals, so there is nothing to point it at. What it may
 * count is decided by the route's permission check, not here.
 */
async function crmChatHandler(req, res) {
  try {
    const data = await askAboutCrm({
      question: req.body?.question,
      history: req.body?.history,
      verticals: req.body?.vertical ? [req.body.vertical] : [],
      scope: await leadScope(req),
      // Who is asking, for the reads that cannot be answered by a `where` alone - the meetings and
      // the project count on the calendar line.
      reader: { userId: Number(req.user.id), permissions: req.permission },
    });
    return res.json({ data });
  } catch (error) {
    return sendAiError(res, error, "Unable to answer that question about the CRM.");
  }
}

async function crmChatStreamHandler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { basedOn, answer, corrected } = await streamAboutCrm({
      question: req.body?.question,
      history: req.body?.history,
      verticals: req.body?.vertical ? [req.body.vertical] : [],
      scope: await leadScope(req),
      // Who is asking, for the reads that cannot be answered by a `where` alone - the meetings and
      // the project count on the calendar line.
      reader: { userId: Number(req.user.id), permissions: req.permission },
    }, (piece) => send("token", { t: piece }));
    if (corrected) send("replace", { text: answer });
    send("done", { basedOn, corrected });
  } catch (error) {
    send("error", { message: error?.message || "The AI could not answer.", code: error?.code || "" });
  } finally {
    res.end();
  }
}

module.exports = { health, chatStream: chatStreamHandler, crmChat: crmChatHandler, crmChatStream: crmChatStreamHandler, analyzeLead: analyzeLeadHandler, analyzeCall: analyzeCallHandler, summarize: summarizeHandler, chat: chatHandler };
