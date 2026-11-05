-- AI culling, phase 1 of V2: two additive columns, nothing existing rewritten.
--
-- 1. A finalized session owns the stamps it leaves. Until now `cull_rejected_at` said only THAT a
--    photo was hidden; with a project-wide run and a shoot-scoped run finalized over the same
--    photos, either one's reopen cleared the other's stamps. From here finalize stamps its own
--    session id beside the date and reopen clears only its own. SET NULL on the session: a deleted
--    session leaves the photo visible, never orphan-hidden.
ALTER TABLE `image_selection_upload` ADD COLUMN `cull_rejected_session_id` VARCHAR(191) NULL;
CREATE INDEX `image_selection_upload_cull_rejected_session_id_idx`
  ON `image_selection_upload`(`cull_rejected_session_id`);
ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_cull_rejected_session_id_fkey`
  FOREIGN KEY (`cull_rejected_session_id`) REFERENCES `image_selection_culling_session`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Photos already hidden are handed to the newest finalized session that rejected them, which is
-- the run that hid them under the old wholesale rule. Only rows with no owner are touched, so the
-- statement is safe to replay.
UPDATE `image_selection_upload` u
SET u.`cull_rejected_session_id` = (
  SELECT s.`id`
  FROM `image_selection_culling_session` s
  JOIN `image_selection_culling_result` r ON r.`session_id` = s.`id` AND r.`upload_id` = u.`id`
  WHERE s.`project_id` = u.`project_id`
    AND s.`status` = 'FINALIZED'
    AND r.`effective_decision` <> 'KEEP'
  ORDER BY s.`finalized_at` DESC, s.`id` DESC
  LIMIT 1
)
WHERE u.`cull_rejected_at` IS NOT NULL AND u.`cull_rejected_session_id` IS NULL;

-- A stamp no finalized session owns (its session deleted, its result rows gone) could never be
-- reopened again under the ownership rule. Null means eligible: the photo is shown rather than
-- hidden by nobody.
UPDATE `image_selection_upload`
SET `cull_rejected_at` = NULL
WHERE `cull_rejected_at` IS NOT NULL AND `cull_rejected_session_id` IS NULL;

-- 2. A session seeds its result rows exactly once. `seeded_at` is stamped when the worker has a
--    row for every photo the run covers; a retried job past that point analyzes what it has and
--    never pulls in photos uploaded after the run began — those are reported as not part of this
--    session instead. Every settled session seeded under the old rule, so it is marked as seeded
--    from when it started; one still analyzing at this moment may be mid-seed and is left
--    unseeded, so its retry re-covers its pages (skipDuplicates makes that free).
ALTER TABLE `image_selection_culling_session` ADD COLUMN `seeded_at` DATETIME(3) NULL;
UPDATE `image_selection_culling_session`
SET `seeded_at` = COALESCE(`started_at`, `created_at`)
WHERE `status` NOT IN ('QUEUED', 'ANALYZING') AND `seeded_at` IS NULL;
