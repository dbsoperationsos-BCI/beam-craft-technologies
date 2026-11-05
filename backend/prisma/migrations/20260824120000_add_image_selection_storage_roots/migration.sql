-- Named storage roots for Image Selection: the durable identity behind "where do the originals
-- live". Only the name and notes are stored — the per-workstation mount (Z:\ vs Y:\) is desktop
-- configuration and never reaches the database. Soft-deleted, because photo rows keep pointing at
-- a root long after the studio retires it.
CREATE TABLE `image_selection_storage_root` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `notes` VARCHAR(500) NULL,
  `deleted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `image_selection_storage_root_name_key`(`name`),
  INDEX `image_selection_storage_root_deleted_at_idx`(`deleted_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
