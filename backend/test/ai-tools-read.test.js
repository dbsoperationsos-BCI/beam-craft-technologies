const test = require("node:test");
const assert = require("node:assert");
const registry = require("../src/services/ai/tools/registry");
const { registerAllTools } = require("../src/services/ai/tools");
const { boundedLimit, summariseLead } = require("../src/services/ai/tools/sales");
const iamService = require("../src/services/iam.service");

/**
 * The read-only tools, and the limits that keep them safe to hand a model.
 *
 * Two failures matter more than any feature here. A tool that returns a whole row puts seventy
 * columns of somebody's details into a prompt for a question about a follow-up date; and a tool with
 * no ceiling puts thirty-one thousand rows there.
 */

test.before(() => { registry.resetRegistry(); registerAllTools(); });
test.after(() => registry.resetRegistry());

test("every registered module has tools, through a service rather than a fresh query", () => {
  /*
   * This began as the opposite assertion: HRM, ASSET and ACCOUNTS had no tools, because their read
   * logic lived inside Express handlers taking req and res and nothing else could call it. They now
   * have `read.service.js` files - the same queries as functions - so a tool reuses the module's own
   * logic instead of a second copy invented for the assistant.
   *
   * The services are additive: each controller still holds its own copy and is owed a follow-up to
   * call the service instead. That duplication is deliberate and reviewed, not overlooked.
   */
  const byModule = {};
  for (const tool of registry.allTools()) (byModule[tool.module] ||= []).push(tool.name);

  for (const module of ["SALES", "IMAGE_SELECTION", "HRM", "ACCOUNTS", "ASSET"]) {
    assert.ok(byModule[module]?.length, `${module} should have tools`);
  }

  // Still absent, and still for the same reasons: no permission, and no module.
  assert.strictEqual(byModule.TECHNICAL, undefined);
  assert.strictEqual(byModule.ADMIN, undefined);
});

test("every tool only reads - Nebula answers, it never changes a record", () => {
  for (const tool of registry.allTools()) {
    assert.strictEqual(tool.risk, "READ", `${tool.name} is ${tool.risk}`);
    assert.strictEqual(tool.requiredLevel, "READ", tool.name);
  }
  assert.ok(!registry.allTools().some((tool) => tool.name === "sales.addRemark"), "the one write tool is gone");
});

test("no tool can be talked into an unbounded result", () => {
  // Whatever the model asks for - a huge number, a negative, a string, nothing at all.
  for (const asked of [99999, 1e9, -5, 0, "all", null, undefined, NaN, Infinity]) {
    const limit = boundedLimit(asked);
    assert.ok(limit >= 1 && limit <= 50, `${asked} became ${limit}`);
  }
  // A tool may lower its own ceiling but never raise it.
  assert.strictEqual(boundedLimit(99999, 10), 10);
});

test("a lead summary carries what the assistant needs and nothing else", () => {
  const row = {
    enquiry_id: "DBS-1", name: "Priya", status: "Interested", vertical: "Dum Dum", crm: "Diya",
    // Everything below is on the real row and must not come back.
    phone: "9876543210", groom_contact: "9000000000", bride_contact: "9111111111",
    official_email_id: "a@b.com", remarks: "pasted password hunter2", custom_fields: "{}",
    account_number: "123456789", company_website: "x.com",
  };
  const summary = summariseLead(row);

  assert.strictEqual(summary.enquiryId, "DBS-1");
  assert.strictEqual(summary.name, "Priya");
  for (const leaked of ["phone", "groom_contact", "bride_contact", "official_email_id", "remarks", "account_number", "custom_fields"]) {
    assert.strictEqual(summary[leaked], undefined, `${leaked} reached the summary`);
  }
});

test("every tool describes itself and its arguments", () => {
  for (const tool of registry.allTools()) {
    // The model reads the description to choose; without one it chooses blind.
    assert.ok(tool.description.length > 30, `${tool.name} needs a fuller description`);
    assert.strictEqual(tool.schema.type, "object", tool.name);
  }
});

test("no tool exposes a filesystem or a query", () => {
  /*
   * Image Selection is thousands of photographs in local and NAS storage. Nothing here takes a
   * path, opens a file or lists a directory, and nothing anywhere takes SQL.
   */
  const banned = /(sql|prisma|query|database|table|path|file|directory|folderPath|readFile|exec)/i;
  for (const tool of registry.allTools()) {
    assert.ok(!banned.test(tool.name), `${tool.name} looks like a query or filesystem tool`);
    for (const argument of Object.keys(tool.schema.properties || {})) {
      assert.ok(!banned.test(argument), `${tool.name} takes a dangerous argument: ${argument}`);
    }
  }
});

test("a tool asked for a record that does not exist says so, and does not throw", () => {
  // "Not found" is an answer the model can relay; an exception is a broken turn.
  const context = { userId: 1, modules: ["SALES", "IMAGE_SELECTION"] };
  const real = iamService.hasPermission;
  const realUser = iamService.getUserWithPermissions;
  iamService.hasPermission = async () => true;
  // The lead scope reads the login itself; stub it so the test does not depend on user 1 existing.
  iamService.getUserWithPermissions = async () => ({ id: 1, name: "Test User", role: "SUPER_ADMIN" });

  return Promise.resolve()
    .then(async () => {
      const lead = await registry.executeTool("sales.getLead", { enquiryId: "DBS-DOES-NOT-EXIST" }, context);
      assert.strictEqual(lead.found, false);

      const project = await registry.executeTool("imageselection.getProject", { id: "nope" }, context);
      assert.strictEqual(project.found, false);
    })
    .finally(() => { iamService.hasPermission = real; iamService.getUserWithPermissions = realUser; });
});

test("a tool that needs an id refuses an empty one", () => {
  const context = { userId: 1, modules: ["SALES"] };
  const real = iamService.hasPermission;
  iamService.hasPermission = async () => true;

  return Promise.resolve()
    .then(async () => {
      for (const name of ["sales.getLead", "sales.getLeadActivity", "sales.getCallLogs", "sales.getCallTranscripts"]) {
        await assert.rejects(() => registry.executeTool(name, { enquiryId: "  " }, context), /required/i, name);
      }
    })
    .finally(() => { iamService.hasPermission = real; });
});
