const test = require("node:test");
const assert = require("node:assert");
const registry = require("../src/services/ai/tools/registry");
const { collectCalls, resolveTool, wireName, toolsForModel } = require("../src/services/ai/orchestrator");

/**
 * Reading a tool call out of a reply, and refusing one that was never offered.
 *
 * The fallback these cover exists because `qwen3:1.7b` will not reliably use Ollama's native
 * `tool_calls` once a real system prompt is in front of it - it writes the call into the message
 * body instead. Accepting a written call is a concession to the model; it must not become a way
 * around the boundary, which is what most of this file checks.
 */

const salesContext = { userId: 1, modules: ["SALES"] };

test.beforeEach(() => {
  registry.resetRegistry();
  registry.registerTool({
    name: "sales.getPipeline", module: "SALES", risk: "READ",
    description: "CRM totals, counted in the database", execute: async () => ({ ok: true }),
  });
  registry.registerTool({
    name: "hrm.getEmployees", module: "HRM", risk: "READ",
    description: "Employees, for the HRM module only", execute: async () => ({ ok: true }),
  });
});
test.after(() => registry.resetRegistry());

test("a dot cannot travel on the wire, so it is translated", () => {
  // Ollama rejects a dot in a tool name.
  assert.strictEqual(wireName("sales.getPipeline"), "sales_getPipeline");
  assert.strictEqual(toolsForModel(salesContext)[0].function.name, "sales_getPipeline");
});

test("a native tool call is used as-is", () => {
  const calls = collectCalls({ tool_calls: [{ function: { name: "sales_getPipeline", arguments: {} } }] }, salesContext);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].function.name, "sales_getPipeline");
});

test("a call written into the message body is read as a call", () => {
  // Both shapes the model actually produces.
  const asJson = collectCalls({ content: '{"name": "sales_getPipeline", "arguments": {"limit": 20}}' }, salesContext);
  assert.strictEqual(asJson[0].function.name, "sales_getPipeline");
  assert.deepStrictEqual(asJson[0].function.arguments, { limit: 20 });

  const fenced = collectCalls({ content: '```json\n{"name": "sales_getPipeline"}\n```' }, salesContext);
  assert.strictEqual(fenced[0].function.name, "sales_getPipeline");

  const bare = collectCalls({ content: "sales_getPipeline" }, salesContext);
  assert.strictEqual(bare[0].function.name, "sales_getPipeline");
});

test("a written call cannot reach a module this session does not cover", () => {
  /*
   * The concession must not become a hole. A SALES session that writes an HRM tool name gets
   * nothing back - the name is resolved only against what this session was offered.
   */
  for (const content of [
    "hrm_getEmployees",
    '{"name": "hrm_getEmployees", "arguments": {}}',
    '{"name": "sales_runSql", "arguments": {"sql": "SELECT * FROM user"}}',
  ]) {
    assert.deepStrictEqual(collectCalls({ content }, salesContext), [], content);
  }
});

test("an ordinary answer is never mistaken for a call", () => {
  for (const content of [
    "There are 17 overdue follow-ups.",
    "{ this is not json",
    '{"leads": 31071}',
    "Call her this evening.",
    "",
  ]) {
    assert.deepStrictEqual(collectCalls({ content }, salesContext), [], JSON.stringify(content));
  }
});

test("a long reply is an answer, not a call", () => {
  // A real answer can be any length; a tool call is short. The cap stops a paragraph that happens
  // to mention a tool name from being executed.
  const long = `sales_getPipeline ${"and then a great deal more prose ".repeat(20)}`;
  assert.deepStrictEqual(collectCalls({ content: long }, salesContext), []);
});

test("a tool is resolved only from what the session was offered", () => {
  assert.ok(resolveTool("sales_getPipeline", salesContext));
  assert.strictEqual(resolveTool("hrm_getEmployees", salesContext), null);

  // The same name, from a session that does cover HRM.
  assert.ok(resolveTool("hrm_getEmployees", { userId: 1, modules: ["HRM"] }));
});

test("a session with no tools is offered none", () => {
  assert.deepStrictEqual(toolsForModel({ modules: ["ACCOUNTS"] }), []);
  assert.deepStrictEqual(collectCalls({ content: "sales_getPipeline" }, { modules: ["ACCOUNTS"] }), []);
});

