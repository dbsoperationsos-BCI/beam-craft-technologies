import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDoubleTap } from "../src/lib/doubleTap.mjs";

test("two quick taps on the same row are a double tap", () => {
  const taps = createDoubleTap();
  const row = {};
  taps.start(10, 10); assert.equal(taps.end(10, 10, row, 1000), false);
  taps.start(11, 12); assert.equal(taps.end(11, 12, row, 1200), true);
});

test("slow taps, taps on two rows, and a scroll are not", () => {
  const taps = createDoubleTap();
  const a = {}; const b = {};
  taps.start(0, 0); taps.end(0, 0, a, 0);
  taps.start(0, 0); assert.equal(taps.end(0, 0, a, 1000), false, "too slow");
  taps.start(0, 0); assert.equal(taps.end(0, 0, b, 1100), false, "another row");
  taps.start(0, 0); assert.equal(taps.end(0, 40, b, 1200), false, "the finger moved: a scroll");
  taps.start(0, 0); assert.equal(taps.end(0, 0, b, 1300), false, "a scroll resets the count");
});

test("the shared table opens a row on a double tap as well as a double click", () => {
  const table = fs.readFileSync(new URL("../src/components/data-table/DataTable.js", import.meta.url), "utf8");
  assert.match(table, /import \{ createDoubleTap \} from "@\/lib\/doubleTap\.mjs";/);
  assert.match(table, /onTouchEnd=\{onRowDoubleClick \?/);
  assert.match(table, /touch-manipulation/);
});
