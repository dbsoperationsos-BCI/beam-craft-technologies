import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The A4 preview keeps its hidden measuring copy inside its own box, so it never stretches the page
 * holding it (a page showing it got a second scrollbar and an empty band).
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("the measuring copy is placed and clipped inside the preview's own box", () => {
  const preview = read("components", "shared", "A4DocumentPreview.js");
  assert.match(preview, /<div ref=\{frameRef\} className=\{`relative w-full min-w-0 overflow-hidden /);
  assert.match(preview, /className="pointer-events-none invisible absolute -left-\[9999px\] top-0 border-0"/);
});
