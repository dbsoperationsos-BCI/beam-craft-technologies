const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Phase 1 of the culling V2 work changes two things in the database, both additive: a finalized
 * session now owns the stamps it leaves on photos, and a session records when it finished seeding
 * so a retried job never pulls in photos uploaded after the run began. These pin the migration's
 * shape — the columns, the SET NULL, and that the backfills only touch rows that have no answer yet.
 */
const sql = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261002090000_culling_stamp_ownership", "migration.sql"), "utf8");

test("the stamp gains an owner: a nullable session id that clears itself when the session goes", () => {
  const text = sql();
  assert.match(text, /ALTER TABLE `image_selection_upload` ADD COLUMN `cull_rejected_session_id` VARCHAR\(191\) NULL/);
  assert.match(text, /CREATE INDEX `image_selection_upload_cull_rejected_session_id_idx`/);
  assert.match(text, /FOREIGN KEY \(`cull_rejected_session_id`\) REFERENCES `image_selection_culling_session`\(`id`\)\s+ON DELETE SET NULL/);
});

test("a session records when seeding finished, and sessions that already ran are backfilled", () => {
  const text = sql();
  assert.match(text, /ALTER TABLE `image_selection_culling_session` ADD COLUMN `seeded_at` DATETIME\(3\) NULL/);
  // A session still analyzing at deploy time may be mid-seed: it is left unseeded so its retry
  // re-covers the pages, which skipDuplicates makes free.
  assert.match(text, /UPDATE `image_selection_culling_session`[\s\S]*SET `seeded_at` = COALESCE\(`started_at`, `created_at`\)[\s\S]*WHERE `status` NOT IN \('QUEUED', 'ANALYZING'\) AND `seeded_at` IS NULL/);
});

test("existing stamps are handed to the latest finalized session that rejected the photo, and only where no owner is set", () => {
  const text = sql();
  assert.match(text, /UPDATE `image_selection_upload` u[\s\S]*SET u\.`cull_rejected_session_id` = \([\s\S]*`status` = 'FINALIZED'[\s\S]*`effective_decision` <> 'KEEP'[\s\S]*ORDER BY s\.`finalized_at` DESC, s\.`id` DESC[\s\S]*LIMIT 1[\s\S]*\)[\s\S]*WHERE u\.`cull_rejected_at` IS NOT NULL AND u\.`cull_rejected_session_id` IS NULL/);
  // A stamp no finalized session owns can never be reopened; null means eligible, so it is lifted.
  assert.match(text, /UPDATE `image_selection_upload`\s+SET `cull_rejected_at` = NULL\s+WHERE `cull_rejected_at` IS NOT NULL AND `cull_rejected_session_id` IS NULL/);
  // Nothing is dropped or rewritten.
  assert.doesNotMatch(text, /DROP|DELETE FROM/i);
});

test("every identifier the migration creates fits MySQL's 64-character limit", () => {
  for (const name of sql().match(/`[a-z_]+`/g).map((entry) => entry.slice(1, -1))) assert.ok(name.length <= 64, `${name} is ${name.length} characters`);
});
