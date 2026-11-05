const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The seed writes values of the type the schema declares.
 *
 * This has broken the pipeline twice, the same way both times, and neither failure could happen on a
 * developer's machine. A column changed from `Boolean` to `String` - `remarks_enabled`, then
 * `photo_count_enabled` - and the seed went on sending `true`. Locally the rows already exist, so
 * the seed takes its `if (!existing)` branch and never reaches the `create`; on CI the database is
 * empty, every create runs, and Prisma refuses:
 *
 *     Argument `photoCountEnabled`: Invalid value provided. Expected String or Null, provided Boolean.
 *
 * So the check is here rather than in a reviewer's head. It reads the two files against each other:
 * every literal `field: true` / `field: false` the seed writes is looked up in `schema.prisma`, and a
 * field the schema calls a String is a failure.
 *
 * It deliberately does **not** know which conversion is right - that is a judgement about meaning.
 * `remarks_enabled` became a note that decides nothing, so the seed stopped writing it and NULL is
 * correct; `photo_count_enabled` still decides something and blank reads as *off*, so it had to be
 * written as the word 'Yes' or 'No' instead. Both answers satisfy this test, which only insists that
 * somebody looked.
 */

const ROOT = path.join(__dirname, "..");
const SCHEMA = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");

/** Every model's fields, as `{ Model: { field: "String?" } }`. */
function declaredTypes() {
  const models = {};
  for (const model of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = {};
    for (const field of model[2].matchAll(/^\s{2}(\w+)\s+(\w+)(\??)/gm)) fields[field[1]] = field[2] + field[3];
    models[model[1]] = fields;
  }
  return models;
}

/** The seed files that write rows, and the models each of them writes to. */
function seedSources() {
  const dir = path.join(ROOT, "prisma");
  const files = [path.join(dir, "seed.js"), path.join(dir, "asset-categories.seed.js")];
  for (const name of fs.readdirSync(path.join(dir, "seeds"))) {
    if (name.endsWith(".js")) files.push(path.join(dir, "seeds", name));
  }
  return files.filter((file) => fs.existsSync(file)).map((file) => ({ file, source: fs.readFileSync(file, "utf8") }));
}

/** Every `data: { … }` payload in a file, brace-matched so nested objects come with it. */
function dataPayloads(source) {
  const payloads = [];
  const opener = /\bdata:\s*\{/g;
  let match;
  while ((match = opener.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    payloads.push(source.slice(match.index, i));
  }
  // `update: { … }` and `create: { … }` inside an upsert are payloads too.
  for (const branch of source.matchAll(/\b(?:create|update):\s*\{[^{}]*\}/g)) payloads.push(branch[0]);
  return payloads;
}

test("no seed writes a boolean into a column the schema calls a String", () => {
  const types = declaredTypes();
  const offences = [];

  for (const { file, source } of seedSources()) {
    // Which models this file writes, so a field name is only checked against tables it reaches -
    // `isActive` is a Boolean on one model and could be text on another.
    const models = [...new Set([...source.matchAll(/prisma\.(\w+)\.(?:create|upsert|update|createMany)\(/g)]
      .map((match) => match[1].charAt(0).toUpperCase() + match[1].slice(1)))];

    /*
     * Only what is written **in a `data:` payload**, not every object literal in the file.
     *
     * The first draft flagged the seed's own config maps - `{ photoCountEnabled: true }` - which
     * hold a boolean *intent* that is converted at the write site by `deliverableAnswerText`. Those
     * are not what reaches Prisma, and failing on them would push the next person to delete the
     * check rather than read it.
     */
    for (const payload of dataPayloads(source)) {
      for (const assignment of payload.matchAll(/(\w+):\s*(true|false)\b/g)) {
        const field = assignment[1];
        for (const model of models) {
          const declared = types[model]?.[field];
          if (declared && declared.startsWith("String")) {
            offences.push(`${path.relative(ROOT, file)} writes ${field}: ${assignment[2]} — ${model}.${field} is ${declared}`);
          }
        }
      }
    }
  }

  assert.deepEqual(offences, [], `a seed sends a Boolean where the schema wants text:\n  ${offences.join("\n  ")}`);
});

test("the two columns this has already happened to are still handled", () => {
  /*
   * Named rather than left to the general rule above, because each was fixed a *different* way and
   * the difference is the whole lesson: one was dropped, the other converted, and swapping the two
   * answers would silently change what a deliverable means without failing anything.
   */
  const seed = fs.readFileSync(path.join(ROOT, "prisma", "seed.js"), "utf8");

  // A note that decides nothing: the seed has no business inventing one, so it writes none at all.
  assert.equal(/remarksEnabled:/.test(seed), false, "the seed writes a remarks note again");

  /*
   * An answer that still decides something, where **blank reads as off** - so leaving it out would
   * turn the photo count off for the five deliverables that answered Yes. Converted through the
   * module that owns the rule, not a local `? "Yes" : "No"`, so the seed cannot come to disagree
   * with the readers.
   */
  assert.match(seed, /photoCountEnabled: deliverableAnswerText\(config\.photoCountEnabled\)/);
  assert.match(seed, /require\("\.\.\/src\/services\/deliverableAnswers"\)/);

  const { deliverableAnswerText, deliverableAnswerOn } = require("../src/services/deliverableAnswers");
  assert.equal(deliverableAnswerText(true), "Yes");
  assert.equal(deliverableAnswerText(false), "No");
  // And the words still mean what the booleans meant, which is what keeps a seeded database the
  // same as one the migration converted.
  assert.equal(deliverableAnswerOn(deliverableAnswerText(true)), true);
  assert.equal(deliverableAnswerOn(deliverableAnswerText(false)), false);
});
