const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A service or deliverable name is unique by its name and by the code made of it (case and
 * punctuation folded). The create handlers look before they add, and two adds of one name at the
 * same moment both pass that look - the unique columns refuse the second, and that refusal is the
 * same 409 the look gives, not a 500. This is what keeps Settings → Duplicate from making two rows
 * of one name.
 */

const source = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/controller.js"), "utf8");
const handler = (name) => source.slice(source.indexOf(`async function ${name}(`), source.indexOf("\nasync function ", source.indexOf(`async function ${name}(`) + 1));

for (const [name, message] of [["createServiceDefinition", "This service already exists."], ["createDeliverableDefinition", "This deliverable already exists."]]) {
  test(`${name} refuses a taken name by name or code, and a race as the same 409`, () => {
    const body = handler(name);
    assert.match(body, /where: \{ OR: \[\{ name \}, \{ code \}\] \}/);
    assert.ok(body.includes(`return res.status(409).json({ message: "${message}" });`));
    assert.ok(body.includes(`if (error?.code === "P2002") return res.status(409).json({ message: "${message}" });`));
  });
}
