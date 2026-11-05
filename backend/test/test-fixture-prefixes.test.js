const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PREFIXES, TARGETS } = require("../scripts/clear-test-fixtures");

/*
 * The suites write real rows, and something has to clear the ones they do not.
 *
 * Nine of them create branches, employees, roles, leads and projects, because what they check is a
 * SQL rule and there is no honest way to check one without a database. Each cleans up in an
 * `after()` hook, which runs exactly as long as the run finishes - and not when a test fails hard,
 * when the process is killed, or when a suite is interrupted. What is left over is not tidy debris:
 * the studio's Branches list came to show 29 branches of which 23 were called "Accounts Scope Branch
 * 004915", the Employee Repository listed "Lead Child mgr 161445" beside real staff, and one
 * leftover employee made `data-scope-backfill` fail on every subsequent run.
 *
 * `scripts/clear-test-fixtures.js` sweeps them at the *start* of every run, where the previous
 * run's failure has already happened. This holds that sweep to the suites: a new suite that mints a
 * prefix the sweep does not know about would start leaking silently, and nobody would find out
 * until its rows turned up on somebody's screen.
 *
 * Reads the suites and the schema rather than a database, so it runs anywhere with no MySQL.
 */

const HERE = __dirname;
const SUITES = fs.readdirSync(HERE).filter((name) => name.endsWith(".test.js")).map((name) => path.join(HERE, name));

/** Every prefix a suite stamps its fixtures with, as it writes them. */
function prefixesInUse() {
  const found = new Map();
  for (const file of SUITES) {
    const source = fs.readFileSync(file, "utf8");
    /*
     * The two shapes the suites use: a template tag built from a stamp - `TDC-${STAMP}` - and a
     * plain literal prefix, as iam.test.js's `TEST_BR1` and this repo's `ZZTEST-`/`ZZREP-` files.
     */
    for (const match of source.matchAll(/`([A-Z]{2,6}[-_])\$\{STAMP\}/g)) found.set(match[1], file);
    for (const match of source.matchAll(/(?:const STAMP|STAMP) = `([A-Z]{2,6}-)\$\{/g)) found.set(match[1], file);
    for (const match of source.matchAll(/"(TEST_)[A-Z0-9_]*"/g)) found.set(match[1], file);
  }
  return found;
}

test("every prefix a suite stamps its fixtures with is one the sweep clears", () => {
  const inUse = prefixesInUse();
  assert.ok(inUse.size > 0, "no fixture prefixes were found at all; this test is reading the wrong thing");

  const uncovered = [...inUse.entries()]
    .filter(([prefix]) => !PREFIXES.includes(prefix))
    .map(([prefix, file]) => `${prefix} (${path.basename(file)})`);

  assert.deepEqual(
    uncovered,
    [],
    "these suites write fixtures the sweep will never clear, so a killed run leaves them in the "
      + `database forever - add them to PREFIXES in scripts/clear-test-fixtures.js:\n  ${uncovered.join("\n  ")}`,
  );
});

test("the sweep clears something in every table the suites write to", () => {
  /*
   * The other half. A prefix that is covered but whose table is not in `TARGETS` is still a leak:
   * the branch goes and the employee stays. Read from the suites' own `deleteMany` calls, which are
   * the list of tables they are known to write.
   */
  const swept = new Set(TARGETS.map(([model]) => model));
  /*
   * The tables a suite cleans that the sweep deliberately does not name.
   *
   * The join rows are `onDelete: Cascade` from the row above them, so the sweep takes them with the
   * role, user, branch or project rather than listing them.
   *
   * The two AI tables are a different case and worth stating: `ai-actions.test.js` writes its plans
   * against whichever user already exists rather than one of its own, so there is no prefix to
   * sweep on - and it clears them in its `before` as well as its `after`, so the next run cleans up
   * after a killed one. Nothing of theirs is ever shown in a list of branches or employees.
   */
  const cascaded = new Set([
    "userRole", "rolePermission", "roleBranch", "projectAttachment",
    "hrmTaskHolder", "hrmTaskActivity", "salesProjectCrdDocument",
    "aiConversation", "aiActionPlan",
    // Both `onDelete: Cascade` from the user: an account that goes takes its outstanding reset
    // codes and links with it, so sweeping the user sweeps these.
    "passwordResetOtp", "passwordResetToken",
  ]);

  const written = new Set();
  for (const file of SUITES) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/prisma\.([a-zA-Z]+)\.deleteMany\(/g)) written.add(match[1]);
  }

  const missing = [...written].filter((model) => !swept.has(model) && !cascaded.has(model));
  assert.deepEqual(
    missing,
    [],
    `a suite cleans up these tables but the sweep does not, so a killed run leaves them:\n  ${missing.join("\n  ")}`,
  );
});

test("every table the sweep names, and the column it identifies a fixture by, exists", () => {
  /*
   * Against the schema rather than a live client, so a renamed column is caught here rather than as
   * a warning nobody reads in the middle of a test run - the sweep swallows its own failures on
   * purpose, so a stale target would go quiet rather than loud.
   */
  const schema = fs.readFileSync(path.join(HERE, "..", "prisma", "schema.prisma"), "utf8");
  const models = new Map();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    // Prisma's client name is the model name with a lower-case first letter.
    models.set(match[1][0].toLowerCase() + match[1].slice(1), match[2]);
  }

  const broken = [];
  for (const [model, field] of TARGETS) {
    const body = models.get(model);
    if (!body) { broken.push(`${model} is not a model`); continue; }
    if (!new RegExp(`^\\s+${field}\\s`, "m").test(body)) broken.push(`${model} has no field \`${field}\``);
  }
  assert.deepEqual(broken, [], `the sweep names something the schema does not have:\n  ${broken.join("\n  ")}`);
});

test("the sweep runs before the suites, not only when somebody remembers", () => {
  // `pretest` is what makes this automatic. Without it the script is one more thing to know about,
  // which is exactly what let the debris build up in the first place.
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
  assert.equal(pkg.scripts.pretest, "node scripts/clear-test-fixtures.js");
});

test("the sweep deletes children before their parents", () => {
  // A project's shoots before the project, a lead's meetings before the lead: a foreign key that
  // refuses the delete would be swallowed as a warning and the row would stay.
  const order = TARGETS.map(([model]) => model);
  const before = (child, parent) => {
    const c = order.indexOf(child);
    const p = order.indexOf(parent);
    assert.ok(c !== -1 && p !== -1, `${child} or ${parent} is no longer swept`);
    assert.ok(c < p, `${child} is swept after ${parent}, so its rows can block the delete`);
  };
  before("projectShoot", "salesProject");
  before("salesQuotation", "salesProject");
  before("salesCrmMeeting", "salesCrmLead");
  before("employee", "branch");
  before("user", "branch");
});
