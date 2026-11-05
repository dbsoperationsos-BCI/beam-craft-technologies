const test = require("node:test");
const assert = require("node:assert");
const prisma = require("../src/config/db");
const registry = require("../src/services/ai/tools/registry");
const actions = require("../src/services/ai/actions");
const iamService = require("../src/services/iam.service");

/**
 * Consent for anything the assistant would change.
 *
 * The rule: a conversation saying "yes, do it" is not consent. A model cannot tell an instruction
 * from a client's words quoted back at it, so confirmation is a token issued server-side and
 * nothing runs without it.
 *
 * Against the real database, like the conversation tests, because the guarantees now live in a
 * `where` clause and a conditional UPDATE. A stubbed Prisma would be testing the stub - and
 * single-use in particular is a claim about what MySQL does when two requests race, which cannot be
 * demonstrated against a fake.
 *
 * Only rows created here are touched, and they are removed afterwards.
 */

let ran = [];
let userId;
let context;

test.before(async () => {
  const user = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(user, "a user is needed to own a plan");
  userId = user.id;
  context = { userId, scope: "SALES", modules: ["SALES"], userName: "Test" };
});

test.beforeEach(async () => {
  registry.resetRegistry();
  ran = [];
  registry.registerTool({
    name: "sales.addRemark", module: "SALES", risk: "LOW_RISK_WRITE",
    description: "Add a note to a lead's remarks, after confirmation",
    execute: async (args) => { ran.push(args); return { added: true }; },
  });
  registry.registerTool({
    name: "sales.wipeLead", module: "SALES", risk: "DESTRUCTIVE",
    description: "Remove a lead entirely",
    execute: async () => { ran.push("wiped"); return { gone: true }; },
  });
  iamService.hasPermission = async () => true;
  await prisma.aiActionPlan.deleteMany({ where: { userId } });
});

test.after(async () => {
  registry.resetRegistry();
  if (userId) await prisma.aiActionPlan.deleteMany({ where: { userId } });
});

test("a plan does not run anything by itself", async () => {
  const plan = await actions.planAction({
    tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "Called" }, context, summary: "Add a note",
  });
  assert.ok(plan.token, "a token is issued");
  assert.deepStrictEqual(ran, [], "nothing should have run yet");
});

test("the token, and only the token, carries it out", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "Called" }, context });
  await actions.confirmAction({ token: plan.token, context });
  assert.deepStrictEqual(ran, [{ enquiryId: "DBS-1", text: "Called" }]);
});

test("a token is single-use", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "Called" }, context });
  await actions.confirmAction({ token: plan.token, context });

  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
  assert.strictEqual(ran.length, 1, "a replayed token must not run the action twice");
});

test("two concurrent confirms of one token run it once", async () => {
  /*
   * The reason plans moved from a map to a table. Claiming is a conditional UPDATE, so MySQL lets
   * exactly one of these win; deleting from a map was single-use only within one process.
   */
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "Twice?" }, context });

  const results = await Promise.allSettled([
    actions.confirmAction({ token: plan.token, context }),
    actions.confirmAction({ token: plan.token, context }),
  ]);

  assert.strictEqual(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.strictEqual(ran.length, 1, "the action must run exactly once");
});

test("an invented token is refused", async () => {
  await assert.rejects(
    () => actions.confirmAction({ token: "not-a-real-token", context }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
});

test("a token belongs to the person and the module that made it", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });

  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context: { ...context, userId: userId + 9999 } }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context: { ...context, scope: "HRM", modules: ["HRM"] } }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
  assert.deepStrictEqual(ran, []);
});

test("the token itself is never stored", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });
  const rows = await prisma.aiActionPlan.findMany({ where: { userId } });
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].tokenHash, plan.token, "the raw token must not be the stored value");
  assert.match(rows[0].tokenHash, /^[a-f0-9]{64}$/, "a sha256 digest is stored instead");
});

test("an expired plan is refused", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });
  // Aged past its expiry rather than waiting five minutes for it.
  await prisma.aiActionPlan.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
  assert.deepStrictEqual(ran, []);
});

test("plans are short-lived, and high-risk ones shorter still", () => {
  assert.ok(actions.PLAN_TTL_MS <= 15 * 60 * 1000, "plans should be short-lived");
  assert.ok(actions.HIGH_RISK_TTL_MS < actions.PLAN_TTL_MS, "a high-risk token should sit around for less time");
});

test("permission is checked again at execution, not at planning", async () => {
  /*
   * Permissions can change between the card appearing and the button being pressed. The action must
   * follow the permission as it is when it runs.
   */
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });
  iamService.hasPermission = async () => false;

  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context }),
    (error) => error.code === "AI_TOOL_FORBIDDEN",
  );
  assert.deepStrictEqual(ran, [], "it ran without permission");
});

test("a refused action is not left retryable", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });
  iamService.hasPermission = async () => false;
  await assert.rejects(() => actions.confirmAction({ token: plan.token, context }));

  // Even once permission returns, the spent token stays spent.
  iamService.hasPermission = async () => true;
  await assert.rejects(
    () => actions.confirmAction({ token: plan.token, context }),
    (error) => error.code === "AI_ACTION_EXPIRED",
  );
  assert.deepStrictEqual(ran, []);
});

test("arguments are cleared once the action has landed", async () => {
  const plan = await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "Private note" }, context });
  await actions.confirmAction({ token: plan.token, context });

  const row = await prisma.aiActionPlan.findFirst({ where: { userId } });
  assert.strictEqual(row.status, "CONFIRMED");
  assert.strictEqual(row.args, null, "business data must not persist in a second table");
});

test("nothing may propose a destructive change", async () => {
  await assert.rejects(
    () => actions.planAction({ tool: "sales.wipeLead", args: {}, context }),
    (error) => error.code === "AI_ACTION_REFUSED",
  );
  assert.strictEqual(await prisma.aiActionPlan.count({ where: { userId } }), 0);
});

test("a plan for an unregistered tool is refused at planning", async () => {
  await assert.rejects(
    () => actions.planAction({ tool: "sales.deleteEverything", args: {}, context }),
    (error) => error.code === "AI_TOOL_UNKNOWN",
  );
});

test("expired plans are swept without losing the fact they were proposed", async () => {
  await actions.planAction({ tool: "sales.addRemark", args: { enquiryId: "DBS-1", text: "x" }, context });
  await prisma.aiActionPlan.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

  await actions.sweepExpired();

  const row = await prisma.aiActionPlan.findFirst({ where: { userId } });
  assert.strictEqual(row.status, "CANCELLED", "a proposal nobody acted on stays answerable");
  assert.strictEqual(row.args, null);
});
