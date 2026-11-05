const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { definitions, codeFromName } = require("../src/modules/hrm/master-data/definitions");

/*
 * Adding a designation, a department, a skill or a vertical by name alone.
 *
 * Every master-data row is keyed by a `code` as well as a name, and the code is a machine key: no
 * screen shows it, and nobody maintaining the list of designations has an opinion about
 * `PRODUCTION_MANAGER`. Three of the four screens that write these rows knew that and derived one
 * on the client. The fourth - Settings -> Field Settings, which is the screen the studio actually
 * uses for these lists - sent `{ name }`, and every Add came back 400 *Validation failed* naming a
 * field that screen does not have and cannot show. The list could be read and never added to.
 *
 * The code is minted by the controller now, so a caller that sends a name is enough. Two things
 * have to hold for that to stay true, and neither announces itself: no definition may go back to
 * demanding a code, and the mint has to produce a usable key from an ordinary name.
 *
 * Reads the schemas rather than a database, so it runs anywhere with no MySQL.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "master-data", "controller.js"), "utf8");

test("no master-data list demands a code from the screen that adds to it", () => {
  const demanding = Object.entries(definitions)
    .filter(([, definition]) => !definition.createSchema.shape.code.isOptional())
    .map(([key]) => key);
  assert.deepEqual(
    demanding,
    [],
    "these lists cannot be added to by name alone, so Field Settings' Add will fail on them: "
      + demanding.join(", "),
  );
});

test("a payload of just a name is accepted, which is what Field Settings sends", () => {
  // Exactly the body `HrmOptionListEditor.add()` posts, against the four lists that screen offers.
  for (const key of ["designations", "departments", "skills", "verticals"]) {
    const parsed = definitions[key].createSchema.safeParse({ name: "Production Manager" });
    assert.ok(parsed.success, `${key} refuses a name-only create: ${JSON.stringify(parsed.error?.flatten())}`);
    assert.equal(parsed.data.code, undefined, `${key} invented a code during parsing; the controller mints it`);
  }
});

test("the minted code is the key the seeded rows already use", () => {
  /*
   * The same shape the migrations seeded - `PRODUCTION_MANAGER`, `OFFICE_ASSISTANT_SALES` - so a
   * list half-seeded and half-typed does not end up with two spellings of the same kind of key.
   */
  assert.equal(codeFromName("Production Manager"), "PRODUCTION_MANAGER");
  assert.equal(codeFromName("Office Assistant + Sales"), "OFFICE_ASSISTANT_SALES");
  assert.equal(codeFromName("Sr. Creative Specialist"), "SR_CREATIVE_SPECIALIST");
  assert.equal(codeFromName("Technical - Videographer"), "TECHNICAL_VIDEOGRAPHER");
  // Trimmed at both ends rather than left with the separators the punctuation turned into.
  assert.equal(codeFromName("  Corp  "), "CORP");
  assert.equal(codeFromName("(Interns)"), "INTERNS");
  // The column holds 50 characters, so the mint cannot hand it 51.
  assert.ok(codeFromName("x".repeat(80)).length <= 50);
  // And a name with nothing to mint from produces nothing, which the controller answers for.
  assert.equal(codeFromName("--"), "");
  assert.equal(codeFromName(null), "");
});

test("the controller mints it, refuses what it cannot mint, and names the clash", () => {
  const create = CONTROLLER.slice(CONTROLLER.indexOf("async create("), CONTROLLER.indexOf("async update("));
  assert.match(create, /const code = parsed\.data\.code \|\| codeFromName\(parsed\.data\.name\)/, "the controller no longer mints a code");
  // A code that was given explicitly still wins: Accounts derives its own from the bank and branch.
  assert.match(create, /data: \{ \.\.\.parsed\.data, code,/);
  // A name with no letters or numbers in it is answered in the words the screen asked in, rather
  // than being handed to MySQL as an empty unique key.
  assert.match(create, /if \(!code\) return res\.status\(400\)/);
  /*
   * And a duplicate is reported as the duplicate it is. The code is derived from the name, so the
   * only way to collide is to re-enter a name the list already has - "Designation code already
   * exists" describes a field the screen does not show and a value nobody typed.
   */
  assert.match(create, /onDuplicate: `\$\{parsed\.data\.name\} is already in this list`/);
});
