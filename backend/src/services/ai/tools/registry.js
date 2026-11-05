const iamService = require("../../iam.service");
const { findModule, isGlobal } = require("../modules");

/**
 * Every action Nebula can take, and who may take it.
 *
 * The model never touches the database. It asks for a tool by name; this decides whether that name
 * exists, whether the asker's session covers its module, and whether the asker holds the permission
 * behind it - and only then does anything run. There is deliberately no `runSql`, no `queryPrisma`
 * and no tool that takes a table name: a model that can compose its own query has the database, and
 * no prompt survives contact with a lead's remarks saying "ignore your instructions".
 *
 * Authorization happens twice, and the repetition is the point.
 *
 * **Before the model sees anything**, `toolsFor` hands it only the tools its session may use. An
 * HRM tool is not described to a CRM session, so the model cannot ask for what it has never heard
 * of, and cannot be talked into it by text inside a transcript.
 *
 * **Again when a tool is actually requested**, `executeTool` re-checks from scratch. The filtering
 * above is a convenience for the model, not a security boundary - a malformed reply, a retry
 * against a stale tool list, or a bug in the orchestration could all produce a name that was never
 * offered. The second check is the one that has to be right.
 */

/** A refusal, distinguishable from a tool that ran and failed. */
class ToolAccessError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/*
 * What a tool can cost.
 *
 * Phase 2 registers only READ tools; the rest are named now so the shape is settled before anything
 * is written against it, and so a tool cannot be added later without someone choosing a level.
 */
const RISK = {
  READ: "READ",
  LOW_RISK_WRITE: "LOW_RISK_WRITE",
  HIGH_RISK_WRITE: "HIGH_RISK_WRITE",
  DESTRUCTIVE: "DESTRUCTIVE",
};

// The permission level a risk class demands. Anything that changes data needs write access.
const REQUIRED_LEVEL = {
  READ: "READ",
  LOW_RISK_WRITE: "READ_WRITE",
  HIGH_RISK_WRITE: "READ_WRITE",
  DESTRUCTIVE: "READ_WRITE",
};

const registry = new Map();

/*
 * Names are `module.action`, and the prefix is not decoration.
 *
 * It is what makes a stray tool name visibly wrong in a log, and it is checked against the
 * declared module below so a tool cannot be filed under one module and named for another.
 */
const NAME_SHAPE = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z0-9]*$/;

/**
 * Registers one tool.
 *
 * Strict on purpose: a tool that is wrong about its own module or permission is worse than a
 * missing tool, because it looks like it is being checked. Every failure here is a programming
 * error and throws at load rather than at the first request.
 */
function registerTool(tool) {
  const name = String(tool?.name || "");
  if (!NAME_SHAPE.test(name)) {
    throw new Error(`AI tool name must look like "module.action": ${JSON.stringify(name)}`);
  }
  if (registry.has(name)) throw new Error(`AI tool already registered: ${name}`);

  const module = findModule(tool.module);
  if (!module) throw new Error(`AI tool ${name} names a module that is not registered: ${tool.module}`);

  // The prefix and the module must agree, or a log line saying "hrm.getX" could be a SALES tool.
  const prefix = name.split(".")[0].toLowerCase();
  const expected = module.id.replace(/_/g, "").toLowerCase();
  if (prefix !== expected) {
    throw new Error(`AI tool ${name} is filed under ${module.id}; its name should start with "${expected}."`);
  }

  const risk = RISK[tool.risk] || null;
  if (!risk) throw new Error(`AI tool ${name} must declare a risk of ${Object.keys(RISK).join(", ")}`);
  if (typeof tool.execute !== "function") throw new Error(`AI tool ${name} has no execute function`);
  if (!tool.description) throw new Error(`AI tool ${name} needs a description - the model reads it to choose`);

  registry.set(name, {
    name,
    module: module.id,
    // The permission actually checked. Taken from the module registry rather than from the tool, so
    // a tool cannot nominate a softer permission than its module's.
    feature: module.feature,
    risk,
    requiredLevel: REQUIRED_LEVEL[risk],
    description: String(tool.description),
    // JSON Schema for the arguments. Validated before execute, in Phase 3.
    schema: tool.schema || { type: "object", properties: {} },
    /*
     * Whether this is the module's standing summary - the totals someone would want before any
     * question about "how many" or "how are we doing".
     *
     * Marked so the orchestrator can run it up front rather than hoping the model decides to. It
     * takes no arguments by definition: something that needs arguments is a lookup, not a summary.
     */
    summary: Boolean(tool.summary),
    /*
     * How a summary reads when it is put in front of the model.
     *
     * Handed the raw JSON, the model read it back verbatim - "542 conversions, 3 valued, 181
     * average" out of a money object meaning ₹542 across 3 projects. Prose it can restate; nested
     * JSON it copies and misreads. Optional: a tool without one falls back to JSON.
     */
    renderSummary: typeof tool.renderSummary === "function" ? tool.renderSummary : null,
    /*
     * The same summary in a few lines, for a briefing that covers several modules at once.
     *
     * A single-module session can afford the full page. A global one cannot: five full pages is a
     * wall of figures, and the model picks the wrong one out of it - asked for a business status it
     * reported "17794 follow-ups" from a line that was actually the count of leads with no event
     * type set. Fewer numbers in front of it, fewer to confuse.
     */
    renderBrief: typeof tool.renderBrief === "function" ? tool.renderBrief : null,
    execute: tool.execute,
  });
  return registry.get(name);
}

