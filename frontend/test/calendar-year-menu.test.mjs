import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The calendar's month and year pickers.
 *
 * They were native `<select>`s, and a native list of eighty-odd years is drawn by the browser: on
 * Windows and on a phone that is a list as tall as the window, laid over the calendar that opened
 * it. They are the shared `Dropdown` now, which draws its own menu, measured against the room the
 * trigger has and capped, so the years scroll inside a box the size of the calendar.
 */
const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PANEL = src("components", "shared", "CalendarPanel.js");

test("the month and year are picked from the shared dropdown, not a native select", () => {
  // The tag itself, not the word in the comment that explains why it is gone.
  assert.doesNotMatch(PANEL, /<select\s|<\/select>/);
  assert.match(PANEL, /label="Calendar year"/);
  assert.match(PANEL, /label="Calendar month"/);
  // A capped, scrolling menu rather than the browser's own full-height list.
  assert.match(PANEL, /const MENU_MAX_HEIGHT = 240;/);
  assert.equal((PANEL.match(/menuMaxHeight=\{MENU_MAX_HEIGHT\}/g) || []).length, 2);
  // In the order they are written: a year list sorted alphabetically would read 1950, 1951, 2026…
  // only by luck, and the months must stay January to December.
  assert.equal((PANEL.match(/sorted=\{false\}/g) || []).length, 2);
  // Eighty-odd years is a long way to drag, so the year menu is typed into.
  assert.match(PANEL, /options=\{calendarYears\.map[\s\S]{0,120}?searchable/);
});

test("choosing a year does not close the calendar that opened it", () => {
  // The menu is portalled outside the calendar, so every host that closes on an outside click has
  // to know a click inside it is still a click inside the calendar.
  for (const host of ["DateField.js", "FilterDateInput.js"]) {
    assert.match(src("components", "shared", host), /if \(event\.target\.closest\?\.\('\[role="listbox"\]'\)\) return;/, host);
  }
});