test("a module's standing summary is fetched before the model can invent one", async () => {
  /*
   * The defect this prevents, verbatim: asked for a business status, the assistant answered
   * "15 leads in progress, 3 overdue, 7 follow-ups, 2 new today" having called nothing. The real
   * figures were 31,071 and 17. It calls tools readily for a pointed question and not at all for a
   * broad one, so deciding to look something up is taken away for summaries.
   */
  const { answerWithTools } = require("../src/services/ai/orchestrator");
  const provider = require("../src/services/ai/provider");
  const iamService = require("../src/services/iam.service");

  registry.resetRegistry();
  let summaryRan = 0;
  registry.registerTool({
    name: "sales.getPipeline",
    module: "SALES",
    risk: "READ",
    summary: true,
    description: "CRM totals, counted in the database",
    renderSummary: (result) => `Leads: ${result.leads}\nOverdue: ${result.overdue}`,
    execute: async () => { summaryRan += 1; return { leads: 31071, overdue: 17 }; },
  });

  const realPermission = iamService.hasPermission;
  const realComplete = provider.completeWithTools;
  iamService.hasPermission = async () => true;

  let systemSeen = "";
  let questionSeen = "";
  provider.completeWithTools = async ({ messages }) => {
    systemSeen = messages.find((m) => m.role === "system")?.content || "";
    questionSeen = messages[messages.length - 1]?.content || "";
    return { content: "There are 17 overdue follow-ups." };
  };

  try {
    const result = await answerWithTools({
      system: "You are DBS AI.",
      messages: [{ role: "user", content: "How many leads are overdue?" }],
      context: { userId: 1, modules: ["SALES"] },
    });

    assert.strictEqual(summaryRan, 1, "the summary should run once, before the model");
    assert.ok(result.trace.some((t) => t.name === "sales.getPipeline" && t.prefetched));

    // The real figures are in front of the model before it writes a word - beside the question.
    assert.match(questionSeen, /Leads: 31071/);
    assert.match(questionSeen, /Overdue: 17/);
    assert.match(questionSeen, /How many leads are overdue\?$/);
    // Not in the system message: that stays the same from question to question, so Ollama reuses it.
    assert.ok(!/Leads:/.test(systemSeen), "the figures went into the system message");
    // Prose, not JSON - handed raw JSON it read a money object back as a count.
    assert.ok(!questionSeen.includes('{"leads"'), "the summary went in as JSON");
  } finally {
    iamService.hasPermission = realPermission;
    provider.completeWithTools = realComplete;
    registry.resetRegistry();
  }
});

test("a summary that cannot be read leaves the turn working", async () => {
  const { answerWithTools } = require("../src/services/ai/orchestrator");
  const provider = require("../src/services/ai/provider");
  const iamService = require("../src/services/iam.service");

  registry.resetRegistry();
  registry.registerTool({
    name: "sales.getPipeline", module: "SALES", risk: "READ", summary: true,
    description: "CRM totals, counted in the database",
    execute: async () => { throw new Error("database unavailable"); },
  });

  const realPermission = iamService.hasPermission;
  const realComplete = provider.completeWithTools;
  iamService.hasPermission = async () => true;
  provider.completeWithTools = async () => ({ content: "I could not read the figures just now." });

  try {
    // An absent summary must not take the answer down with it.
    const result = await answerWithTools({
      system: "You are DBS AI.",
      messages: [{ role: "user", content: "How many leads are overdue?" }],
      context: { userId: 1, modules: ["SALES"] },
    });
    assert.ok(result.answer.length > 0);
    assert.ok(result.trace.some((t) => t.refused));
  } finally {
    iamService.hasPermission = realPermission;
    provider.completeWithTools = realComplete;
    registry.resetRegistry();
  }
});