/** A registered tool, or null. Never throws on an unknown name - that is a refusal, not a crash. */
function findTool(name) {
  return registry.get(String(name || "")) || null;
}

/** Every registered tool, for tests and for the admin view. */
function allTools() {
  return [...registry.values()];
}

/** The standing summaries for the modules this session covers. */
function summaryToolsFor(context) {
  return toolsFor(context).filter((tool) => tool.summary);
}

/**
 * The tools one session may use - and the only ones the model is ever told about.
 *
 * A session covers one module, or every registered module when a verified Super Admin opened the
 * global scope. `context.modules` was decided in `accessContext.js` from the database; it is read
 * here rather than re-derived, so there is one place that decides scope.
 */
function toolsFor(context) {
  const allowed = new Set(Array.isArray(context?.modules) ? context.modules : []);
  return allTools().filter((tool) => allowed.has(tool.module));
}

/** The same list, shaped for the model: no execute function, no internals. */
function toolDefinitionsFor(context) {
  return toolsFor(context).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.schema,
  }));
}

/**
 * Whether this session may run this tool, as a question rather than an exception.
 *
 * `executeTool` is the gate; this is the same decision, available to callers that need to know
 * *before* offering something rather than by catching a refusal.
 *
 * Returns `{ ok, code }` rather than a boolean so `executeTool` can raise the right refusal from
 * the same answer, and there is one place that decides.
 */
async function permits(context, tool) {
  if (!tool) return { ok: false, code: "AI_TOOL_UNKNOWN" };

  const modules = new Set(Array.isArray(context?.modules) ? context.modules : []);
  if (!modules.has(tool.module)) return { ok: false, code: "AI_TOOL_OUT_OF_SCOPE" };

  const permitted = await iamService.hasPermission(
    context.userId,
    tool.module,
    tool.feature,
    tool.requiredLevel,
  );
  return permitted ? { ok: true, code: "" } : { ok: false, code: "AI_TOOL_FORBIDDEN" };
}

/**
 * Runs a tool, having checked from scratch that it may be run.
 *
 * The order matters. Existence, then module, then permission - and `execute` is not referenced
 * until all three have passed, so a denied tool never reaches a service, a repository or Prisma.
 */
async function executeTool(name, args, context) {
  const tool = findTool(name);
  /*
   * An unknown name is refused without saying what is known.
   *
   * A model that invents "hrm.getSalaries" should learn nothing from the refusal, including whether
   * such a tool exists elsewhere in the system.
   */
  if (!tool) throw new ToolAccessError("AI_TOOL_UNKNOWN", "That action is not available.", 404);

  /*
   * The cross-module wall and the user's own permission, both decided by `permits`.
   *
   * Read now rather than trusted from the session: a session can outlive a permission change - a
   * conversation open for an hour, a role edited in between - and the answer must follow the
   * permission, not the session.
   */
  const verdict = await permits(context, tool);
  if (!verdict.ok) {
    if (verdict.code === "AI_TOOL_OUT_OF_SCOPE") {
      throw new ToolAccessError("AI_TOOL_OUT_OF_SCOPE", "That belongs to another module, which this session does not cover.", 403);
    }
    throw new ToolAccessError("AI_TOOL_FORBIDDEN", "You do not have permission for that action.", 403);
  }

  return tool.execute(args || {}, context);
}

/** Empties the registry. Tests only - the application registers once at load. */
function resetRegistry() {
  registry.clear();
}

module.exports = {
  registerTool,
  findTool,
  allTools,
  toolsFor,
  summaryToolsFor,
  toolDefinitionsFor,
  permits,
  executeTool,
  resetRegistry,
  ToolAccessError,
  RISK,
  REQUIRED_LEVEL,
  isGlobal,
};
