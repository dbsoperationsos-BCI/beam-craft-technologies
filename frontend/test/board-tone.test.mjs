import test from "node:test";
import assert from "node:assert/strict";
import { chipsOf, initialsOf, inkOf, tint, toneOf, DEFAULT_TONE } from "../src/lib/boardTone.mjs";

// The glass lanes read each column's own status colour off the class its screen already gives it.
test("a column's colour is read from a Tailwind class or an exact hex, else slate", () => {
  assert.equal(toneOf("bg-emerald-600 text-white"), "#059669");
  assert.equal(toneOf("bg-[#7C3AED] text-white border-[#7c3aed]"), "#7c3aed");
  assert.equal(toneOf("text-white"), DEFAULT_TONE);
  assert.equal(tint("#059669", 0.5), "rgba(5, 150, 105, 0.5)");
});

test("an avatar's letters stay readable on a pale column colour", () => {
  assert.equal(inkOf("#c3c7ce"), "#334155", "pale grey is written in slate");
  assert.equal(inkOf("#7c3aed"), "#7c3aed", "a strong colour is written in itself");
});

test("a card's avatar and chips come from what it already shows", () => {
  assert.equal(initialsOf("Keerthana Raj"), "KR");
  assert.equal(initialsOf("bc dc"), "BD");
  assert.equal(initialsOf(""), "?");
  assert.deepEqual(chipsOf("Active · Joined 2026-10-21"), ["Active", "Joined 2026-10-21"]);
  assert.deepEqual(chipsOf(""), []);
});

test("a board wider than the screen can be scrolled sideways without a trackpad", async () => {
  const fs = await import("node:fs");
  const board = fs.readFileSync(new URL("../src/components/data-table/KanbanBoard.js", import.meta.url), "utf8");
  // A scrollbar drawn whatever the system setting (macOS hides it for a mouse otherwise).
  assert.match(board, /overflow-x-auto p-3 \[&::-webkit-scrollbar\]:h-2/);
  assert.doesNotMatch(board, /scrollbar-width:thin\] \[&::-webkit-scrollbar\]:h-2/, "the standard property makes Chrome ignore the drawn scrollbar");
  // And arrows at the edges, only while there is somewhere to go.
  assert.match(board, /\{canScroll\.left && <IconButton label="Scroll to the columns on the left"/);
  assert.match(board, /\{canScroll\.right && <IconButton label="Scroll to the columns on the right"/);
});
