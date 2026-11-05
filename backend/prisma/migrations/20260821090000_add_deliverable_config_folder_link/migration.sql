-- A manual project's root folders become its derived selection items, the way an allocated
-- deliverable is a linked project's. The pointer names the folder a config row was derived from;
-- typed items and allocation-derived items leave it NULL.
ALTER TABLE `image_selection_deliverable_config` ADD COLUMN `image_selection_folder_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `image_selection_deliverable_config_image_selection_folder_i_idx` ON `image_selection_deliverable_config`(`image_selection_folder_id`);

-- CreateIndex
CREATE UNIQUE INDEX `image_selection_config_folder_unique` ON `image_selection_deliverable_config`(`image_selection_project_id`, `image_selection_folder_id`);

-- AddForeignKey
ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_image_selection_folder__fkey` FOREIGN KEY (`image_selection_folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
