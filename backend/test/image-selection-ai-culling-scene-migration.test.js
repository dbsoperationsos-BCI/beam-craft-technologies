const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Phase 6 adds a cache of the scene engine's answer per photo and engine (a photo is embedded
 * once, whatever runs come later) and four columns on the result row. Additive only.
 */
const sql = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261002230000_culling_scene", "migration.sql"), "utf8");
const schema = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("the per-photo scene cache is keyed by photo and engine and goes with the photo", () => {
  const text = sql();
  assert.match(text, /CREATE TABLE `image_selection_upload_scene`/);
  assert.match(text, /`engine_version` VARCHAR\(80\) NOT NULL/);
  assert.match(text, /`embedding` TEXT NULL/);
  assert.ok(!text.includes("scene_scores"), "only what something reads is stored");
  assert.match(text, /UNIQUE INDEX `image_selection_upload_scene_upload_id_engine_version_key`\(`upload_id`, `engine_version`\)/);
  assert.match(text, /FOREIGN KEY \(`upload_id`\) REFERENCES `image_selection_upload`\(`id`\) ON DELETE CASCADE/);
  assert.match(text, /utf8mb4_unicode_ci/);
});

test("the result row gains scene, aesthetic and composition, nullable, with a scene index for the filter", () => {
  const text = sql();
  for (const column of ["`scene_label` VARCHAR(30) NULL", "`scene_confidence` DOUBLE NULL", "`composition_score` DOUBLE NULL"]) assert.ok(text.includes(column), column);
  assert.ok(!text.includes("ADD COLUMN `aesthetic_score`"), "aesthetic_score exists since the first culling migration");
  assert.match(text, /CREATE INDEX `image_selection_culling_result_session_id_scene_label_idx` ON `image_selection_culling_result`\(`session_id`, `scene_label`\)/);
  assert.doesNotMatch(text, /^\s*(DROP|DELETE FROM|UPDATE )/im, "additive only");
  for (const name of text.match(/`[a-z_]+_(idx|key|fkey)`/g) || []) assert.ok(name.length - 2 <= 64, name);
});

test("the schema names the same columns", () => {
  const text = schema();
  assert.match(text, /model ImageSelectionUploadScene \{[\s\S]*@@unique\(\[uploadId, engineVersion\]\)[\s\S]*@@map\("image_selection_upload_scene"\)/);
  assert.match(text, /sceneLabel\s+String\?\s+@map\("scene_label"\) @db\.VarChar\(30\)/);
  assert.match(text, /aestheticScore\s+Float\?\s+@map\("aesthetic_score"\)/);
  assert.match(text, /compositionScore\s+Float\?\s+@map\("composition_score"\)/);
});
