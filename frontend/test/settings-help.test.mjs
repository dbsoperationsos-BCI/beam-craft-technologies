import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SETTINGS_HELP, settingsHelpFor } from "../src/constants/settingsHelp.js";

/*
 * Every Settings screen carries a helper line in the ⓘ beside its title - what it is for and what changing it
 * affects - drawn by the shared section heading, so a screen added without one fails here.
 */
const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const OVERLAY = read("components/settings/SettingsOverlay.js");

/** The overlay's leaf screens: an entry with a `render` and no `children`. */
function leafIds() {
  const ids = [];
  const matches = [...OVERLAY.matchAll(/\{\s*id: "([^"]+)",/g)];
  matches.forEach((match, index) => {
    const body = OVERLAY.slice(match.index, matches[index + 1]?.index ?? OVERLAY.length);
    if (/render:/.test(body) && !/children:/.test(body.slice(0, 200))) ids.push(match[1]);
  });
  return ids;
}

test("every Settings screen has a helper line", () => {
  const brands = [...read("lib/quotationBrand.mjs").matchAll(/\{ code: "([A-Z_]+)"/g)].map((match) => `quotation-brand-${match[1]}`);
  const integrations = [...read("components/settings/sheetIntegrationConfigs.js").matchAll(/sectionId: "([^"]+)"/g)].map((match) => match[1]);
  const screens = [...leafIds(), "project-services", "project-deliverables", ...brands, ...integrations];
  // A sanity floor for the parsing, not a count to keep: the wishes' three screens became tabs.
  assert.ok(screens.length > 45, `found ${screens.length} screens`);
  assert.deepEqual(screens.filter((id) => !settingsHelpFor(id)), []);
});

test("the heading draws it, for every screen the overlay wraps and for Project's own two", () => {
  assert.match(OVERLAY, /<SchemaFormSection id=\{openSection\.id\} title=\{openSection\.title\} description=\{settingsHelpFor\(openSection\.id\)\}/);
  const project = read("components/project-management/ProjectSettingsPanel.js");
  assert.match(project, /title="Services" description=\{settingsHelpFor\("project-services"\)\}/);
  assert.match(project, /title="Deliverables" description=\{settingsHelpFor\("project-deliverables"\)\}/);
  // The line is the ⓘ beside the title, not a paragraph under it.
  assert.match(read("components/schema-form/SchemaFormSection.js"), /<h2 className="[^"]*">\{title\}<HelpTip text=\{description\} \/><\/h2>/);
});

test("a template's line says who reads it - not every message goes to a client", () => {
  for (const id of ["message-employee-invite", "message-attendance-report", "message-production-started"]) {
    assert.doesNotMatch(SETTINGS_HELP[id], /sent to the client/i, id);
  }
});
