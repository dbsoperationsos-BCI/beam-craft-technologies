const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Nebula's workflow, held in one place:
 *
 *   1. The user asks a question.
 *   2. qwen3:8b understands it.
 *   3. Node checks RBAC - the module's permission, then the record-level scope.
 *   4. A read-only MySQL lookup fetches only the records that person may see.
 *   5. The assistant answers, summarises and explains - it never changes anything.
 *
 * The lead lookups are exercised against stand-ins for the CRM service and the data scope, so this
 * needs no database: what matters is that a lead the board would hide is never read, and that the
 * search carries the scope into its SQL.
 */

const src = (...parts) => path.join(__dirname, "..", "src", ...parts);
const read = (...parts) => fs.readFileSync(src(...parts), "utf8");

// Stand-ins, installed before the tools load them.
const LEADS = {
  "ENQ-IN": { lead: { enquiryId: "ENQ-IN", name: "In Scope", vertical: "Dum Dum", branchId: 1 }, details: { remarkEntries: [] } },
  "ENQ-OUT": { lead: { enquiryId: "ENQ-OUT", name: "Other Branch", vertical: "Dum Dum", branchId: 2 }, details: { remarkEntries: [] } },
};
const read_calls = [];
const stub = (relative, exports) => {
  const file = require.resolve(src(...relative.split("/")));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("modules/sales/crm-leads/crmLeadService.js", { getCrmLeadById: async (id) => LEADS[id] || null });
stub("modules/sales/crm-leads/activityService.js", { listLeadActivity: async (id) => { read_calls.push(["activity", id]); return []; } });
stub("modules/sales/crm-leads/callLogService.js", { listLeadCallLogs: async (id) => { read_calls.push(["calls", id]); return []; } });
stub("modules/sales/call-transcripts/repository.js", {
  listForLead: async (id) => { read_calls.push(["transcripts", id]); return []; },
  findById: async (id) => ({ "T-OUT": { id, enquiryId: "ENQ-OUT", fullText: "a call" }, "T-NONE": { id, enquiryId: null, fullText: "a call" } })[id] || null,
});
// What the lead assistant would hand the model - recorded, so a refusal can be shown to reach none of it.
const answered = [];
stub("services/ai/crmAssistant.js", {
  askAboutLead: async ({ enquiryId }) => { answered.push(["ask", enquiryId]); return { answer: "ok" }; },
  streamAboutLead: async ({ enquiryId }) => { answered.push(["stream", enquiryId]); return { answer: "ok", basedOn: {} }; },
});
stub("services/ai/leadAnalyzer.js", { analyzeLead: async (id) => { answered.push(["analyze", id]); return {}; } });
stub("services/ai/conversationAnalyzer.js", { analyzeConversation: async (id) => { answered.push(["summary", id]); return {}; } });
stub("services/ai/callAnalyzer.js", { analyzeCall: async () => { answered.push(["call"]); return {}; } });
stub("services/ai/crmAnalyst.js", { askAboutCrm: async () => ({}), streamAboutCrm: async () => ({}) });

const dataScope = require("../src/services/dataScope.service");
// This person's grant reaches branch 1 only.
dataScope.resolve = async () => ({
  allows: (lead) => lead.branchId === 1,
  sql: () => ({ clause: "(`branch_id` IN (?))", params: [1] }),
});
const prisma = require("../src/config/db");
let lastQuery = null;
prisma.$queryRawUnsafe = async (sql, ...params) => { lastQuery = { sql, params }; return []; };

const { TOOLS } = require("../src/services/ai/tools/sales");
const tool = (name) => TOOLS.find((entry) => entry.name === name);
const session = { userId: 7, vertical: "Dum Dum" };

test("2 - qwen3:8b is the model that understands the question", () => {
  delete process.env.OLLAMA_MODEL;
  const { config } = require("../src/services/ai/ollamaClient");
  assert.equal(config().model, "qwen3:8b");
});

test("3 - a lead outside the person's scope is not found, and nothing of it is read", async () => {
  assert.deepEqual(await tool("sales.getLead").execute({ enquiryId: "ENQ-OUT" }, session), { found: false });
  assert.equal((await tool("sales.getLead").execute({ enquiryId: "ENQ-IN" }, session)).found, true);
  for (const name of ["sales.getLeadActivity", "sales.getCallLogs", "sales.getCallTranscripts"]) {
    read_calls.length = 0;
    assert.deepEqual(await tool(name).execute({ enquiryId: "ENQ-OUT" }, session), { found: false }, name);
    assert.deepEqual(read_calls, [], `${name} read a lead it may not show`);
    await tool(name).execute({ enquiryId: "ENQ-IN" }, session);
    assert.equal(read_calls.length, 1, `${name} did not read a lead it may show`);
  }
  // Another vertical than the board on screen is out of reach the same way.
  assert.deepEqual(await tool("sales.getLead").execute({ enquiryId: "ENQ-IN" }, { userId: 7, vertical: "Qua Qua" }), { found: false });
});

test("4 - the search is one read-only query, narrowed to what the person may see", async () => {
  await tool("sales.searchLeads").execute({ search: "Priya" }, session);
  assert.match(lastQuery.sql, /^\s*SELECT /);
  assert.match(lastQuery.sql, /\(`branch_id` IN \(\?\)\)/, "the record scope is in the SQL");
  assert.ok(lastQuery.params.includes(1));
  assert.match(lastQuery.sql, /LIMIT \d+/);
});

test("4 - no tool can write: none of them holds a write call", () => {
  const dir = src("services", "ai", "tools");
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js") && name !== "registry.js")) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    // A model's write is `prisma.<model>.<write>(` - two steps deep; a Map's own `.delete(` (the
    // register cache) is not a database write.
    assert.doesNotMatch(source, /\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|`?\w+`?\s+SET)/, file);
  }
});

