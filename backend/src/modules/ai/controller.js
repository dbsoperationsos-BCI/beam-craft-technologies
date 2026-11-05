const provider = require("../../services/ai/provider");
const { buildAccessContext, AiAccessError } = require("../../services/ai/accessContext");
const { AI_MODULES, findModule, isGlobal } = require("../../services/ai/modules");
const { verticalFor, otherVerticalNamed, otherVerticalReply } = require("../../services/ai/verticals");
const toolRegistry = require("../../services/ai/tools/registry");
const memory = require("../../services/ai/memory/conversations");
const { answerWithTools } = require("../../services/ai/orchestrator");
const limits = require("../../services/ai/limits");
const { cancelOnDisconnect } = require("../../services/ai/disconnect");
const audit = require("../../services/ai/audit");
const { isOutOfScope, outOfScopeReply, greetingReply, isUnreadableScript, unreadableScriptReply } = require("../../services/ai/scope");
const { classify, INTENT } = require("../../services/ai/intent");
const { candidateNames } = require("../../services/ai/mentions");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { transcribeAudioFile } = require("../sales/call-transcripts/transcriber");

/*
 * Registered once, when this module is first required.
 *
 * At load rather than per request, because the registry throws on a malformed tool - a name that
 * does not match its module, a module that is not registered, a missing risk class. Those are
 * programming errors and should stop the server starting, not surface as a refusal to one user.
 */
require("../../services/ai/tools").registerAllTools();

/**
 * The central AI gateway.
 *
 * One entry point for every module, so there is one place where a request is authenticated, scoped
 * and refused - rather than each module growing its own assistant and its own idea of who may use
 * it. The browser never reaches Ollama: it is bound to loopback and has no authentication of its
 * own, so it is only ever addressed from here.
 *
 * What this does NOT do yet, deliberately: read any business data. Tools arrive in Phase 3, and
 * shipping a gateway that can already reach the database would put the data path in before the
 * authorization path is tested. Until then it answers about the studio's work and says plainly that
 * it cannot look anything up.
 */

/** Whether the whole subsystem is switched on - `provider.enabled`, which the lead assistant reads too. */
const aiEnabled = () => provider.enabled();

/*
 * One place to turn a failure into something a person can act on.
 *
 * The distinction that matters is between "you may not" and "it is not working". The first is a
 * decision and is final; the second is a machine and may be worth retrying.
 */
