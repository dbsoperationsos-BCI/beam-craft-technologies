-- A service's seat may take more than one camera - a photographer carrying two bodies - so the single
-- `camera_asset_id` becomes its own table, one row per camera. Each link is an id with a key, never a
-- list in a column, and the pair is unique so the same camera cannot be added to a seat twice.
--
-- The cameras already recorded are carried over before the column goes, so nothing is lost: every
-- seat that had one ends up with exactly that one.

CREATE TABLE `project_production_service_crew_camera` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `crew_id` VARCHAR(191) NOT NULL,
    `camera_asset_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `service_crew_camera_crew_id_camera_asset_id_key`(`crew_id`, `camera_asset_id`),
    INDEX `service_crew_camera_camera_asset_id_idx`(`camera_asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- What each seat already had, as its first camera.
INSERT INTO `project_production_service_crew_camera` (`crew_id`, `camera_asset_id`, `created_at`)
SELECT `id`, `camera_asset_id`, NOW(3)
FROM `project_production_service_crew`
WHERE `camera_asset_id` IS NOT NULL;

ALTER TABLE `project_production_service_crew_camera` ADD CONSTRAINT `service_crew_camera_crew_id_fkey` FOREIGN KEY (`crew_id`) REFERENCES `project_production_service_crew`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service_crew_camera` ADD CONSTRAINT `service_crew_camera_camera_asset_id_fkey` FOREIGN KEY (`camera_asset_id`) REFERENCES `asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- And the column it replaced.
ALTER TABLE `project_production_service_crew` DROP FOREIGN KEY `project_production_service_crew_camera_asset_id_fkey`;
DROP INDEX `project_production_service_crew_camera_asset_id_idx` ON `project_production_service_crew`;
ALTER TABLE `project_production_service_crew` DROP COLUMN `camera_asset_id`;
