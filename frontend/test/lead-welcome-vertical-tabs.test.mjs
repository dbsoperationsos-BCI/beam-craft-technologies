import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Settings → Templates → New Lead Welcome by Vertical: the verticals are tabs, as a page's status tabs
 * are, with Office time / After hours as a second row of tabs under them - no drop-down.
 */
const SCREEN = readFileSync(new URL("../src/components/settings/LeadWelcomeVerticalTemplates.js", import.meta.url), "utf8");

test("the verticals are a row of tabs, and the two moments a row under them", () => {
  assert.doesNotMatch(SCREEN, /Dropdown/);
  assert.match(SCREEN, /tabs=\{verticals\.map\(\(row\) => \(\{ id: String\(row\.id\), label: row\.name,/);
  assert.match(SCREEN, /ariaLabel="Vertical to word the welcome for"/);
  assert.match(SCREEN, /tabs=\{SLOTS\.map\(\(entry\) => \(\{ id: entry\.id, label: vertical\[entry\.written\] \? entry\.label : `\$\{entry\.label\} - not written` \}\)\)\}/);
  // Both rows ask before an unsaved wording is thrown away.
  assert.match(SCREEN, /onChange=\{\(next\) => ask\(\{ verticalId: String\(next\) \}\)\}/);
  assert.match(SCREEN, /onChange=\{\(next\) => ask\(\{ slot: next \}\)\}/);
});
