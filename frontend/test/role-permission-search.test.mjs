import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { matchesWordChunks } from "../src/lib/wordChunks.mjs";

/*
 * The role form's search, in two layers. One sits above the whole matrix and decides which
 * modules are worth opening at all: a module whose name matches shows whole, otherwise only the
 * sub-modules that match, and a module matching nothing is left out. A viewer who may only look
 * can still use it and open modules - the form locks each field that changes the role instead of
 * the whole panel.
 *
 * A module past 8 sub-modules also carries its own search once it is open, for narrowing that one
 * module's rows without touching what the page-wide search already decided about the rest.
 */

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "admin", "RoleDialog.js"), "utf8");
const SEARCH = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "SearchField.js"), "utf8");

// The helper on its own, with the label lookup it imports stood in for.
const helper = DIALOG.slice(DIALOG.indexOf("export function searchModule"), DIALOG.indexOf("export function settleModule"));
const searchModule = new Function("featureLabel", "matchesWordChunks", `${helper.replace("export ", "")}; return searchModule;`)((permission) => permission.label, matchesWordChunks);

const leads = { id: 1, label: "Leads", displayName: "CRM Leads", feature: "Leads" };
const board = { id: 2, label: "Follow-up Board", displayName: "Follow-up Board", feature: "Follow Up" };
const features = [leads, board];

test("no search leaves every sub-module", () => {
  assert.deepEqual(searchModule("Sales", features, ""), features);
  assert.deepEqual(searchModule("Sales", features, "   "), features);
});

test("a module whose name matches shows whole", () => {
  assert.deepEqual(searchModule("Sales", features, "sal"), features);
});

test("otherwise only the sub-modules that match, by name or by stored key", () => {
  assert.deepEqual(searchModule("Sales", features, "LEAD"), [leads]);
  assert.deepEqual(searchModule("Sales", features, "follow up"), [board]);
});

test("a module matching nothing is left out", () => {
  assert.equal(searchModule("Sales", features, "payroll"), null);
});

test("one search sits above the matrix, deciding which modules are worth opening", () => {
  assert.match(DIALOG, /fields: \[branchAdminField, permissionSearchField, \.\.\.fields\]/, "under Branch Admin, above the modules");
  assert.match(DIALOG, /<SearchField\s+ariaLabel="Search modules and permissions"/);
  assert.match(DIALOG, /moduleKeys\.filter\(\(key\) => searchModule\(moduleLabel\(key\), featuresOf\(key\), permissionQuery\)\)/);
  assert.match(DIALOG, /No module or permission matches/);
});

// A large module also carries its own search once it is open, to narrow its own rows without
// touching which modules the page-wide search left on screen - smaller, and sharing the row with
// the No access/Read/Read & Write column headers on the right, rather than a row of its own.
test("a module with more than 8 sub-modules also carries its own search, on the same row as the column headers", () => {
  assert.match(DIALOG, /features\.length > 8\s*\?\s*<div className="w-full sm:w-80">/);
  assert.match(DIALOG, /<SearchField\s+value=\{localQuery\}\s+onChange=\{setLocalQuery\}\s+preventSubmit\s+ariaLabel=\{`Search \$\{label\} sub-modules`\}/);
});

test("the search sits left, the No access/Read/Read & Write headers right, in one row", () => {
  const row = DIALOG.slice(DIALOG.indexOf('<div className={`flex-wrap items-end justify-between gap-3 border-b'), DIALOG.indexOf("{localTerm && shownFeatures.length === 0"));
  assert.match(row, /features\.length > 8/);
  assert.match(row, /ACCESS_LEVELS\.map/);
});

test("a module with 8 or fewer sub-modules shows no row at all on a phone - there is no search to show there", () => {
  assert.match(DIALOG, /\$\{features\.length > 8 \? "flex" : "hidden sm:flex"\}/);
});

test("the module's own search clears when the module is put away", () => {
  assert.match(DIALOG, /const showSection = \(next\) => \{\s*setExpanded\(next\);\s*if \(!next\) setLocalQuery\(""\);\s*\};/);
});

test("the module's own search narrows rows by name or stored key, without the module-name shortcut", () => {
  assert.match(DIALOG, /const localTerm = localQuery\.trim\(\)\.toLocaleLowerCase\(\);/);
  assert.match(DIALOG, /shownFeatures = localTerm\s*\?\s*pageFilteredFeatures\.filter/);
  // Word Chunk Search, the same as the page-wide search.
  assert.match(DIALOG, /\.some\(\(text\) => matchesWordChunks\(text, localTerm\)\)/);
});

test("an empty result from the module's own search says so", () => {
  assert.match(DIALOG, /No \{label\} sub-modules match/);
});

test("pressing Enter in the search does not save the role", () => {
  const field = DIALOG.slice(DIALOG.indexOf("const permissionSearchField"), DIALOG.indexOf("const sections = ["));
  assert.match(field, /\bpreventSubmit\b/);
  assert.match(SEARCH, /if \(event\.key === "Enter"\) event\.preventDefault\(\);/);
});

test("a search opens what it finds, and a module can still be put away under it", () => {
  assert.match(DIALOG, /const open = searching \? closedUnder !== query : expanded && granting;/);
});

test("the panel is not locked whole, so a viewer can still search and open modules", () => {
  const panel = DIALOG.slice(DIALOG.indexOf("return <SchemaFormPanel"));
  assert.doesNotMatch(panel.slice(0, panel.indexOf("/>")), /\n\s+readOnly=\{/);
});

test("the search's clear button is the Material close icon, not the browser's own", () => {
  assert.match(SEARCH, /import CloseIcon from "@\/components\/ui\/CloseIcon";/);
  assert.match(SEARCH, /\[&::-webkit-search-cancel-button\]:appearance-none/);
  // Present only while there is something to clear, named for a screen reader, and handing focus
  // back to the box.
  assert.match(SEARCH, /\{value && <IconButton/);
  assert.match(SEARCH, /label="Clear search"/);
  assert.match(SEARCH, /onChange\(""\);\s*inputRef\.current\?\.focus\(\);/);
});
