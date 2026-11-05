const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Rule 5: who changed a decision and who started a run are user ids with a key. Preference learning
 * reads feedback by user, so the link is real. A deleted user leaves the rows, without a name.
 */
const sql = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261006100000_culling_user_keys", "migration.sql"), "utf8");
const schema = () => fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("ids that name no user are cleared before the keys go on, so production data cannot fail it", () => {
  const text = sql();
  const feedbackClear = text.search(/UPDATE `image_selection_culling_feedback`[\s\S]*?SET [\s\S]*?`user_id` = NULL[\s\S]*?NOT EXISTS/);
  const sessionClear = text.search(/UPDATE `image_selection_culling_session`[\s\S]*?SET [\s\S]*?`created_by_user_id` = NULL[\s\S]*?NOT EXISTS/);
  const firstKey = text.indexOf("FOREIGN KEY");
  assert.ok(feedbackClear >= 0 && sessionClear >= 0, "both orphan clears exist");
  assert.ok(feedbackClear < firstKey && sessionClear < firstKey, "clears run before any key");
});

test("both columns get a key that lets the user go and keeps the rows", () => {
  const text = sql();
  assert.match(text, /CONSTRAINT `image_selection_culling_feedback_user_id_fkey` FOREIGN KEY \(`user_id`\) REFERENCES `user`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.match(text, /CONSTRAINT `image_selection_culling_session_created_by_user_id_fkey` FOREIGN KEY \(`created_by_user_id`\) REFERENCES `user`\(`id`\) ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.match(text, /CREATE INDEX `image_selection_culling_session_created_by_user_id_idx` ON `image_selection_culling_session`\(`created_by_user_id`\)/);
  assert.doesNotMatch(text, /DROP|DELETE FROM/i, "nothing is removed");
});

test("the schema declares the same relations", () => {
  const prisma = schema();
  assert.match(prisma, /model ImageSelectionCullingFeedback \{[\s\S]*?user\s+User\?\s+@relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(prisma, /model ImageSelectionCullingSession \{[\s\S]*?createdBy\s+User\?\s+@relation\(fields: \[createdByUserId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(prisma, /@@index\(\[createdByUserId\], map: "image_selection_culling_session_created_by_user_id_idx"\)/);
});
