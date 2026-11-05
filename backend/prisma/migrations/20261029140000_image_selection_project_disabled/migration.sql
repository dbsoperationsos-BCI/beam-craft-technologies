-- Expand → a project's Enabled switch, one state for everyone. While `disabled_at` is set the
-- project takes no uploads, is not published, re-published or sent to the client, and its published
-- link is paused; nothing else about it changes. Both columns are null on every existing project,
-- so every project stays enabled. `disabled_by_user_id` says who switched it off.
ALTER TABLE `image_selection_project`
  ADD COLUMN `disabled_at` DATETIME(3) NULL,
  ADD COLUMN `disabled_by_user_id` INTEGER NULL;

CREATE INDEX `image_selection_project_disabled_by_user_id_idx` ON `image_selection_project`(`disabled_by_user_id`);

ALTER TABLE `image_selection_project` ADD CONSTRAINT `image_selection_project_disabled_by_user_id_fkey` FOREIGN KEY (`disabled_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
