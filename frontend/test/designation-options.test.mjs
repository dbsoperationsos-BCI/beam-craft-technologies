import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { designationOptions, employeeOptionResources } from "../src/constants/employeeOptions.js";

/*
 * The roles a person can be given, and the one way to add one.
 *
 * There are two lists, and only one of them is on any screen. Every field that offers a designation
 * - the employee record's own, and Intended Designation on an onboarding invite - reads the
 * `designation` table through `getMasterData`, and falls back to `designationOptions` only when that
 * table comes back empty. The studio's does not: it was seeded with 28 rows and HR maintains it from
 * Employee Repository -> Settings.
 *
 * So a role added to `designationOptions` alone appears to work in the file and appears nowhere at
 * all in the application, and a role added as a row alone leaves the fallback describing a list the
 * studio no longer has. Neither failure says anything - the dropdown simply does not have the role
 * somebody asked for. This test is the join: the two lists have to name the same designations.
 *
 * Reads the migrations rather than a database, so it runs anywhere with no MySQL.
 */

const HERE = import.meta.dirname;
const MIGRATIONS = path.join(HERE, "..", "..", "backend", "prisma", "migrations");

/** Every designation any migration seeds, by the name the dropdown would show. */
function seededDesignations() {
  const names = new Set();
  for (const entry of fs.readdirSync(MIGRATIONS)) {
    const file = path.join(MIGRATIONS, entry, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    // The statement, then the `('CODE', 'Name', ...)` tuples inside it.
    for (const statement of sql.matchAll(/INSERT IGNORE INTO `designation`[^;]*;/g)) {
      for (const row of statement[0].matchAll(/\(\s*'[A-Z0-9_]+'\s*,\s*'([^']+)'/g)) names.add(row[1]);
    }
  }
  return names;
}

test("the designation field is one of the lists HR maintains, so the table is what a screen reads", () => {
  // `fields` rather than `field`: one list can answer more than one question now, which is how
  // Work Base Location and Current Work Location are the same set of places.
  const managed = employeeOptionResources.find((option) => option.fields.includes("designation"));
  assert.ok(managed, "designation is no longer an HRM master-data resource");
  assert.equal(managed.resource, "designations");
});

test("every seeded designation is in the fallback list, and every fallback one is seeded", () => {
  const seeded = seededDesignations();
  assert.ok(seeded.size > 0, "no migration seeds the designation table any more; this test is reading the wrong thing");

  const listed = new Set(designationOptions);
  assert.deepEqual(
    [...seeded].filter((name) => !listed.has(name)),
    [],
    "a designation is seeded into the table but missing from designationOptions, so the fallback "
      + "describes a shorter list than the studio has",
  );
  assert.deepEqual(
    [...listed].filter((name) => !seeded.has(name)),
    [],
    "a designation is in designationOptions but no migration seeds it, so it appears on no screen: "
      + "the field reads the `designation` table and only falls back to this list when that is empty",
  );
});

test("the two roles the studio asked for are on both sides", () => {
  // Named outright rather than left to the sweep above, which would pass just as well if both lists
  // lost them together.
  const seeded = seededDesignations();
  for (const role of ["Production Manager", "Branch Partner"]) {
    assert.ok(designationOptions.includes(role), `designationOptions no longer offers "${role}"`);
    assert.ok(seeded.has(role), `no migration seeds "${role}", so it is on no dropdown`);
  }
});

test("no designation is listed twice", () => {
  // `Dropdown` keys its options by value, so a repeat quietly loses one of them.
  assert.equal(new Set(designationOptions).size, designationOptions.length);
});
