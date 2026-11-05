const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Similarity v2 adds three nullable columns to the result row and nothing else: the structure
 * signature beside the hash, and a rank inside each of the two group types.
 */
const dir = path.join(__dirname, "..", "prisma", "migrations", "20261002210000_culling_similarity_v2");
const sql = () => fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
const schema = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("the result row gains a structure signature and a rank per group type, all nullable", () => {
  const text = sql();
  assert.match(text, /ALTER TABLE `image_selection_culling_result` ADD COLUMN `structure_signature` VARCHAR\(64\) NULL/);
  assert.match(text, /ADD COLUMN `duplicate_rank` INT(EGER)? NULL/);
  assert.match(text, /ADD COLUMN `burst_rank` INT(EGER)? NULL/);
  assert.doesNotMatch(text, /^\s*(DROP|DELETE FROM|UPDATE )/im, "additive only");
});

test("the schema names the same columns in camelCase with their snake_case maps", () => {
  const text = schema();
  assert.match(text, /structureSignature\s+String\?\s+@map\("structure_signature"\) @db\.VarChar\(64\)/);
  assert.match(text, /duplicateRank\s+Int\?\s+@map\("duplicate_rank"\)/);
  assert.match(text, /burstRank\s+Int\?\s+@map\("burst_rank"\)/);
});
