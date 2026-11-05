import test from "node:test";
import assert from "node:assert/strict";

import { loginUsername, splitEmployeeName } from "../src/lib/employeeName.mjs";

/*
 * One stored name, read two ways.
 *
 * The employee form asks for a first and last name and the login is built from the same split, so
 * these are the same rule twice over — worth pinning, because the interesting cases are all names
 * that do not have exactly two words.
 */

test("everything before the last word is the first name", () => {
  assert.deepEqual(splitEmployeeName("John Smith"), { firstName: "John", lastName: "Smith" });
  assert.deepEqual(splitEmployeeName("Rajesh Kumar Nair"), { firstName: "Rajesh Kumar", lastName: "Nair" });
});

test("a one-word name is all first name, since it is not a surname", () => {
  assert.deepEqual(splitEmployeeName("Madonna"), { firstName: "Madonna", lastName: "" });
});

test("stray whitespace does not become a name part", () => {
  assert.deepEqual(splitEmployeeName("  John   Smith  "), { firstName: "John", lastName: "Smith" });
  assert.deepEqual(splitEmployeeName(""), { firstName: "", lastName: "" });
  assert.deepEqual(splitEmployeeName(null), { firstName: "", lastName: "" });
});

test("the username is the name in the order it is written, joined by dots", () => {
  assert.equal(loginUsername("John Smith"), "john.smith");
});

test("a middle name or an initial keeps its place", () => {
  assert.equal(loginUsername("Rajesh Kumar Nair"), "rajesh.kumar.nair");
});

/*
 * The studio's own names are a given name followed by initials, and this is what the rule was
 * changed for: surname-first read the trailing initial as a surname and produced `m.dhanush.m`, a
 * username starting with a bare letter that nobody would guess at.
 */
test("a name that ends in initials is not read surname-first", () => {
  assert.equal(loginUsername("dhanush M M"), "dhanush.m.m");
  assert.equal(loginUsername("dhiveesh M"), "dhiveesh.m");
  assert.equal(loginUsername("sabari j"), "sabari.j");
});

test("a one-word name is used as it stands, with no leading or trailing dot", () => {
  assert.equal(loginUsername("Madonna"), "madonna");
});

test("punctuation in a name becomes the separator rather than reaching the username", () => {
  // The column takes letters, digits, dots, underscores and hyphens; an apostrophe is none of them.
  assert.equal(loginUsername("Mary-Jane O'Brien"), "mary.jane.o.brien");
  assert.equal(loginUsername("Anne  Marie   Fernández"), "anne.marie.fern.ndez");
});

test("a username never starts or ends with a dot", () => {
  for (const name of ["John Smith", "Madonna", "  Nair  ", "O'Brien"]) {
    const username = loginUsername(name);
    assert.equal(username.startsWith("."), false, name);
    assert.equal(username.endsWith("."), false, name);
  }
});

test("no name at all produces nothing, so the field asks rather than inventing one", () => {
  for (const value of ["", "   ", null, undefined]) assert.equal(loginUsername(value), "");
});

test("a very long name is cut to what the column holds", () => {
  const username = loginUsername(`${"Alexandrina".repeat(4)} ${"Fitzwilliam".repeat(4)}`);
  assert.equal(username.length, 50);
});