function sendAiError(res, error, fallback) {
  // A limit is a decision the caller can act on - wait, or ask less often - not a fault.
  if (error instanceof limits.AiLimitError) {
    return res.status(error.status).json({ message: error.message, code: error.code, retryable: true });
  }
  if (error instanceof AiAccessError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  const code = error?.code || "";
  if (code === "AI_UNAVAILABLE" || code === "AI_MODEL_MISSING") {
    return res.status(503).json({ message: "The assistant is temporarily unavailable.", code, retryable: false });
  }
  if (code === "AI_TIMEOUT") {
    return res.status(504).json({ message: error.message, code, retryable: true });
  }
  if (code === "AI_BAD_JSON" || code === "AI_EMPTY" || code === "AI_BAD_RESPONSE") {
    return res.status(502).json({ message: "The assistant gave an answer that could not be read. Try again.", code, retryable: true });
  }
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
}

/**
 * Whether the assistant is usable, and which modules this particular user may open.
 *
 * Behind `protect`, because the module list is a description of someone's access. It reports
 * whether Ollama is reachable and whether the model is installed, and nothing about where either
 * lives - an address is infrastructure detail and belongs in the server's own logs.
 */
async function health(req, res) {
  try {
    if (!aiEnabled()) {
      return res.json({ data: { ok: false, enabled: false, reason: "The assistant is switched off.", modules: [] } });
    }

    const status = await provider.health();
    // Which modules this user could actually open, resolved the same way a real request would be.
    const available = [];
    for (const entry of Object.values(AI_MODULES)) {
      try {
        await buildAccessContext({ userId: req.user?.id, requestedModule: entry.id });
        available.push({ id: entry.id, label: entry.label, description: entry.description });
      } catch {
        // Not available to this user. Absent from the list rather than listed as refused.
      }
    }

    let global = false;
    try {
      await buildAccessContext({ userId: req.user?.id, requestedModule: "GLOBAL" });
      global = true;
    } catch { /* Not a Super Admin. */ }

    return res.json({
      data: {
        ok: Boolean(status?.ok),
        enabled: true,
        // The model's own words when something is missing - "run: ollama pull ..." is worth showing.
        reason: status?.ok ? "" : status?.reason || "",
        provider: status?.provider || "",
        modules: available,
        global,
        // What the machine is doing right now, so a slow assistant can be told apart from a busy one.
        load: limits.state(),
      },
    });
  } catch (error) {
    return sendAiError(res, error, "Unable to check the assistant.");
  }
}

/*
 * The instructions for a module session.
 *
 * The boundary is explained to the model for the reader's sake - so a refusal reads as a boundary
 * rather than a fault - but nothing here enforces anything. Enforcement happened before this string
 * was built, in `buildAccessContext`, and will happen again per tool in Phase 2. A prompt is not a
 * permission system: text arriving from a lead's remarks or a transcript can say anything it likes,
 * and it must not be able to widen what this session may reach.
 */
function systemPromptFor(context) {
  /*
   * Read from the registry, not written out here.
   *
   * The prompt is for the reader's benefit - so a refusal reads as a boundary rather than a fault.
   * It enforces nothing: the filtering already happened in `toolsFor`, and each call is checked
   * again in `executeTool`. Text arriving from a lead's remarks can say anything it likes and
   * cannot widen this.
   */
  const tools = toolRegistry.toolDefinitionsFor(context);
  const scope = isGlobal(context.scope)
    ? "You are working across the whole business, for a Super Admin."
    : `You are working in ${findModule(context.scope)?.label || context.scope} only.`;

  /*
   * Which of the studio's three businesses this session covers.
   *
   * The CRM holds three that have nothing to do with each other, and the screen shows one at a time.
   * The tools are already filtered to it, so the model cannot read another vertical's leads - this
   * is so it says which one it is looking at instead of answering as though the others were empty.
   */
  const vertical = verticalFor(context.vertical);
  const verticalLines = vertical
    ? [
        "",
        `This session covers ${vertical.name} only, which shoots ${vertical.shoots}.`,
        `Everything you say must be about ${vertical.name}: ${vertical.covers}.`,
        `You cannot see ${vertical.never}. If asked about those, say you only have ${vertical.name}`,
        "details here and that they should switch to that vertical - do not guess at an answer.",
      ]
    : [];

  return [
    "You are Nebula, the AI assistant inside DBS Operations OS, a photography studio's operations system in India.",
    /*
     * Said explicitly, because the location alone was answering the question wrongly.
     *
     * Asked "what languages do you know" the model replied "I know Tamil and English" - it had read
     * "Tamil Nadu" in this very sentence and taken it for a statement about itself.
     */
    "You read and write English only. You do not speak Tamil or any other language. If asked what",
    "languages you know, the answer is English.",
    "If someone asks who you are, you are Nebula. Never call yourself anything else.",
    scope,
    "",
    /*
     * How to talk, rather than what to say.
     *
     * Described as behaviour and never as a sample line. Four separate attempts to show this model
     * what a good answer looks like ended with it reciting the example verbatim - a Tanglish sample
     * came back five times out of five, and "call her between 4 and 6" was returned word for word to
     * an unrelated question. So there is nothing quotable here.
     *
     * The greeting rule earns its line: asked "hi", the model had nothing to work with and recited
     * the identity sentence above it, producing a paragraph about wedding albums in reply to a
     * hello. Matching the size of the reply to the size of the question is the single biggest
     * difference between this reading as a colleague and as a brochure.
     */
    "How to talk:",
    "- Match the length of your reply to the question. A greeting gets a short, warm greeting back",
    "  and an offer to help - one line, not a description of yourself.",
    "- Write like a helpful colleague talking: plain sentences, no headings, no bullet lists unless",
    "  you are genuinely listing several things.",
    "- Answer the question that was actually asked. If someone questions your answer, look again at",
    "  the figures you were given rather than repeating yourself.",
    "- If a question is ambiguous, say which reading you took, or ask which they meant.",
    ...verticalLines,
    "",
    "If someone asks about another part of the business, say this session covers only this module and",
    "that they should open the assistant there. Do not guess at the answer.",
    "",
    /*
     * Whether it can look things up - but never the tool names.
     *
     * Listing them here made it write "sales.getPipeline" as the answer instead of calling it. The
     * names, descriptions and arguments already reach the model through Ollama's own tools
     * parameter, which is the mechanism that actually runs them; repeating them in prose only gave
     * it something to copy.
     */
    /*
     * Nothing is said about tools when there are any.
     *
     * The names are already given to the model through Ollama's own `tools` parameter, which is the
     * mechanism that runs them. Every attempt to mention them in prose made it produce a tool name
     * as the answer instead of calling one - first by listing them, then, after the list was taken
     * out, by a single line saying "never write a tool name". Naming the thing is what summons it.
     * With the subject absent the model calls the tool.
     */
    tools.length
      ? ""
      : "You cannot look up any records in this session. Answer from your own experience of the work, "
        + "and when a question needs data from the system, say you cannot read it.",
    "",
    /*
     * The numbers rule, and it is the one that matters most.
     *
     * Every count on the page is labelled with the period it covers - "Total leads, all time",
     * "New leads added today" - because the model was reading a total as a figure for today. Telling
     * it to read the label is cheap; the labels themselves are what actually fixed it.
     */
    "Every figure you give must come from the records above, read from the line whose label matches",
    "what was asked. A question about today needs the line that says today, not the total. If the",
    "records do not answer the question, say so rather than working something out from a number that",
    "was measuring something else.",
    "",
    "Lead with the answer - no preamble, no restating the question. Keep it to two or three sentences",
    "unless more was genuinely asked for.",
  ].join("\n");
}

/**
 * The prompt for one turn: what has been said, then what is being asked.
 *
 * Bounded by `recentTurns` before it gets here - a thread that has run all afternoon would
 * otherwise fill the model's window with its own beginning and leave no room for the question.
 */
/**
 * The conversation so far, and whether any of it is written down.
 *
 * Two ways a turn can know what came before it, and the difference is retention rather than
 * capability:
 *
 * **The caller carries it.** The panel keeps the thread in memory and sends it with each question.
 * Nothing is stored, so closing the browser or refreshing the page ends the conversation - there is
 * no row to find afterwards. This is what the module assistant does: it is a scratchpad beside
 * whatever screen you are on, and a scratchpad that survives a refresh is a record nobody asked to
 * keep about the clients they were discussing.
 *
 * **The server keeps it.** A conversation row and its turns, resumed by `conversationId`. Still
 * supported for a caller that wants a thread it can come back to.
 *
 * `history` wins when both are sent, because a caller that took the trouble to carry the thread is
 * asking for the ephemeral one.
 */
/**
 * Whether this question belongs to the application at all.
 *
 * Only asked of questions that carry no sign of needing the studio's records. A DATA question has
 * already proved it names records, and a KNOWLEDGE one has named a written process - running a
 * vocabulary check over either could only ever produce a false refusal.
 *
 * The check lives here rather than in the prompt for the reason every other rule in this system
 * does: a small model does not reliably follow a negative instruction. Told to refuse general
 * knowledge it held for a coding request and cheerfully answered "what is the capital of France".
 *
 * **A word list alone is not enough, and chasing it was the wrong instinct.** "What city is Shivani
 * in" and "is Shivani interested" are the most ordinary questions in a CRM and neither contains a
 * word a vocabulary check would notice; both were refused. Adding "city", then "interested", then
 * the next phrasing is a list that is never finished, and every gap in it is a real question turned
 * away.
 *
 * So when the words say off-topic, the database is asked before anything is refused: if a word in
 * the question matches a real lead, the question is about that lead whatever it looks like. That
 * costs one bounded indexed lookup, and only on the questions that were about to be refused - which
 * are rare, and were about to cost nothing anyway.
 */
async function refusalForOutOfScope(message, history, context) {
  // A script this assistant does not read is settled before anything else looks at the question.
  if (isUnreadableScript(message)) return unreadableScriptReply();

  const intent = classify(message, history);
  if (intent.intent !== INTENT.GENERAL) return null;
  if (!isOutOfScope(message, { module: context.scope })) return null;

  const searchTool = toolRegistry.toolsFor(context).find((tool) => /\.searchLeads$/.test(tool.name));
  if (searchTool) {
    for (const candidate of candidateNames(message)) {
      try {
        const found = await toolRegistry.executeTool(searchTool.name, { search: candidate, limit: 1 }, context);
        // A real record named in the question settles it: this is not general knowledge.
        if (Array.isArray(found?.items) && found.items.length) return null;
      } catch {
        // A failed lookup must not turn into a refusal - fall through to the words' verdict.
      }
    }
  }

  return outOfScopeReply(context.scope);
}

async function threadFor({ body, context, message }) {
  const supplied = Array.isArray(body?.history) ? body.history : null;
  if (supplied) {
    return {
      conversation: null,
      // Bounded here rather than trusted: the client decides what to remember, not how much of the
      // model's context window to occupy.
      messages: supplied
        .filter((turn) => turn && typeof turn.content === "string" && turn.content.trim())
        .slice(-MAX_SUPPLIED_TURNS)
        .map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content })),
    };
  }

  const conversation = await memory.openConversation({
    id: body?.conversationId,
    userId: context.userId,
    module: context.scope,
    firstMessage: message,
  });
  const history = await memory.recentTurns({ conversationId: conversation.id });
  return {
    conversation,
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
  };
}

