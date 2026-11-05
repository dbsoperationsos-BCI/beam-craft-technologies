const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Phase 8 stores two things: each photographer's switch and reset point for learned preferences,
 * and the profile a run used (so a run is reproducible and never re-interpreted). Additive only.
 */
const sql = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261006090000_culling_preferences", "migration.sql"), "utf8");
const schema = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("one preference row per photographer, going with the user", () => {
  const text = sql();
  assert.match(text, /CREATE TABLE `image_selection_culling_preference`/);
  assert.match(text, /`user_id` INTEGER NOT NULL/);
  assert.match(text, /`enabled` BOOLEAN NOT NULL DEFAULT true/);
  assert.match(text, /`reset_at` DATETIME\(3\) NULL/);
  assert.match(text, /UNIQUE INDEX `image_selection_culling_preference_user_id_key`\(`user_id`\)/);
  assert.match(text, /FOREIGN KEY \(`user_id`\) REFERENCES `user`\(`id`\) ON DELETE CASCADE/);
});

test("a run keeps the profile it used, nullable", () => {
  const text = sql();
  assert.match(text, /ALTER TABLE `image_selection_culling_session` ADD COLUMN `preference_profile` JSON NULL/);
  assert.doesNotMatch(text, /^\s*(DROP|DELETE FROM|UPDATE )/im, "additive only");
  const prisma = schema();
  assert.match(prisma, /model ImageSelectionCullingPreference \{[\s\S]*@@map\("image_selection_culling_preference"\)/);
  assert.match(prisma, /preferenceProfile\s+Json\?\s+@map\("preference_profile"\)/);
});
