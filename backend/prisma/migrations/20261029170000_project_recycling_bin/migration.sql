-- Resource Management -> Recycling Bin: a deleted project waits here until it is restored or
-- deleted permanently.
--
-- `deleted_by_user_id` is who moved the project to the bin - a key to `user`, cleared (not deleted
-- with) if that user is removed. `client_login_deactivated_on_delete` records whether the delete
-- itself switched the client's login off, so Restore switches back on only that login.
--
-- Both are NULL / false on every project that exists, so every project reads exactly as it did; a
-- project deleted before this change shows in the bin with no "Deleted by". Two columns, one index
-- and one foreign key added; no existing value changed.

ALTER TABLE `sales_project`
  ADD COLUMN `deleted_by_user_id` INT NULL,
  ADD COLUMN `client_login_deactivated_on_delete` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `sales_project_deleted_by_user_id_idx` ON `sales_project`(`deleted_by_user_id`);
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_deleted_by_user_id_fkey` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- `ASSET / Recycling Bin`: Read to see the deleted projects, Read / Write to restore them or delete
-- them permanently.
--
-- Here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on production;
-- the seed upserts on `module + feature + level`, so a seeded database finds this row rather than
-- making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'ASSET', 'Recycling Bin', 'RECYCLING_BIN_MANAGE', 'Recycling Bin', 'Deleted projects: see them (Read), and restore them or delete them permanently with their photos (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'ASSET' AND `existing`.`feature` = 'Recycling Bin' AND `existing`.`level` = 'RECYCLING_BIN_MANAGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'ASSET' AND `permission`.`feature` = 'Recycling Bin' AND `permission`.`level` = 'RECYCLING_BIN_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