/** Enough for a conversation to hang together; short enough that it cannot crowd out the question. */
const MAX_SUPPLIED_TURNS = Number(process.env.AI_MAX_SUPPLIED_TURNS || 12);

function promptWithHistory(history, message) {
  const prior = history
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n");
  return [prior && `Conversation so far:\n${prior}\n`, `User: ${message}`].filter(Boolean).join("\n");
}

/**
 * The same answer as `chat`, delivered as it is written.
 *
 * Server-sent events: the browser reads them with one `fetch` and no library, and a dropped
 * connection is a closed stream rather than half a JSON body. Headers go out before the model is
 * asked anything, because a proxy that buffers would hold the whole answer and undo the point.
 *
 * Everything before the transport is shared with `chat` - the access context, the vertical
 * deflection, the memory, the limits - so the two cannot drift apart on anything that matters.
 */
async function chatStream(req, res) {
  const requestId = audit.newRequestId();
  const startedAt = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx buffers proxied responses by default, which would defeat the whole thing.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (!aiEnabled()) throw new AiAccessError("AI_DISABLED", "The assistant is switched off.", 503);

    const message = String(req.body?.message || "").trim();
    if (!message) throw new AiAccessError("AI_EMPTY_QUESTION", "Ask a question first.", 400);
    if (message.length > 4000) throw new AiAccessError("AI_INPUT_TOO_LONG", "That message is too long.", 413);

    const context = await buildAccessContext({
      userId: req.user?.id,
      requestedModule: req.body?.module,
      requestedVertical: req.body?.vertical,
    });
    audit.requestStarted({ requestId, userId: context.userId, module: context.scope, isSuperAdmin: context.isSuperAdmin });

    const thread = await threadFor({ body: req.body, context, message });
    send("start", { conversationId: thread.conversation?.id || null, module: context.scope });

    const greeting = greetingReply(message, context.scope);
    if (greeting) {
      send("token", { t: greeting });
      if (thread.conversation) await memory.recordTurn({ conversationId: thread.conversation.id, question: message, answer: greeting });
      send("done", {});
      return;
    }

    /*
     * Outside the application entirely - answered without a model, like the vertical guard below.
     * There is nothing for a generation to add to a refusal, and it would take a second to say it.
     */
    const offTopic = await refusalForOutOfScope(message, thread.messages, context);
    if (offTopic) {
      send("token", { t: offTopic });
      if (thread.conversation) await memory.recordTurn({ conversationId: thread.conversation.id, question: message, answer: offTopic });
      send("done", {});
      return;
    }

    // A question about another vertical is answered without a model, as in `chat`.
    const otherVertical = otherVerticalNamed(message, context.vertical);
    if (otherVertical) {
      const answer = otherVerticalReply(context.vertical, otherVertical);
      send("token", { t: answer });
      if (thread.conversation) await memory.recordTurn({ conversationId: thread.conversation.id, question: message, answer });
      send("done", {});
      return;
    }

    const { answer, trace } = await limits.withLimits(context.userId, () => answerWithTools({
      system: systemPromptFor(context),
      messages: [...thread.messages, { role: "user", content: message }],
      context,
      // The reader closing the panel stops the generation, and frees its slot for somebody else.
      signal: cancelOnDisconnect(res),
      // Each fragment reaches the reader as it is produced.
      onToken: (piece) => send("token", { t: piece }),
    }));

    /*
     * A tool-backed answer is not streamed - the loop has to finish before there is an answer - so
     * it is sent whole here. The panel appends it the same way either way.
     */
    if (!answer) send("token", { t: "" });
    send("answer", { answer });

    // Only when the server is the one keeping the thread. See `threadFor`.
    if (thread.conversation) await memory.recordTurn({ conversationId: thread.conversation.id, question: message, answer });
    // Every lookup the answer rested on, allowed or refused - as the JSON path records them.
    for (const call of trace || []) {
      audit.toolCall({
        requestId, userId: context.userId, module: context.scope,
        tool: call.name, ms: call.ms, allowed: !call.refused, code: call.code,
      });
    }
    audit.requestFinished({
      requestId, userId: context.userId, module: context.scope,
      ms: Date.now() - startedAt, toolCount: (trace || []).length, ok: true,
    });
    send("done", {});
  } catch (error) {
    // The stream is open, so a failure is an event rather than a status code.
    send("error", { message: error?.message || "The assistant could not answer.", code: error?.code || "" });
  } finally {
    res.end();
  }
}

