import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every module header ends the same way: the page's buttons, then Nebula, then the ⋮. That order
 * holds only when a page hands its ⋮ to `ModulePageHeader`'s own `menu` slot - passed inside
 * `actions` it draws before Nebula instead. This reads every header's `actions` for a ⋮ control.
 */
const files = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) walk(full);
  else if (full.endsWith(".js")) files.push(full);
});
walk(path.join(process.cwd(), "src"));

const balanced = (source, from) => {
  let depth = 0;
  for (let at = from; at < source.length; at += 1) {
    if (source[at] === "{") depth += 1;
    else if (source[at] === "}") { depth -= 1; if (depth === 0) return source.slice(from, at + 1); }
  }
  return source.slice(from);
};

// The header element itself: up to its own closing `/>`, skipping any `/>` inside a `{...}` prop.
const elementAt = (source, from) => {
  let depth = 0;
  for (let at = from; at < source.length - 1; at += 1) {
    if (source[at] === "{") depth += 1;
    else if (source[at] === "}") depth -= 1;
    else if (depth === 0 && source[at] === "/" && source[at + 1] === ">") return source.slice(from, at + 2);
  }
  return source.slice(from);
};

test("no module header passes its ⋮ in `actions` - it goes in `menu`, after Nebula", () => {
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/<ModulePageHeader\b/g)) {
      const element = elementAt(source, match.index);
      const at = element.indexOf("actions={");
      if (at < 0) continue;
      const actions = balanced(element, at + "actions=".length);
      if (/<OptionsMenu\b|<RepositoryMenu\b|<DataTableMoreMenu\b/.test(actions)) offenders.push(path.relative(process.cwd(), file));
    }
  }
  assert.deepEqual(offenders, []);
});
