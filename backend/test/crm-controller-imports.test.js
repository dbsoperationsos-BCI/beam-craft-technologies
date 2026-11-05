const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Every helper the CRM controller calls is a helper it actually imported.
 *
 * `stampCrmLeadCreator` was exported from `crmLeadService` and called twice in the controller - by
 * `create` and by `createBulk` - and imported by neither. Node does not object until the line runs,
 * and the line runs *after* the lead has been written: so Add Lead created the lead, threw
 * `ReferenceError: stampCrmLeadCreator is not defined` on the next statement, and the controller's
 * own catch turned that into a 500 reading "Unable to add CRM lead."
 *
 * That is the worst shape a bug of this kind can take. The lead was in the table and the screen
 * said it had failed, so the obvious response - press Confirm again - came back "already holds this
 * contact number", and every attempt left another lead behind. It reached production because
 * nothing here runs the controller's create path and the backend has no linter to notice a name
 * that resolves to nothing.
 *
 * Checked statically rather than by calling the route, which would need a database: for each name
 * `crmLeadService` exports, if the controller calls it then it has to be in the destructuring it is
 * required through. A helper added to both files and forgotten in the import fails here rather than
 * on the first lead somebody adds.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", ...parts), "utf8");

test("the CRM controller imports every crmLeadService helper it calls", () => {
  const service = read("crmLeadService.js");
  const controller = read("controller.js");

  // What the service offers, read off its own `module.exports = { ... }` block.
  const exportBlock = service.slice(service.lastIndexOf("module.exports = {"));
  const exported = [...exportBlock.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,\s*$/gm)].map((match) => match[1]);
  assert.ok(exported.includes("createCrmLead"), "crmLeadService's export block was not read as expected");
  assert.ok(exported.includes("stampCrmLeadCreator"), "stampCrmLeadCreator is no longer exported by crmLeadService");

  // What the controller took from it.
  const requireLine = controller.match(/const \{([^}]*)\} = require\("\.\/crmLeadService"\);/);
  assert.ok(requireLine, "the controller no longer requires ./crmLeadService by destructuring");
  const imported = new Set(requireLine[1].split(",").map((name) => name.trim().split(":")[0].trim()).filter(Boolean));

  /*
   * A call rather than a mention: the name followed by "(", and not preceded by a dot, so
   * `service.createCrmLead(...)` and a word inside a comment are both left alone.
   */
  const missing = exported.filter((name) => {
    if (imported.has(name)) return false;
    return new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(controller);
  });

  assert.deepEqual(missing, [], `the CRM controller calls ${missing.join(", ")} without importing it`);
});

test("a lead is stamped with its creator on both paths that create one", () => {
  /*
   * The two call sites the missing import broke. They matter beyond the crash: `createdByUserId` is
   * one of the columns the data scope reads (`LEAD_SCOPE_COLUMNS` in services/leadScope.js), so a
   * lead written without it is invisible to the person who entered it unless their name is on it
   * some other way. Pinned so neither path quietly stops stamping.
   */
  const controller = read("controller.js");
  const calls = [...controller.matchAll(/await stampCrmLeadCreator\(/g)];
  assert.equal(calls.length, 2, "stampCrmLeadCreator is no longer called by both create and createBulk");
});
