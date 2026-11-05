/*
 * The Projects page and Album Proofing share one table, and only a filter keeps them apart.
 *
 * `image_selection_project` holds both sections' rows, told apart by `album_proofing`. Every read
 * the Projects page makes has to pin that flag false, or the other section's projects appear in
 * its sidebar, are found by name, and are counted as its own. That has happened: the filter lived
 * only in a feature branch, and the moment it was stashed the Album Proofing projects showed up in
 * Image Selection's list. A separation held together by remembering is one query away from gone.
 *
 * So it is checked here instead of remembered. Every `imageSelectionProject` read in the Projects
 * page's repository must name the flag; a new query that forgets fails this test rather than
 * quietly showing somebody another section's work.
 *
 * The reverse guard lives with Album Proofing, whose own repository pins the flag true — a
 * separate module, deliberately, and not this test's business.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY = path.join(__dirname, "..", "src", "modules", "image-selection", "projects", "repository.js");

/**
 * Every `client.imageSelectionProject.<read>({ ... })` call in the file, with the text of its
 * arguments — enough to see whether the flag is named, without parsing JavaScript.
 */
function projectReads(source) {
  const found = [];
  const pattern = /client\.imageSelectionProject\.(findMany|findFirst|findUnique|count|aggregate)\(/g;
  for (const match of source.matchAll(pattern)) {
    // From the opening brace to its match, so a nested `where` is included whole.
    let depth = 0;
    let end = match.index + match[0].length;
    for (let index = end - 1; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") { depth -= 1; if (depth === 0) { end = index; break; } }
    }
    const line = source.slice(0, match.index).split("\n").length;
    found.push({ method: match[1], line, args: source.slice(match.index, end) });
  }
  return found;
}

test("every Projects-page read names the section it belongs to", () => {
  const source = fs.readFileSync(REPOSITORY, "utf8");
  const reads = projectReads(source);
  assert.ok(reads.length >= 4, `expected the repository's project reads, found ${reads.length}`);

  const unpinned = reads
    .filter((read) => !read.args.includes("albumProofing"))
    .map((read) => `${read.method} at repository.js:${read.line}`);

  assert.deepEqual(
    unpinned,
    [],
    "these read `image_selection_project` without pinning `albumProofing: false`, so they can see "
      + "Album Proofing's rows: a project from the other section would appear in this sidebar, be "
      + "found by name, or be counted here. Add `albumProofing: false` to the `where`.",
  );
});

test("the schema keeps the two sections' Sales links apart", () => {
  // One Sales Manager project may back one Projects-page project *and* one Album Proofing project.
  // A plain `@unique` on salesProjectId would let whichever section got there first take the link
  // for good, and `findUnique({ salesProjectId })` would then answer with the other section's row.
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model ImageSelectionProject "));
  const body = model.slice(0, model.indexOf("\n}"));

  assert.match(body, /albumProofing\s+Boolean\s+@default\(false\)\s+@map\("album_proofing"\)/, "the flag itself is gone");
  assert.match(body, /@@unique\(\[salesProjectId, albumProofing\]/, "the Sales link must be unique per section, not per table");
  assert.doesNotMatch(
    body,
    /salesProjectId\s+String\?\s+@unique/,
    "salesProjectId must not be unique on its own: that gives one section's project the Sales link outright",
  );
});
