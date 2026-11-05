const test = require("node:test");
const assert = require("node:assert");
const registry = require("../src/services/ai/tools/registry");

/**
 * What the registry refuses to accept.
 *
 * A tool that is wrong about its own module or permission is worse than a missing tool, because it
 * looks like it is being checked. Every case here throws at load rather than at the first request,
 * so a mistake surfaces when the server starts and not when a user asks a question.
 */

const valid = {
  name: "sales.getLeads",
  module: "SALES",
  risk: "READ",
  description: "Search leads",
  execute: async () => ({}),
};

test.beforeEach(() => registry.resetRegistry());
test.after(() => registry.resetRegistry());

test("a tool takes its permission from its module, not from itself", () => {
  // Otherwise a tool could nominate a softer permission than the module it reads from.
  const tool = registry.registerTool({ ...valid, feature: "Something Weaker", permission: "none" });
  assert.strictEqual(tool.module, "SALES");
  assert.strictEqual(tool.feature, "CRM Leads");
  assert.strictEqual(tool.requiredLevel, "READ");
});

test("a write tool requires write permission", () => {
  const low = registry.registerTool({ ...valid, name: "sales.addRemark", risk: "LOW_RISK_WRITE" });
  assert.strictEqual(low.requiredLevel, "READ_WRITE");

  const bulk = registry.registerTool({ ...valid, name: "sales.reassignLeads", risk: "HIGH_RISK_WRITE" });
  assert.strictEqual(bulk.requiredLevel, "READ_WRITE");
});

test("a tool's name must match the module it is filed under", () => {
  // So a log line reading "hrm.getX" can never be a SALES tool.
  assert.throws(() => registry.registerTool({ ...valid, name: "hrm.getLeads" }), /should start with/);
});

test("a tool cannot name a module that does not exist", () => {
  for (const module of ["TECHNICAL", "CRM", "IMAGESELECTION", "GLOBAL", ""]) {
    assert.throws(
      () => registry.registerTool({ ...valid, name: "sales.thing", module }),
      /not registered/,
      module,
    );
  }
});

test("a tool must declare what it can cost", () => {
  assert.throws(() => registry.registerTool({ ...valid, risk: undefined }), /risk/);
  assert.throws(() => registry.registerTool({ ...valid, risk: "MEDIUM" }), /risk/);
});

test("a tool must be usable and describable", () => {
  assert.throws(() => registry.registerTool({ ...valid, execute: undefined }), /execute/);
  // The model reads the description to choose; without one it is choosing blind.
  assert.throws(() => registry.registerTool({ ...valid, description: "" }), /description/);
});

test("names must look like module.action, and cannot be reused", () => {
  for (const name of ["getLeads", "sales.", ".getLeads", "SALES.getLeads", "sales..get", "sales get"]) {
    assert.throws(() => registry.registerTool({ ...valid, name }), /module\.action/, name);
  }
  registry.registerTool(valid);
  assert.throws(() => registry.registerTool(valid), /already registered/);
});

test("no tool that runs arbitrary queries is registered", () => {
  /*
   * The rule the whole design rests on: the model asks for business actions, never for queries. A
   * tool taking SQL, a table name or a Prisma call would hand it the database, and no system prompt
   * survives contact with a lead's remarks saying "ignore your instructions".
   */
  const banned = /(sql|prisma|query|rawQuery|execute[A-Z]|database|table)/i;
  for (const tool of registry.allTools()) {
    assert.ok(!banned.test(tool.name), `${tool.name} looks like a general query tool`);
  }
});

test("definitions handed to the model carry no internals", () => {
  registry.registerTool(valid);
  const [definition] = registry.toolDefinitionsFor({ modules: ["SALES"] });

  assert.deepStrictEqual(Object.keys(definition).sort(), ["description", "name", "parameters"]);
  // Never the function, the permission or the risk class.
  assert.strictEqual(definition.execute, undefined);
  assert.strictEqual(definition.requiredLevel, undefined);
});

test("a context with no modules is offered nothing", () => {
  registry.registerTool(valid);
  for (const context of [{}, { modules: [] }, { modules: null }, null]) {
    assert.deepStrictEqual(registry.toolsFor(context), []);
  }
});