test("a question that needs no records fetches no summary and no knowledge", async () => {
  /*
   * The change that made general questions fast and relevant. Every turn used to fetch the module
   * summaries and run a retrieval - 885ms measured on "give me ideas to improve wedding photography
   * sales", which needs neither - and the CRM summary then sat in front of the model while it
   * answered, which is why advice came back business-flavoured and slightly beside the point.
   */
  const { answerWithTools } = require("../src/services/ai/orchestrator");
  const provider = require("../src/services/ai/provider");
  const iamService = require("../src/services/iam.service");

  registry.resetRegistry();
  let summaryRan = 0;
  registry.registerTool({
    name: "sales.getPipeline", module: "SALES", risk: "READ", summary: true,
    description: "CRM totals, counted in the database",
    execute: async () => { summaryRan += 1; return { leads: 1 }; },
  });

  const realPermission = iamService.hasPermission;
  const realStream = provider.streamConversation;
  iamService.hasPermission = async () => true;

  let systemSeen = "";
  provider.streamConversation = async ({ messages }, onToken) => {
    // Everything the model is handed, wherever in the conversation it sits.
    systemSeen = messages.map((m) => m.content).join(" ");
    onToken?.("Focus on the album.");
    return "Focus on the album.";
  };

  try {
    const result = await answerWithTools({
      system: "You are Nebula.",
      messages: [{ role: "user", content: "Give me ideas to improve wedding photography sales." }],
      context: { userId: 1, modules: ["SALES"] },
      onToken: () => {},
    });

    assert.strictEqual(summaryRan, 0, "a summary was fetched for a question about ideas");
    assert.strictEqual(result.trace[0].intent, "GENERAL");
    // And the pipeline is not in front of the model while it brainstorms.
    assert.ok(!/Leads:/.test(systemSeen), "the CRM summary reached a general question");
    // It streams, which is the other half of why this path is fast.
    assert.strictEqual(result.streamed, true);
  } finally {
    iamService.hasPermission = realPermission;
    provider.streamConversation = realStream;
    registry.resetRegistry();
  }
});

test("a question about a written process with no document is answered, never improvised", async () => {
  /*
   * Asked for the casual leave policy from a Sales session - where the HR document is correctly
   * invisible - it answered "allows employees to take unpaid leave for personal reasons, subject to
   * company guidelines". A policy it made up, phrased exactly like one somebody would act on.
   */
  const { answerWithTools } = require("../src/services/ai/orchestrator");
  const provider = require("../src/services/ai/provider");

  const realStream = provider.streamConversation;
  let modelCalled = false;
  provider.streamConversation = async () => { modelCalled = true; return "made up"; };

  try {
    const result = await answerWithTools({
      system: "You are Nebula.",
      messages: [{ role: "user", content: "What is our casual leave policy?" }],
      // No documents reachable from this session.
      context: { userId: 1, modules: ["SALES"] },
      onToken: () => {},
    });

    assert.strictEqual(modelCalled, false, "the model was allowed near a gap it cannot fill");
    assert.match(result.answer, /do not have a document/i);
    // And it does not claim the policy is absent, only that it cannot see one.
    assert.ok(!/no .*policy exists|there is no policy/i.test(result.answer));
  } finally {
    provider.streamConversation = realStream;
  }
});

test("the figures sit beside the question, so the system prompt and the history are the same as last time", () => {
  const { withFigures } = require("../src/services/ai/orchestrator");
  const history = [{ role: "user", content: "Any leave requests?" }, { role: "assistant", content: "Six." }];
  const first = withFigures("You are Nebula.", [...history, { role: "user", content: "Which is oldest?" }], "Requests found: 6");
  const second = withFigures("You are Nebula.", [...history, { role: "user", content: "And the newest?" }], "Requests found: 7");
  // Everything before the new question is identical - what Ollama can reuse instead of re-reading.
  assert.deepStrictEqual(first.slice(0, -1), second.slice(0, -1));
  assert.deepStrictEqual(first[0], { role: "system", content: "You are Nebula." });
  assert.strictEqual(first.at(-1).role, "user");
  assert.match(first.at(-1).content, /^Requests found: 6\n\nThe question: Which is oldest\?$/);
  // Nothing to add: the conversation goes as it came.
  assert.deepStrictEqual(withFigures("You are Nebula.", history.slice(0, 1), ""), [{ role: "system", content: "You are Nebula." }, history[0]]);
});