/**
 * Turns a spoken question into text.
 *
 * Through the studio's own faster-whisper, the same one that handles call recordings - not the
 * browser's Web Speech API, which would send whatever somebody dictates about a client to Google.
 * The whole system has been built so nothing leaves this machine, and dictation is not the place to
 * make an exception.
 *
 * Returns text for the composer rather than answering. The person reads what was heard and presses
 * send, so a misheard word is corrected before it becomes a question - which matters, because
 * transcription of a name over a noisy line is exactly where this gets things wrong.
 */
async function voice(req, res) {
  if (!aiEnabled()) return res.status(503).json({ message: "The assistant is switched off.", code: "AI_DISABLED" });
  if (!req.file?.buffer?.length) return res.status(400).json({ message: "No audio was received." });

  // The module is still checked: dictation is part of an assistant session, not a free service.
  let context;
  try {
    context = await buildAccessContext({ userId: req.user?.id, requestedModule: req.body?.module });
  } catch (error) {
    return sendAiError(res, error, "Unable to transcribe that.");
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `dbs-voice-${crypto.randomBytes(6).toString("hex")}-`));
  try {
    const source = path.join(directory, "input.webm");
    await fs.writeFile(source, req.file.buffer);

    // Under the same concurrency limit as a generation: whisper wants a core too.
    const result = await limits.withLimits(context.userId, () => transcribeAudioFile(source, directory));
    return res.json({ data: { text: result.text, seconds: result.durationSeconds } });
  } catch (error) {
    if (error?.code === "FASTER_WHISPER_MISSING") {
      return res.status(503).json({ message: "Speech recognition is not installed on the server.", code: error.code });
    }
    return sendAiError(res, error, "Unable to transcribe that.");
  } finally {
    // The recording is deleted whatever happened. It is somebody's voice.
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * This person's threads in the module they are working in.
 */
async function conversations(req, res) {
  try {
    if (!aiEnabled()) return res.status(503).json({ message: "The assistant is switched off.", code: "AI_DISABLED" });
    const context = await buildAccessContext({ userId: req.user?.id, requestedModule: req.query?.module });
    const items = await memory.listConversations({ userId: context.userId, module: context.scope });
    return res.json({ data: { module: context.scope, conversations: items } });
  } catch (error) {
    return sendAiError(res, error, "Unable to list conversations.");
  }
}

/** Deletes one of this person's threads. */
async function removeConversation(req, res) {
  try {
    const context = await buildAccessContext({ userId: req.user?.id, requestedModule: req.query?.module });
    const deleted = await memory.deleteConversation({
      id: req.params.id,
      userId: context.userId,
      module: context.scope,
    });
    // The same answer whether it never existed or was somebody else's.
    if (!deleted) return res.status(404).json({ message: "That conversation was not found." });
    return res.json({ message: "Conversation deleted." });
  } catch (error) {
    return sendAiError(res, error, "Unable to delete that conversation.");
  }
}

/**
 * What this session is allowed to do.
 *
 * The same filtering the model gets, exposed so the panel can show it and so the boundary can be
 * inspected without reading the prompt.
 */
async function tools(req, res) {
  try {
    if (!aiEnabled()) return res.status(503).json({ message: "The assistant is switched off.", code: "AI_DISABLED" });
    const context = await buildAccessContext({ userId: req.user?.id, requestedModule: req.query?.module });
    return res.json({
      data: { module: context.scope, tools: toolRegistry.toolDefinitionsFor(context) },
    });
  } catch (error) {
    return sendAiError(res, error, "Unable to list what the assistant can do.");
  }
}

/**
 * One turn of conversation, in a module the caller is allowed to be in.
 *
 * `module` is the only thing taken from the request, and it is a request rather than an assertion -
 * `buildAccessContext` decides whether it is granted.
 */
async function chat(req, res) {
  try {
    if (!aiEnabled()) {
      return res.status(503).json({ message: "The assistant is switched off.", code: "AI_DISABLED" });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ message: "Ask a question first." });
    // A bounded input, so one paste cannot become a minutes-long generation.
    if (message.length > 4000) {
      return res.status(413).json({ message: "That message is too long for the assistant.", code: "AI_INPUT_TOO_LONG" });
    }

    const requestId = audit.newRequestId();
    const startedAt = Date.now();

    let context;
    try {
      context = await buildAccessContext({
        // The authenticated user, not a body field.
        userId: req.user?.id,
        requestedModule: req.body?.module,
        // Which board the CRM is showing. A filter, not a permission - see accessContext.
        requestedVertical: req.body?.vertical,
      });
    } catch (error) {
      // A refusal is recorded before it is returned: a CRM session repeatedly asking for HRM is
      // either a confused model or somebody probing, and neither is visible otherwise.
      audit.accessDenied({ requestId, userId: req.user?.id, module: req.body?.module, code: error.code });
      throw error;
    }
    audit.requestStarted({ requestId, userId: context.userId, module: context.scope, isSuperAdmin: context.isSuperAdmin });

    /*
     * The thread this turn belongs to.
     *
     * The conversation id comes from the browser, and it is looked up by (id, userId, module) - so
     * an id belonging to someone else, or to another module, resolves to nothing and a fresh thread
     * is opened instead. Isolation is in the query rather than in a check afterwards.
     */
    const thread = await threadFor({ body: req.body, context, message });
    const conversation = thread.conversation;

    const greeting = greetingReply(message, context.scope);
    if (greeting) {
      if (conversation) await memory.recordTurn({ conversationId: conversation.id, question: message, answer: greeting });
      return res.json({ data: { answer: greeting, module: context.scope, conversationId: conversation?.id || null, tools: [] } });
    }

    // Outside the application entirely. Same rule as the streaming handler.
    const offTopic = await refusalForOutOfScope(message, thread.messages, context);
    if (offTopic) {
      if (conversation) await memory.recordTurn({ conversationId: conversation.id, question: message, answer: offTopic });
      return res.json({ data: { answer: offTopic, module: context.scope, conversationId: conversation?.id || null, tools: [] } });
    }

    /*
     * A question about another board is answered here, without a model.
     *
     * The prompt says to decline these and the model does not reliably do it - asked on Dum Dum how
     * many Qua Qua leads there were, it read a zero off a Dum-Dum-filtered summary and reported
     * "Qua Qua leads: 0". Nothing leaked and the answer was still wrong, because a zero reads as an
     * emptiness rather than as no access. Instant, exact, and it cannot be argued with.
     */
    const otherVertical = otherVerticalNamed(message, context.vertical);
    if (otherVertical) {
      const answer = otherVerticalReply(context.vertical, otherVertical);
      if (conversation) await memory.recordTurn({ conversationId: conversation.id, question: message, answer });
      audit.requestFinished({
        requestId, userId: context.userId, module: context.scope,
        ms: Date.now() - startedAt, toolCount: 0, ok: true,
      });
      return res.json({ data: { answer, module: context.scope, conversationId: conversation?.id || null, tools: [] } });
    }

    const history = thread.messages;
    /*
     * The model may need to look something up before it can answer, so the turn runs as a loop
     * rather than a single call - and every tool it asks for is authorized again on the way in.
     */
    /*
     * Under the concurrency and rate limits.
     *
     * Ollama runs on the same two cores as the CRM, and a generation holds one of them for the
     * better part of a minute. Without a cap, three people asking at once is the machine that also
     * has to serve the leads table.
     */
    const { answer, trace } = await limits.withLimits(context.userId, () => answerWithTools({
      system: systemPromptFor(context),
      messages: [...history.map((turn) => ({ role: turn.role, content: turn.content })), { role: "user", content: message }],
      context,
    }));

    for (const call of trace) {
      audit.toolCall({
        requestId, userId: context.userId, module: context.scope,
        tool: call.name, ms: call.ms, allowed: !call.refused, code: call.code,
      });
    }
    audit.requestFinished({
      requestId, userId: context.userId, module: context.scope,
      ms: Date.now() - startedAt, toolCount: trace.length, ok: true,
    });

    // Recorded after the answer, so a failed turn does not leave a question with no reply.
    if (conversation) await memory.recordTurn({ conversationId: conversation.id, question: message, answer, toolTrace: trace });

    return res.json({
      data: {
        answer,
        // Echoed back so the panel can show which session answered, and so a wrong scope is visible
        // rather than silent.
        module: context.scope,
        conversationId: conversation?.id || null,
        // Which tools ran, so the panel can show it and a wrong lookup is visible rather than silent.
        tools: trace,
      },
    });
  } catch (error) {
    return sendAiError(res, error, "Unable to answer that question.");
  }
}

module.exports = { health, chat, threadFor, chatStream, voice, tools, conversations, removeConversation, aiEnabled, systemPromptFor, promptWithHistory };
