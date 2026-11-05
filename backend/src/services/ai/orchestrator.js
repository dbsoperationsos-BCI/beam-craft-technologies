const provider = require("./provider");
const registry = require("./tools/registry");
const { retrieve, renderPassages } = require("./knowledge/retriever");
const { classify, INTENT } = require("./intent");
const { candidateNames, looksLikeAboutSomeone } = require("./mentions");

/**
 * One turn, including any tools the model needs along the way.
 *
 * The model does not query anything. It says which tool it wants; this runs it - through
 * `executeTool`, which re-checks the module and the permission from scratch - and hands the result
 * back so the model can answer from it. Round and round until it stops asking, or until the step
 * limit stops it.
 *
 * The limit is not a nicety. A model that misreads a tool's result will ask for it again, and again,
 * and each round is a whole generation on a CPU. Five steps is enough for "find the lead, then read
 * its calls" and short of anything that could run away.
 *
 * Ollama's tool names cannot contain a dot, so `sales.getPipeline` travels as `sales_getPipeline`
 * and is translated back here. The translation is exact and one-way-checked: a name that does not
 * map to a registered tool is refused rather than guessed at.
 */

// Enough for a couple of dependent lookups; short of a loop that never ends.
const MAX_TOOL_STEPS = Number(process.env.AI_MAX_TOOL_STEPS || 5);

/** `sales.getPipeline` → `sales_getPipeline`, because Ollama rejects a dot in a tool name. */
function wireName(name) {
  return String(name).replace(/\./g, "_");
}

