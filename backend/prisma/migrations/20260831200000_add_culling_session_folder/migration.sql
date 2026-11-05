-- Shoot-scoped culling: a session may cover one shoot folder's subtree instead of the whole
-- project. Null keeps the old meaning (whole project), so every existing session is unchanged.
-- Cascade on the folder: a deleted shoot takes its culling runs with it — a session must never
-- silently widen to the whole project by losing its scope.
ALTER TABLE `image_selection_culling_session` ADD COLUMN `folder_id` VARCHAR(191) NULL;
-- Named by hand — the generated name would blow MySQL's 64-character identifier limit.
CREATE INDEX `image_selection_culling_session_scope_created_idx`
  ON `image_selection_culling_session`(`project_id`, `folder_id`, `created_at`);
ALTER TABLE `image_selection_culling_session` ADD CONSTRAINT `image_selection_culling_session_folder_id_fkey`
  FOREIGN KEY (`folder_id`) REFERENCES `image_selection_folder`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
