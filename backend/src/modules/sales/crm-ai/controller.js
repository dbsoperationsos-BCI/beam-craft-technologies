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
const { getCrmLeadById } = require("../crm-leads/crmLeadService");
const limits = require("../../../services/ai/limits");
const audit = require("../../../services/ai/audit");
const { cancelOnDisconnect } = require("../../../services/ai/disconnect");

/**
 * Nebula's workflow, for one lead as for the module: the person's permission (the router's
 * READ on CRM Leads), then the record - only a lead the CRM board would show this person - then a
 * read-only lookup, under the same rate and concurrency limits as the module assistant, and only
 * while Nebula is switched on. Out of scope reads as not found, exactly as the board's own record
 * endpoints answer, so the assistant can never confirm a lead exists that the screen would hide.
 */
async function leadVisible(req, enquiryId) {
  const id = String(enquiryId || "").trim();
  // Fails closed: no lead named is no lead in reach.
  if (!id) return false;
  const [scope, record] = await Promise.all([leadScope(req), getCrmLeadById(id)]);
  return Boolean(record && scope.allows(record.lead || {}));
}

/** Answered before any work while Nebula is switched off. False when it has replied. */
function switchedOn(res) {
  if (provider.enabled()) return true;
  res.status(503).json({ message: "The assistant is switched off.", code: "AI_DISABLED" });
  return false;
}

/**
 * Answered before any work about one lead: switched off, no lead named, or a lead out of reach.
 * False when it has replied. `notFound` is the refusal's wording, so a route about something the
 * lead owns (a transcript) can refuse in its own words and say no more than "not found" either way.
 */
async function admitted(req, res, enquiryId, notFound = "That lead was not found.") {
  if (!switchedOn(res)) return false;
  if (!String(enquiryId || "").trim()) {
    res.status(400).json({ message: "An enquiry id is required." });
    return false;
  }
  if (!await leadVisible(req, enquiryId)) {
    audit.accessDenied({ requestId: audit.newRequestId(), userId: Number(req.user?.id), module: "SALES", code: "AI_LEAD_OUT_OF_SCOPE" });
    res.status(404).json({ message: notFound });
    return false;
  }
  return true;
}

/** One answer under Nebula's limits, recorded start and finish - never its content. */
async function limited(req, run) {
  const userId = Number(req.user?.id);
  const requestId = audit.newRequestId();
  const startedAt = Date.now();
  audit.requestStarted({ requestId, userId, module: "SALES", isSuperAdmin: false });
  try {
    const result = await limits.withLimits(userId, run);
    audit.requestFinished({ requestId, userId, module: "SALES", ms: Date.now() - startedAt, toolCount: 0, ok: true });
    return result;
  } catch (error) {
    audit.requestFinished({ requestId, userId, module: "SALES", ms: Date.now() - startedAt, toolCount: 0, ok: false });
    throw error;
  }
}

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
  // Too many at once, or too many from one person: said as the module assistant says it.
  if (error instanceof limits.AiLimitError) {
    return res.status(error.status).json({ message: error.message, code: error.code, retryable: true });
  }
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
    if (!await admitted(req, res, req.body?.enquiryId)) return undefined;
    return res.json({ data: await limited(req, () => analyzeLead(req.body?.enquiryId)) });
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
    // One answer for "no such transcript" and "not yours to read", so an id says nothing either way.
    const GONE = "That transcript no longer exists.";
    const row = await transcripts.findById(id);
    if (!row) return res.status(404).json({ message: GONE });
    /*
     * A transcript is its lead's: out of reach with it. One tied to no lead belongs to nobody's
     * board, so only somebody the scope does not narrow may read it - never "no lead, so allowed".
     */
    if (String(row.enquiryId || "").trim()) {
      if (!await admitted(req, res, row.enquiryId, GONE)) return undefined;
    } else {
      if (!switchedOn(res)) return undefined;
      if (!(await leadScope(req)).unlimited) return res.status(404).json({ message: GONE });
    }
    if (!row.fullText) return res.status(400).json({ message: "That call has no transcript text to analyse." });

    const analysis = await limited(req, () => analyzeCall({
      fullText: row.fullText,
      durationSeconds: row.durationSeconds,
      language: row.language,
      translated: String(row.provider || "").includes("translate") && row.language && row.language !== "en",
    }));
    return res.json({ data: analysis });
  } catch (error) {
    return sendAiError(res, error, "Unable to analyse that call.");
  }
}

async function summarizeHandler(req, res) {
  try {
    if (!await admitted(req, res, req.body?.enquiryId)) return undefined;
    return res.json({ data: await limited(req, () => analyzeConversation(req.body?.enquiryId)) });
  } catch (error) {
    return sendAiError(res, error, "Unable to summarise that conversation.");
  }
}

async function chatHandler(req, res) {
  try {
    if (!await admitted(req, res, req.body?.enquiryId)) return undefined;
    const data = await limited(req, () => askAboutLead({
      enquiryId: req.body?.enquiryId,
      question: req.body?.question,
      history: req.body?.history,
    }));
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
  // Refused before the stream opens, so a refusal is a status the panel can read, not an event.
  try {
    if (!await admitted(req, res, req.body?.enquiryId)) return;
  } catch (error) {
    sendAiError(res, error, "Unable to answer that question.");
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx buffers proxied responses by default, which would defeat the whole thing.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { basedOn, answer, corrected, meeting } = await limited(req, () => streamAboutLead({
      enquiryId: req.body?.enquiryId,
      question: req.body?.question,
      history: req.body?.history,
      // The reader closing the panel stops the generation, and frees its slot for somebody else.
      signal: cancelOnDisconnect(res),
    }, (piece) => send("token", { t: piece })));

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
    if (!switchedOn(res)) return undefined;
    const scope = await leadScope(req);
    const data = await limited(req, () => askAboutCrm({
      question: req.body?.question,
      history: req.body?.history,
      verticals: req.body?.vertical ? [req.body.vertical] : [],
      scope,
      // Who is asking, for the reads that cannot be answered by a `where` alone - the meetings and
      // the project count on the calendar line.
      reader: { userId: Number(req.user.id), permissions: req.permission },
    }));
    return res.json({ data });
  } catch (error) {
    return sendAiError(res, error, "Unable to answer that question about the CRM.");
  }
}

async function crmChatStreamHandler(req, res) {
  try {
    if (!switchedOn(res)) return;
  } catch (error) {
    sendAiError(res, error, "Unable to answer that question about the CRM.");
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const scope = await leadScope(req);
    const { basedOn, answer, corrected } = await limited(req, () => streamAboutCrm({
      question: req.body?.question,
      history: req.body?.history,
      verticals: req.body?.vertical ? [req.body.vertical] : [],
      scope,
      // Who is asking, for the reads that cannot be answered by a `where` alone - the meetings and
      // the project count on the calendar line.
      reader: { userId: Number(req.user.id), permissions: req.permission },
    }, (piece) => send("token", { t: piece })));
    if (corrected) send("replace", { text: answer });
    send("done", { basedOn, corrected });
  } catch (error) {
    send("error", { message: error?.message || "The AI could not answer.", code: error?.code || "" });
  } finally {
    res.end();
  }
}

module.exports = { health, chatStream: chatStreamHandler, crmChat: crmChatHandler, crmChatStream: crmChatStreamHandler, analyzeLead: analyzeLeadHandler, analyzeCall: analyzeCallHandler, summarize: summarizeHandler, chat: chatHandler };
