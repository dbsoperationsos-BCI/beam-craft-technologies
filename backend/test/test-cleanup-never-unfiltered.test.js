const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A test's clean-up must never be able to empty a table.
 *
 * `deleteMany({ where: { id: F.client?.id } })` reads as "delete my fixture", but when the fixture was
 * never made - its setup failed, say on a column a migration had not added yet - `F.client?.id` is
 * `undefined`, and Prisma drops an undefined filter: the call becomes `deleteMany({ where: {} })` and
 * deletes **every** row. That is how one run against a database behind its migrations deleted every
 * user (and, through their foreign keys, their roles, attendance and notifications) and every
 * pre-production record. A fixture's id goes in as `{ in: [F.x?.id].filter(Boolean) }`, which matches
 * nothing when there is nothing to remove.
 */
const UNSAFE = /(?:deleteMany|updateMany|findMany)\??\.?\(\{\s*where:\s*\{[^}]*:\s*[\w.]+\?\.\w+\s*[,}]/;

test("no test or script deletes or updates by an id that may be undefined", () => {
  const roots = [path.join(__dirname), path.join(__dirname, "..", "scripts")];
  const offenders = [];
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".js")) continue;
      fs.readFileSync(path.join(root, name), "utf8").split("\n").forEach((line, index) => {
        if (!/^\s*(\*|\/\/)/.test(line) && UNSAFE.test(line)) offenders.push(`${path.relative(path.join(__dirname, ".."), path.join(root, name))}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});
