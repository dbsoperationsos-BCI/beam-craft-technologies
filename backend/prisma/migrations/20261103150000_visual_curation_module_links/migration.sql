-- Edit Project's Linked Modules: whether two modules' projects on one photo workspace are linked.
-- Projects made together are linked and need no row; a row is written when a pair is unticked
-- (`unlinked_at` set) and cleared when it is ticked again, so the same two projects are reconnected.
-- Unlinking stops sends between the two modules only - no project, photo or result is touched.
--
-- Cost: one empty table. No existing row changes.

CREATE TABLE `visual_curation_module_link` (
  `id` VARCHAR(191) NOT NULL,
  `image_selection_project_id` VARCHAR(191) NOT NULL,
  `module_a` VARCHAR(20) NOT NULL,
  `module_b` VARCHAR(20) NOT NULL,
  `unlinked_at` DATETIME(3) NULL,
  `unlinked_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `vc_module_link_workspace_pair_unique`(`image_selection_project_id`, `module_a`, `module_b`),
  INDEX `vc_module_link_unlinked_by_user_id_idx`(`unlinked_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `visual_curation_module_link` ADD CONSTRAINT `visual_curation_module_link_image_selection_project_id_fkey`
  FOREIGN KEY (`image_selection_project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `visual_curation_module_link` ADD CONSTRAINT `visual_curation_module_link_unlinked_by_user_id_fkey`
  FOREIGN KEY (`unlinked_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