/** The definitions the model is given, in Ollama's shape. */
function toolsForModel(context) {
  return registry.toolDefinitionsFor(context).map((tool) => ({
    type: "function",
    function: {
      name: wireName(tool.name),
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * The registered tool a wire name refers to, or null.
 *
 * Resolved by looking through what this session was actually offered rather than by reversing the
 * underscore - an underscore is ambiguous, and guessing at a tool name is not something to do with
 * a permission check on the other side.
 */
function resolveTool(wire, context) {
  return registry.toolsFor(context).find((tool) => wireName(tool.name) === wire) || null;
}


/*
 * The tool calls in a reply, however the model chose to express them.
 *
 * Ollama's native `tool_calls` is the mechanism, and with a small model it is not reliable:
 * `qwen3:1.7b` produces it for a bare prompt and, once a real system prompt is in front of it,
 * starts writing the call into the message body instead - sometimes as `{"name": "...", "arguments":
 * {...}}`, sometimes as the bare tool name. The behaviour was bisected against four prompt variants
 * and none of them called the tool properly, so this is the model's limit rather than something to
 * word around.
 *
 * So a written call is read as a call. That widens nothing: the name is resolved only against the
 * tools this session was offered, and execution still goes through `executeTool`, which re-checks
 * the module and the permission. A model that writes "hrm.getSalaries" here gets the same refusal it
 * would get for asking properly.
 */
function collectCalls(message, context) {
  const native = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (native.length) return native;

  const content = String(message?.content || "").trim();
  if (!content || content.length > 400) return [];

  // `{"name": "sales_getFollowUps", "arguments": {"limit": 20}}`, possibly fenced.
  const object = content.replace(/^```(?:json)?|```$/g, "").trim();
  if (object.startsWith("{")) {
    try {
      const parsed = JSON.parse(object);
      const name = parsed?.name || parsed?.function?.name;
      if (name && resolveTool(name, context)) {
        return [{ function: { name, arguments: parsed.arguments || parsed.function?.arguments || {} } }];
      }
    } catch { /* Not a call. It is an answer that happens to start with a brace. */ }
  }

  // Or the bare name on its own, which is the other shape it produces.
  const bare = content.replace(/[()\s.]+$/, "");
  if (resolveTool(bare, context)) return [{ function: { name: bare, arguments: {} } }];

  return [];
}

/*
 * Field names as a person would say them, so an answer does not read like a database row.
 *
 * "createdDate is 2026-08-27" is what comes back without this. Anything not named here falls back
 * to its own key, which is ugly but never wrong.
 */
/*
 * What an empty field means, said as a sentence.
 *
 * "none / not set" is a placeholder, and a placeholder is something to skim past. A sentence saying
 * nobody is assigned is a fact the model can answer with - which is the whole reason empty fields
 * are printed at all rather than dropped.
 */
const FIELD_EMPTY = {
  owner: "nobody on the studio's staff is assigned to this lead yet",
  nextFollowUpDate: "no follow-up is scheduled",
  lastFollowUpDate: "no follow-up has ever been done",
  source: "not recorded",
  eventType: "not recorded",
  eventDate: "not recorded",
  preferredBudget: "not recorded",
  expectedBudget: "not recorded",
  remarks: "nothing has been written on this lead",
};

const FIELD_LABELS = {
  enquiryId: "Enquiry ID", name: "Name", status: "Status", vertical: "Vertical",
  /*
   * "Owner" alone reads as the client. Asked "who owns this lead" against a record whose owner was
   * unset, the model answered with the client's own name - it is the only person on the page. The
   * label has to say whose side of the relationship it means.
   */
  owner: "Assigned to (which member of studio staff is handling this lead)",
  source: "Where the lead came from",
  createdDate: "Date the lead came in", nextFollowUpDate: "Next follow-up due",
  lastFollowUpDate: "Last follow-up done", eventType: "Type of event", eventDate: "Date of the event",
  city: "City", preferredBudget: "Preferred budget", expectedBudget: "Expected budget",
  remarks: "Remarks written on the lead",
};

/**
 * One record, a field per line, with the empty fields said out loud.
 *
 * The empty ones are the point. Dropping them - which is what this did first - is the same mistake
 * as omitting a section because its count was zero: asked "has she been followed up" against a
 * record whose follow-up dates were simply absent, the model answered "Yes, she has been followed
 * up". Absence reads as unknown and gets filled in. "Last follow-up done: none" cannot be.
 */
function renderRecord(row) {
  return Object.entries(row)
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] || key;
      const empty = value === null || value === undefined || value === "";
      return `- ${label}: ${empty ? (FIELD_EMPTY[key] || "not recorded") : value}`;
    })
    .join("\n");
}


/**
 * Runs the exchange and returns the answer, with a note of which tools ran.
 *
 * `trace` records names and durations only. Results are deliberately absent: they are the business
 * data, and they belong in the answer rather than in a log or a stored message.
 */
/*
 * How the figures beside a question are to be used. In the system prompt on every question, data or
 * not, so the system prompt is the same text every time and Ollama reads it once - written beside
 * the figures it was ~60 tokens re-read on every question, ~2 seconds on a CPU.
 */
const FIGURE_RULES = [
  "When a question comes with current figures, they are already counted for you. Quote them exactly.",
  "You have no other source of numbers. If a figure is not there and you did not look it up,",
  "say you do not have it - never estimate one, and never fill a gap with a plausible number.",
  "Write your own sentences; do not copy the figures block back.",
].join("\n");

/**
 * The conversation as the model reads it: the standing instructions, what has been said, and this
 * question's figures beside the question itself.
 *
 * **The order is the speed.** Ollama keeps the last prompt it read and reuses whatever the next one
 * begins with; on a CPU it reads a reused prefix at ~650 tokens a second and a new one at ~28. The
 * figures used to sit in the system message, ahead of the history - and since they change with
 * every question, everything after them was new each time: a follow-up re-read the whole
 * conversation, ~9 seconds for three earlier exchanges before the first word. Here the system prompt
 * and the history are the same as the request before, and only the figures and the question are new.
 */
function withFigures(system, messages, figures) {
  const block = String(figures || "").trim();
  const last = messages[messages.length - 1];
  if (!block || last?.role !== "user") {
    return [{ role: "system", content: system + (block ? `\n${block}` : "") }, ...messages];
  }
  return [
    { role: "system", content: system },
    ...messages.slice(0, -1),
    { role: "user", content: `${block}\n\nThe question: ${last.content}` },
  ];
}

async function answerWithTools({ system, messages, context, maxTokens, onToken, signal }) {
  const asked = messages.filter((turn) => turn.role === "user").slice(-1)[0]?.content || "";
  const priorTurns = messages.slice(0, -1);

  /*
   * What this question actually needs, decided before any of it is done.
   *
   * Every turn used to fetch the module summaries and run a retrieval regardless - 885ms measured on
   * a question asking for sales ideas, which needs neither, and the CRM summary then sat in front of
   * the model while it answered. That is why general questions came back business-flavoured.
   */
  const intent = classify(asked, priorTurns);

  // Tools are only described to the model when the question is about records. A model handed nine
  // tool definitions for "give me ideas" will find a reason to call one.
  const tools = intent.needsTools ? toolsForModel(context) : [];
  const trace = [{ intent: intent.intent }];

  /*
   * The module's totals, fetched before the question rather than on request.
   *
   * Asked for a business summary, the model answered "15 leads in progress, 3 overdue, 7 follow-ups,
   * 2 new today" without calling anything. Every figure was invented; the real ones were 31,071 and
   * 17. It calls tools readily for a pointed question and not at all for a broad one, and fills the
   * gap with numbers that look right - which for an executive summary is worse than no answer.
   *
   * Deciding to look something up is the unreliable step, so it is taken away: the standing summary
   * runs first and its result is in front of the model before it writes a word. The same approach
   * the CRM panel has always used, and the reason its figures have been correct.
   *
   * Detail lookups are still the model's own choice - those it asks for reliably.
   */
  /*
   * Every module's summary, gathered before the model is asked anything.
   *
   * For a broad question - "give me today's business status" - this is the whole answer path. The
   * model is not asked to decide which modules to look at, because it does not decide reliably:
   * given nine tools and a vague question it called none of them and invented "15 leads in
   * progress, 3 overdue, 7 follow-ups" against real figures of 31,071 and 17.
   *
   * So the gathering is deterministic and the model only writes the prose. It never sees a figure
   * it did not get from a tool, which is the rule: no verified tool result, no business fact.
   *
   * Each still goes through `executeTool`, so a summary is authorized exactly like any other tool -
   * a Super Admin's global session gathers every module because they may reach every module, and a
   * CRM session gathers one because that is all it covers.
   */
  const summaries = [];
  let prefetched = false;
  // Only for a question about records. Grounding a brainstorm in the pipeline is what made it drift.
  /*
   * Asked about attendance with no attendance in this session - the person does not hold it - the
   * answer is said here. Left to the model, a question with nothing to look at was answered anyway,
   * from nothing.
   */
  if (intent.aboutAttendance && !registry.toolsFor(context).some((tool) => tool.module === "ATTENDANCE")) {
    return {
      answer: "I cannot see attendance with your access. The Attendance screens show what you may see, "
        + "or ask somebody who looks after attendance.",
      trace,
      steps: 0,
    };
  }
  // The same for HRM requests, asked by somebody who holds neither of the Requests screen's permissions.
  if (intent.aboutRequests && !registry.toolsFor(context).some((tool) => tool.module === "REQUESTS")) {
    return {
      answer: "I cannot see HRM requests with your access. HRM → Requests shows what you may see, "
        + "or ask somebody who looks after attendance.",
      trace,
      steps: 0,
    };
  }

  // A summary that is about one kind of question (`summaryWhen`) is gathered only for that kind -
  // judged on the question and on what the classifier decided, so a follow-up keeps its topic.
  const summaryTools = intent.needsTools
    ? registry.summaryToolsFor(context).filter((tool) => !tool.summaryWhen || tool.summaryWhen(asked, intent))
    : [];
  for (const tool of summaryTools) {
    const startedAt = Date.now();
    try {
      // Through executeTool, so a summary is authorized exactly like any other tool.
      const args = tool.prefetchArgs ? tool.prefetchArgs({ asked, priorTurns }) : {};
      const result = await registry.executeTool(tool.name, args, context);
      /*
       * A brief when several modules are in play, the full page when only one is.
       *
       * `summaryTools.length` is decided before the loop, so every module in a briefing is rendered
       * the same way rather than the first one getting more room than the rest.
       */
      const brief = summaryTools.length > 1 && tool.renderBrief;
      const rendered = brief ? tool.renderBrief(result) : (tool.renderSummary ? tool.renderSummary(result) : "");
      summaries.push(`${tool.module}:\n${rendered || JSON.stringify(result)}`);
      // The figures are already gathered, so the first turn can stream straight away.
      prefetched = true;
      trace.push({ name: tool.name, ms: Date.now() - startedAt, prefetched: true });
    } catch (error) {
      // A summary that cannot be read is simply absent. The turn still answers.
      trace.push({ name: tool.name, ms: Date.now() - startedAt, refused: true, code: error.code || "" });
    }
  }

  /*
   * The records the question actually names, looked up before the model is asked.
   *
   * The other half of the same idea as the summary above. Asked "I need details about client
   * shivani" the model answered with a list of wedding services, because deciding to search is its
   * job and it does not reliably decide to. So the search is taken away from it: every word that
   * could be a name goes to the CRM's own search, and the database says whether it was one.
   *
   * Only for a question that reads as being about somebody, and only when a lead-search tool is in
   * this session - an Accounts session has no business running lead searches on stray words.
   */
  const mentioned = [];
  const searchTool = registry.toolsFor(context).find((tool) => /\.searchLeads$/.test(tool.name));
  /*
   * Run whenever the question contains a word that could be a name, rather than when it looks like
   * a question about somebody.
   *
   * Trying to recognise the shape of the question was the wrong instinct and produced a wrong
   * answer: "what city is shivani in" matches no pattern for "asks about a person" - no pronoun, no
   * "details", no "who is" - so nothing was looked up and the model placed her in Chennai. There
   * are more ways to ask about somebody than can be listed, and the cost of guessing wrong is an
   * invented fact about a client.
   *
   * So the shape is not judged at all. Any word that is not obviously ordinary English goes to the
   * search, and the database says whether it was a name. A question with nothing name-like in it -
   * "how many leads do we have" - produces no candidates and no query; one with a stray word costs
   * a bounded indexed lookup, which is a few milliseconds against a generation measured in seconds.
   */
  if (searchTool) {
    /*
     * The name may be in the conversation rather than in the question.
     *
     * "Who owns this lead", "has she been followed up", "what is her budget" - all plainly about
     * somebody, none of them containing a name. Looking only at the current question found nothing,
     * so nothing was fetched, and the model answered from the only name on the page: the client's
     * own, reported as the lead's owner.
     *
     * The current question comes first so that naming somebody new switches to them, and earlier
     * turns are read newest-first for the same reason.
     */
    const fromHistory = [...priorTurns]
      .reverse()
      .filter((turn) => turn.role === "user")
      .slice(0, 4)
      .flatMap((turn) => candidateNames(turn.content));
    const candidates = [...new Set([...candidateNames(asked), ...fromHistory])];

    for (const candidate of candidates) {
      const startedAt = Date.now();
      try {
        // Through executeTool, so this is authorized exactly like a search the model asked for.
        const found = await registry.executeTool(searchTool.name, { search: candidate, limit: 3 }, context);
        const rows = Array.isArray(found?.items) ? found.items : [];
        if (!rows.length) continue;

        /*
         * The search row is a headline; the question usually wants the record.
         *
         * "What is her phone number" against a search result answers "I don't have access to it",
         * which is true of the search row and untrue of the lead. So a single confident match is
         * read in full - several matches are left as headlines, because the right question then is
         * which one they meant.
         */
        const detailTool = rows.length === 1
          ? registry.toolsFor(context).find((tool) => /\.getLead$/.test(tool.name))
          : null;
        if (detailTool && rows[0].enquiryId) {
          const full = await registry.executeTool(detailTool.name, { enquiryId: rows[0].enquiryId }, context)
            .catch(() => null);
          if (full?.found) {
            const { found: _found, lead, remarks, ...rest } = full;
            // The enquiry id comes from the search row: `getLead` returns the lead without it, and
            // it is the one field somebody would want to quote back.
            mentioned.push({
              enquiryId: rows[0].enquiryId,
              ...lead,
              ...rest,
              remarks: (remarks || []).map((remark) => remark.text).join(" | "),
            });
            trace.push({ name: detailTool.name, ms: Date.now() - startedAt, prefetched: true });
            break;
          }
        }

        mentioned.push(...rows);
        trace.push({ name: searchTool.name, ms: Date.now() - startedAt, prefetched: true });
        // One name is what a question normally carries; stop as soon as the database confirms one.
        break;
      } catch (error) {
        trace.push({ name: searchTool.name, ms: Date.now() - startedAt, refused: true, code: error.code || "" });
      }
    }
  }

  /*
   * Rendered one field per line, for the reason every other summary is.
   *
   * A record squeezed into a sentence is a record whose fields get swapped: "Shivani, Interested,
   * Bangalore, Instagram" invites an answer that says she is from Instagram.
   */
  const mentionedBlock = mentioned.length
    ? [
        "",
        mentioned.length === 1
          ? "The record this question is about, read from the database:"
          : `${mentioned.length} records match what was asked:`,
        ...mentioned.map(renderRecord),
        "",
        "Answer about this record and nothing else. A field saying \"none / not set\" means there is",
        "no such information - say so plainly rather than assuming the answer is yes.",
      ].join("\n")
    : "";

  // The rules for these figures live in the system prompt (`FIGURE_RULES`), read once and reused.
  const grounding = summaries.length
    ? ["", "Current figures, already counted for you:", ...summaries, mentionedBlock].filter(Boolean).join("\n")
    : mentionedBlock;

  /*
   * Anything the studio has written that bears on the question.
   *
   * Filtered by module before a single passage is loaded - see `retriever.js`. It never throws:
   * knowledge enriches an answer, and a retrieval failure should cost some context rather than the
   * whole turn.
   */
  // An embedding call costs 50-650ms and answers nothing about "how do I win back a client".
  const passages = intent.needsKnowledge ? await retrieve({ question: asked, context }) : [];

  /*
   * A question about a written process, and no document to answer it from.
   *
   * This is not a question the model may improvise on. Asked for the casual leave policy from a
   * Sales session - where the HR document is correctly invisible - it answered "allows employees to
   * take unpaid leave for personal reasons, subject to company guidelines", which is a policy it
   * made up, phrased exactly like one somebody would act on. An earlier version instead said "we do
   * not have a casual leave policy", which is equally wrong in the other direction.
   *
   * There is no safe way to let a model near this gap, so it is answered here. Told what it does
   * not know, rather than asked to admit it.
   */
  if (intent.needsKnowledge && !passages.length) {
    return {
      answer: "I do not have a document covering that in this module, so I cannot tell you what the "
        + "policy says. Someone with access to that area would know, or it may not be written down yet.",
      trace,
      steps: 0,
    };
  }
  if (passages.length) trace.push({ knowledge: passages.length, titles: [...new Set(passages.map((p) => p.title))] });

  const conversation = withFigures(`${system}\n\n${FIGURE_RULES}`, messages, grounding + renderPassages(passages));
  /*
   * A question with no tools has nothing to wait for, so it streams from the first token.
   *
   * The tool path cannot: a turn that asks for a tool has to come back complete before the tool can
   * run, and streaming a tool call into somebody's panel would show them JSON. So the loop below is
   * used only when tools are in play, and the common case - advice, explanation, a policy answer -
   * goes straight to the reader as it is written.
   */
  if (!tools.length && onToken) {
    const streamed = await provider.streamConversation(
      { messages: conversation, temperature: 0.3, maxTokens, signal },
      onToken,
    );
    return { answer: String(streamed || "").trim(), trace, steps: 0, streamed: true };
  }

  /*
   * Once a tool has run, the answer is prose - so it streams.
   *
   * The tool round itself cannot: a turn that asks for a tool has to arrive complete before the
   * tool can run, and streaming a tool call would put JSON in somebody's panel. But everything after
   * that is the model reading a result and writing a sentence, which is exactly what should appear
   * as it is produced. Without this a data question showed a blank panel for thirteen seconds.
   *
   * The tools are withheld on that final turn, so it has to answer from what it gathered rather than
   * asking for more - which also removes the risk of streaming a tool call by accident.
   */
  let toolsHaveRun = prefetched;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    if (toolsHaveRun && onToken) {
      const streamed = await provider.streamConversation(
        { messages: conversation, temperature: 0.3, maxTokens, signal },
        onToken,
      );
      return { answer: String(streamed || "").trim(), trace, steps: step, streamed: true };
    }

    const message = await provider.completeWithTools({
      messages: conversation,
      // Only offered when there are any: a model given an empty tool list sometimes invents one.
      tools: tools.length ? tools : undefined,
      temperature: 0.3,
      maxTokens,
      signal,
    });

    const calls = collectCalls(message, context);
    if (!calls.length) {
      return { answer: String(message?.content || "").trim(), trace, steps: step };
    }

    // The model's own turn goes back in, or the tool results have nothing to attach to.
    conversation.push({ role: "assistant", content: message.content || "", tool_calls: calls });

    for (const call of calls) {
      const wire = call?.function?.name || "";
      const tool = resolveTool(wire, context);
      const startedAt = Date.now();

      if (!tool) {
        /*
         * A name this session was not offered.
         *
         * Refused as a tool result rather than thrown, so the model can say so in its answer instead
         * of the whole turn failing - and it learns nothing about what exists elsewhere.
         */
        trace.push({ name: wire, ms: 0, refused: true });
        conversation.push({ role: "tool", content: JSON.stringify({ error: "That action is not available in this session." }) });
        continue;
      }

      try {
        // The second authorization check lives in here: module, then permission, then execute.
        const result = await registry.executeTool(tool.name, call.function.arguments || {}, context);
        toolsHaveRun = true;
        trace.push({ name: tool.name, ms: Date.now() - startedAt });
        conversation.push({ role: "tool", content: JSON.stringify(result) });
      } catch (error) {
        trace.push({ name: tool.name, ms: Date.now() - startedAt, refused: true, code: error.code || "" });
        // The reason, never a stack: a tool failing is something the model should explain, not debug.
        conversation.push({
          role: "tool",
          content: JSON.stringify({ error: error.code === "AI_TOOL_FORBIDDEN" || error.code === "AI_TOOL_OUT_OF_SCOPE"
            ? "You do not have access to that."
            : "That lookup failed." }),
        });
      }
    }
  }

  /*
   * Out of steps.
   *
   * One more turn with the tools taken away, so the model has to answer from what it already
   * gathered instead of asking again. Better a summary of an incomplete lookup than a turn that
   * ends with nothing.
   */
  const closing = await provider.completeWithTools({
    messages: [...conversation, {
      role: "user",
      content: "Answer now from what you already have. Do not ask for anything else.",
    }],
    temperature: 0.3,
    maxTokens,
    signal,
  });

  return {
    answer: String(closing?.content || "").trim(),
    trace,
    steps: MAX_TOOL_STEPS,
    exhausted: true,
  };
}

module.exports = { answerWithTools, withFigures, toolsForModel, wireName, resolveTool, collectCalls, MAX_TOOL_STEPS };
