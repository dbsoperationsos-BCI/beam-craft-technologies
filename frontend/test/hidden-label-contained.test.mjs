import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A field drawn with `hideLabel` keeps its label for screen readers as `sr-only` - absolutely placed.
 * Its wrapper must be `relative`, or the label is placed against the app shell: a field low in a
 * scrolling table (Payroll's Payment cells) then stretched the shell, which scrolled the whole page up.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", ...parts), "utf8");

test("every shared field with a hidden label holds it inside a relative wrapper", () => {
  for (const file of ["Dropdown.js", "DateField.js", "MonthField.js", "MultiSelectField.js"]) {
    const source = read(file);
    const at = source.search(/<span className=\{hideLabel \? "sr-only"/);
    assert.ok(at > 0, `${file} hides its label`);
    const wrapper = source.slice(source.lastIndexOf("<div", at), at);
    assert.match(wrapper, /className=\{`relative /, `${file}: the label's wrapper is relative`);
  }
});