test("5 - answers only: no confirm step, no proposals, no action plans", () => {
  assert.equal(fs.existsSync(src("services", "ai", "actions.js")), false);
  assert.doesNotMatch(read("modules", "ai", "routes.js"), /confirm/);
  assert.doesNotMatch(read("services", "ai", "orchestrator.js"), /proposals|planAction/);
  assert.doesNotMatch(read("server.js"), /sweepExpired/);
});

test("the lead assistant follows the same workflow: READ, the lead's scope, limits, the switch", () => {
  const routes = read("modules", "sales", "crm-ai", "routes.js");
  assert.match(routes, /router\.use\(checkPermission\("SALES", "CRM Leads", "READ"\)\);/);
  assert.ok(!routes.includes("requireModule("), "a POST question is not a write");
  const controller = read("modules", "sales", "crm-ai", "controller.js");
  // Every handler about one lead is admitted (switch + the lead's scope); the CRM-wide ones check the
  // switch and narrow by the scope in their query; all run under the limits.
  const own = (handler) => {
    const body = controller.slice(controller.indexOf(`async function ${handler}(`));
    const next = body.indexOf("\nasync function ", 10);
    return next === -1 ? body : body.slice(0, next);
  };
  for (const handler of ["analyzeLeadHandler", "analyzeCallHandler", "summarizeHandler", "chatHandler", "chatStreamHandler"]) {
    assert.match(own(handler), /await admitted\(req, res,/, `${handler} is not admitted`);
  }
  for (const handler of ["crmChatHandler", "crmChatStreamHandler"]) assert.match(own(handler), /switchedOn\(res\)/, handler);
  for (const handler of ["analyzeLeadHandler", "analyzeCallHandler", "summarizeHandler", "chatHandler", "chatStreamHandler", "crmChatHandler", "crmChatStreamHandler"]) {
    assert.match(own(handler), /await limited\(req, \(\) =>/, `${handler} is not under the limits`);
  }
  assert.match(controller, /if \(provider\.enabled\(\)\) return true;/);
  assert.match(controller, /return Boolean\(record && scope\.allows\(record\.lead \|\| \{\}\)\);/);
});

// The lead assistant's handlers, run - against the stand-ins above.
const fakeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader() {}, flushHeaders() {}, write() {}, end() {}, on() {}, writableFinished: true,
});
const ask = (body) => ({ body, user: { id: 7 } });
const crmAi = () => require("../src/modules/sales/crm-ai/controller");

test("the lead assistant reads only a lead the person may see - and no lead named is refused", async () => {
  answered.length = 0;
  let res = fakeRes();
  await crmAi().chat(ask({ enquiryId: "ENQ-OUT", question: "Summarise this lead" }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "That lead was not found.");

  res = fakeRes();
  await crmAi().chatStream(ask({ enquiryId: "ENQ-OUT", question: "Summarise this lead" }), res);
  assert.equal(res.statusCode, 404, "refused before the stream opens");

  res = fakeRes();
  await crmAi().chat(ask({ question: "Summarise this lead" }), res);
  assert.equal(res.statusCode, 400, "fails closed when no lead is named");
  assert.deepEqual(answered, [], "nothing out of reach reached the model");

  res = fakeRes();
  await crmAi().chat(ask({ enquiryId: "ENQ-IN", question: "Summarise this lead" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(answered, [["ask", "ENQ-IN"]]);
});

test("a transcript is its lead's: out of reach, or tied to no lead, it is simply not there", async () => {
  answered.length = 0;
  for (const transcriptId of ["T-OUT", "T-NONE", "T-MISSING"]) {
    const res = fakeRes();
    await crmAi().analyzeCall(ask({ transcriptId }), res);
    assert.equal(res.statusCode, 404, transcriptId);
    // One answer for all three, so an id says nothing about what exists in somebody else's scope.
    assert.equal(res.body.message, "That transcript no longer exists.", transcriptId);
  }
  assert.deepEqual(answered, []);
});

test("switched off, the lead assistant answers nothing", async () => {
  process.env.AI_ENABLED = "false";
  try {
    const res = fakeRes();
    await crmAi().chat(ask({ enquiryId: "ENQ-IN", question: "Summarise this lead" }), res);
    assert.equal(res.statusCode, 503);
  } finally {
    delete process.env.AI_ENABLED;
  }
});

test("a reader who leaves stops the generation: both streams hand the model a cancel", () => {
  assert.match(read("services", "ai", "ollamaClient.js"), /return cancel \? AbortSignal\.any\(\[timeout, cancel\]\) : timeout;/);
  assert.match(read("modules", "ai", "controller.js"), /signal: cancelOnDisconnect\(res\),/);
  assert.match(read("modules", "sales", "crm-ai", "controller.js"), /signal: cancelOnDisconnect\(res\),/);
});
