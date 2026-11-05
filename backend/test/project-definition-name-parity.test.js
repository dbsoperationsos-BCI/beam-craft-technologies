const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { codeFor } = require("../src/modules/sales/projects/controller");

/*
 * The dialogs under Settings → Project refuse a service or deliverable name another row already
 * has, before it is staged, by the rule this server judges names by: the `code` column, made from
 * the name by `codeFor`. The frontend cannot call `codeFor`, so it carries the rule in
 * `projectDefinitionNames.mjs` - and this is what keeps the two from drifting apart. A name the
 * dialog lets through must be one the server accepts, and one it refuses must be one the server
 * would refuse, or the refusal is back at Save with the row already in the table.
 */
test("the dialog's idea of when two names are one is the server's own", async () => {
  const { definitionNameKey } = await import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", "projectDefinitionNames.mjs")).href);
  const names = ["Demo Drone", "  demo   drone ", "Demo - Drone!", "Candid Photo + Reels", "360 Video Camera", "Pre/ Post Wedding Photography", "AI Memorial Video", "", "   ", "___", "Ünïcode Album"];
  for (const name of names) {
    assert.equal(`X_${definitionNameKey(name)}`, codeFor("X", name), `"${name}" is judged differently by the two sides`);
  }
});
