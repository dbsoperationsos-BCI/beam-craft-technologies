import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SECTION = fs.readFileSync(new URL("../src/components/project-management/SchedulePaymentSection.js", import.meta.url), "utf8");

/*
 * Schedule Payment's rows are read across, so every control has to begin on the same line. The Date
 * cell is the tall one - its box carries "Date not known?" under it, or two lines naming the shoot
 * it follows - and a table's default middle alignment centred every other box against that height,
 * leaving the date box standing above its neighbours.
 */

test("the row's cells are topped, so every box starts on one line and the links hang below", () => {
  assert.match(SECTION, /td: "!py-2\.5 align-top"/);
});

test("the cells that hold no box still sit on the line the boxes do", () => {
  // Final Settlement falls due on no date, and its dash would otherwise ride at the very top.
  assert.match(SECTION, /<span className="flex min-h-10 items-center text-slate-400">—<\/span>/);
  // The delete is h-9 against the boxes' h-10, so it is nudged onto their centre line.
  assert.match(SECTION, /className="mt-0\.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500/);
});

test("a payment that follows a shoot named for several keeps the row one height", () => {
  // "3 days before Groom Haldi + Bride Haldi" ran to four and five lines and stretched the row.
  assert.match(SECTION, /<span className="line-clamp-2 hover:underline">\{shootLinkLabel\(row, shoots\)\}<\/span>/);
  assert.match(SECTION, /title=\{shootLinkLabel\(row, shoots\)\}/, "the whole phrase is still readable on the title");
});

test("the date box is the same height as the boxes beside it, and carries no label to push it down", () => {
  assert.match(SECTION, /\[&_\[data-field-control\]\]:min-h-10/);
  assert.match(SECTION, /hideLabel/);
});
