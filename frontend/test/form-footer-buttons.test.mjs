import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Where a footer's buttons sit - in a panel, a dialog or a popup.
 *
 * Every schema-form footer puts its buttons together at the **bottom right**, which is where
 * `ui/Dialog` has always put its own (`sm:justify-end`). They did not: the panel's footer row flowed
 * from the left and each footer pushed its primary button over with `ml-auto` - so Cancel sat at the
 * far left and Save at the far right, a row that reads as two unrelated controls, and a footer with
 * three buttons read as two groups with a hole in the middle. Which side a button landed on depended
 * on which panel you had opened.
 *
 * The row is right-aligned once, in `SchemaFormPanel`, and no footer carries an auto margin. On a
 * phone the buttons are `flex-1` (or `w-full`) and fill the row, so there is nothing to align.
 */

const HERE = import.meta.dirname;
const COMPONENTS = path.join(HERE, "..", "src", "components");
const read = (file) => fs.readFileSync(path.join(COMPONENTS, file), "utf8");

/** Every file under `src/components`. */
function sources(dir = COMPONENTS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : entry.name.endsWith(".js") ? [full] : [];
  });
}

test("the panel right-aligns its footer row, and its own footer no longer pushes the submit over", () => {
  const panel = read("schema-form/SchemaFormPanel.js");
  assert.match(panel, /className="flex min-w-0 flex-1 items-center gap-3 border-t border-slate-200 px-3 py-2\.5 sm:flex-wrap sm:justify-end sm:px-5 sm:py-3"/);
  assert.match(panel, /<Button className="max-sm:flex-1" variant=\{submitVariant\} disabled=\{saving \|\| submitDisabled\}/);
  assert.doesNotMatch(panel, /className="[^"]*ml-auto/);
  // The same rule the dialogs follow, which is where it came from.
  assert.match(read("ui/Dialog.js"), /<footer className=\{`flex shrink-0 gap-3 px-5 py-5 sm:justify-end sm:px-6/);
});

test("no footer anywhere pushes a button to the other end", () => {
  /*
   * The rule is the footers, not only the panels': the lead popup, the candidate popup, the dialogs
   * and the record views all draw one, and a button carrying `ml-auto` or `mr-auto` in any of them
   * splits the row the same way - Discard at the far left, Update at the far right, with a hole
   * between them.
   *
   * Every file under `src/components` is read, so a footer written later is held to this without
   * anybody remembering it. Only **buttons** are forbidden an auto margin: a footer may still put a
   * line of text at the left - "Unsaved changes", a warning, a count of what is selected - and
   * several do.
   *
   * What is read is the `footer` prop, anything named `footer` built above it, and `<footer>` itself,
   * so a footer drawn as a plain bordered `<div>` escapes this - write it as a `<footer>`. The lead
   * popup's was a div, which is how its **Back** went on sitting at the far left after every other
   * footer had been brought into line.
   */
  const offenders = [];
  for (const file of sources()) {
    const source = fs.readFileSync(file, "utf8");
    const footers = [
      ...source.matchAll(/footer=\{([\s\S]*?)\}\n/g),
      ...source.matchAll(/const \w*[fF]ooter\w* = ([\s\S]*?);\n\n/g),
      ...source.matchAll(/<footer[\s\S]{0,2000}?<\/footer>/g),
    ].map((match) => match[1] ?? match[0]);
    for (const footer of footers) {
      for (const tag of footer.matchAll(/<[Bb]utton\b[^>]*>/g)) {
        if (/\b(?:sm:)?(?:ml|mr)-auto\b/.test(tag[0])) offenders.push(`${path.relative(COMPONENTS, file)}: ${tag[0].slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
