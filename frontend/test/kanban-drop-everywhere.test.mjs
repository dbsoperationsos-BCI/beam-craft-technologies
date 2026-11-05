import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Drag and drop on every board. A card can be carried on every board and every column takes the
 * drop: where the move is one of the record's own actions it runs (`onDrop`), and where it is not
 * the board says why (`viewOnly` / `refusalFor`) - a card that silently snapped back read as the
 * board being broken.
 */
// fileURLToPath, not `.pathname`: on Windows the pathname is "/C:/..." with spaces left as %20.
const ROOT = fileURLToPath(new URL("../src/components/", import.meta.url));
const BOARD = fs.readFileSync(path.join(ROOT, "data-table/KanbanBoard.js"), "utf8");

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : entry.name.endsWith(".js") ? [full] : [];
  });
}

test("every column takes the drop, and a refused one says why", () => {
  assert.match(BOARD, /takesDrop=\{Boolean\(dragging\) && dragging\.status !== column\.value && column !== OTHER_COLUMN\}/);
  assert.match(BOARD, /if \(allowsDrop\) onDrop\?\.\(dragging\.row, column\.value\);\s*else onRefuse\(dragging\.row, column\);/);
  assert.match(BOARD, /refusalFor\?\.\(row, column\.value\) \|\| viewOnly \|\| `\$\{name\} cannot be moved to \$\{label\} from here\.`/);
});

test("every board either runs a move or explains why it cannot", () => {
  const missing = [];
  for (const file of filesUnder(ROOT)) {
    // Code only: a comment showing how a board is used is not a board.
    const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/<KanbanBoard\b([\s\S]*?)\/>/g)) {
      if (!/\bonDrop=|\bviewOnly=/.test(match[1])) missing.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(missing, []);
});

test("no board turns every drop away without a word", () => {
  const silent = filesUnder(ROOT).filter((file) => /canDropAt=\{(?:\(\) => false|noDrop)\}/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(silent.map((file) => path.relative(ROOT, file)), []);
});

test("a record whose status is none of the columns is shown in Other, never left out", async () => {
  const fs = await import("node:fs");
  const board = fs.readFileSync(new URL("../src/components/data-table/KanbanBoard.js", import.meta.url), "utf8");
  assert.match(board, /const OTHER_COLUMN = \{ value: "__other__", label: "Other", className: "bg-slate-400 text-white" \};/);
  assert.match(board, /\(groups\[value\] && value !== OTHER_COLUMN\.value \? groups\[value\] : groups\[OTHER_COLUMN\.value\]\)\.push\(row\);/);
  assert.match(board, /const shownColumns = byColumn\[OTHER_COLUMN\.value\]\.length \? \[\.\.\.columns, OTHER_COLUMN\] : columns;/);
  assert.match(board, /\{shownColumns\.map\(\(column\) => <KanbanColumn/);
});
