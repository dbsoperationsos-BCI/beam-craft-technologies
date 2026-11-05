import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A module's sub-module rows can be changed whatever the module is set to. Changing one under Read
 * or Read / Write turns the module Custom, keeping the rest at the level they had; and whenever every
 * row lands on one level, the module's dropdown says that level - Read, Read / Write, or Disabled
 * when nothing is granted.
 */

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "admin", "RoleDialog.js"), "utf8");
const helper = DIALOG.slice(DIALOG.indexOf("export function settleModule"), DIALOG.indexOf("export function ModuleBlock"));
const settleModule = new Function(`${helper.replace("export ", "")}; return settleModule;`)();

const features = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("every row at Read is Read, and at Read & Write is Read / Write", () => {
  assert.deepEqual(settleModule({ a: "READ", b: "READ", c: "READ" }, features), { level: "READ", grants: {} });
  assert.deepEqual(settleModule({ a: "READ_WRITE", b: "READ_WRITE", c: "READ_WRITE" }, features), { level: "READ_WRITE", grants: {} });
});

test("every row at No access is Disabled, a row never set counting as No access", () => {
  assert.deepEqual(settleModule({ a: "DISABLED", b: "DISABLED", c: "DISABLED" }, features), { level: "DISABLED", grants: {} });
  assert.deepEqual(settleModule({ a: "DISABLED" }, features), { level: "DISABLED", grants: {} });
});

test("anything mixed is Custom, holding the rows", () => {
  const grants = { a: "READ", b: "READ_WRITE", c: "READ" };
  assert.deepEqual(settleModule(grants, features), { level: "CUSTOM", grants });
});

test("a row is changed on top of what the module already answered for every row", () => {
  const block = DIALOG.slice(DIALOG.indexOf("export function ModuleBlock"));
  assert.match(block, /const grants = Object\.fromEntries\(features\.map\(\(permission\) => \[permission\.id, levelOf\(permission\.id\)\]\)\);/);
  assert.match(block, /onChange\(settleModule\(\{ \.\.\.grants, \.\.\.levels \}, features\)\);/);
  assert.match(block, /const setAllLevels = \(accessLevel\) => setRows\(/);
});

test("the rows and the column heads are locked only for a viewer who may not edit", () => {
  const block = DIALOG.slice(DIALOG.indexOf("export function ModuleBlock"));
  assert.doesNotMatch(block, /!custom/);
  assert.match(block, /disabled=\{readOnly \|\| shownFeatures\.length === 0\}/);
  assert.match(block, /disabled=\{readOnly\}/);
});
