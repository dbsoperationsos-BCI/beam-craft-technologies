import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SETTINGS_FIELDS, searchSettings } from "../src/lib/settingsSearch.mjs";

// Search in Settings: Role Management's search (every word, any order) over the Settings rail - each
// screen's name, its groups, its help text and the settings on it - offering only what the rail holds.
const rail = [
  ["user-settings", "User Settings", [
    ["whatsapp", "WhatsApp"],
    ["automatic-whatsapp-message", "Automatic WhatsApp Message", [["new-lead-welcome", "New Lead Welcome"], ["photo-selection-submitted", "Photo Selection Submitted"]]],
    ["whatsapp-activity-log", "WhatsApp Activity Log"],
  ]],
  ["overall", "Overall", [["table-settings", "Table"], ["field-settings", "Fields"]]],
  ["exclude-numbers", "Exclude Phone Numbers"],
  ["quotation-general", "General"],
  ["employee-referral", "Referral"],
  ["holidays", "Holidays"],
  ["project-services", "Services"],
  ["application-monitoring", "Application Monitoring"],
  ["locked", "Not Yet", undefined, "Coming soon"],
];
const help = (id) => ({ "quotation-general": "What every brand's quotation prints the same way.", "project-services": "The services every project is built from.", "exclude-numbers": "Calls to and from these numbers are never turned into leads." }[id] || "");
const find = (query) => searchSettings(rail, query, help);
const ids = (query) => find(query).map((result) => result.field ? `${result.id}|${result.field}` : result.id);

test("every major section is found by its name, its group or its help text", () => {
  assert.deepEqual(ids("whatsapp"), ["whatsapp", "new-lead-welcome", "photo-selection-submitted", "whatsapp-activity-log"], "the group's name finds every screen in it");
  assert.ok(ids("quotation").includes("quotation-general"), "by its help text");
  assert.ok(ids("project").includes("project-services"));
  assert.deepEqual(ids("holiday"), ["holidays"]);
  assert.deepEqual(ids("phone number"), ["exclude-numbers"]);
  assert.deepEqual(ids("overall fields"), ["field-settings"], "a nested screen by its group and name");
});

test("a setting on a screen is its own result, pointing at it; a screen named for the search lists it once", () => {
  const [hit] = find("messages a day");
  assert.deepEqual({ id: hit.id, field: hit.field, title: hit.title, path: hit.path }, { id: "whatsapp", field: "Messages a day", title: "WhatsApp", path: "User Settings" });
  assert.deepEqual(ids("instalments"), ["employee-referral|Number of instalments"]);
  assert.equal(find("whatsapp").filter((result) => result.id === "whatsapp").length, 1, "no duplicate of the WhatsApp screen");
  assert.ok(SETTINGS_FIELDS.whatsapp.includes("Different clients an hour"));
});

test("case, partial words, word order and stray spaces do not matter; nothing found is empty", () => {
  assert.deepEqual(ids("HOLI"), ["holidays"]);
  assert.deepEqual(ids("   holi   "), ["holidays"]);
  assert.deepEqual(ids("log activity"), ["whatsapp-activity-log"]);
  assert.deepEqual(ids("zzz nothing"), []);
  assert.deepEqual(ids(""), [], "no search, no results - the rail is shown");
  assert.deepEqual(ids("   "), []);
});

test("a screen the rail does not offer is never found", () => {
  assert.deepEqual(ids("not yet"), [], "a disabled entry");
  assert.deepEqual(searchSettings([["whatsapp", "WhatsApp"]], "holidays"), [], "a screen the reader's permissions leave out of the rail");
});

test("Settings puts the search at the top of its rail, the same SearchField and word search Role Management uses", () => {
  const sidebar = readFileSync(new URL("../src/components/schema-form/SchemaFormSidebar.js", import.meta.url), "utf8");
  assert.match(sidebar, /import SearchField from "@\/components\/shared\/SearchField";/);
  assert.match(sidebar, /search = null \}\) \{/, "optional: every other form's rail is unchanged");
  assert.match(sidebar, /<nav className=\{`space-y-1 \$\{searching \? "hidden" : ""\}`\}/, "the rail stays mounted under a search, so its groups keep their state");
  assert.match(sidebar, /search\.emptyMessage \|\| "Nothing found"/);
  assert.match(readFileSync(new URL("../src/lib/settingsSearch.mjs", import.meta.url), "utf8"), /import \{ matchesWordChunks, wordChunks \} from "\.\/wordChunks\.mjs";/);
  const overlay = readFileSync(new URL("../src/components/settings/SettingsOverlay.js", import.meta.url), "utf8");
  assert.match(overlay, /placeholder: "Search settings\.\.\.", ariaLabel: "Search settings", emptyMessage: "No settings found"/);
  assert.match(overlay, /function openSearchResult\(result\) \{\s*setSettingsQuery\(""\);\s*setSettingToShow\(result\.field \? \{ id: result\.id, field: result\.field \} : null\);\s*selectSettingsSection\(result\.id\);/, "a result is a rail click: the unsaved-edit question still asks");
});
