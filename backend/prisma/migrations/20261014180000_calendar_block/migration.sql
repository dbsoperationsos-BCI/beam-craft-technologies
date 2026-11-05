-- Calendar -> a day's ⋮ -> Block Period: a branch's hours on one day, held with nothing booked in
-- them, from a start to an end time and why. Behind `SALES / Block Period` - written here as well as
-- in `seeds/permission-catalogue.js` because the seed cannot be run on production (IAM.md step 10).
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration -> Roles for the roles whose people
-- should see or block periods, and re-save them.
--
-- Cost: one new, empty table, one permission row and one grant. Instant.

CREATE TABLE `calendar_block` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branch_id` INTEGER NOT NULL,
    `block_date` DATE NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `calendar_block_branch_id_block_date_idx`(`branch_id`, `block_date`),
    INDEX `calendar_block_block_date_idx`(`block_date`),
    INDEX `calendar_block_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `calendar_block` ADD CONSTRAINT `calendar_block_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `calendar_block` ADD CONSTRAINT `calendar_block_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Block Period', 'SALES_BLOCK_PERIOD', 'Block Period',
       'Calendar: see the branches'' blocked hours (Read), and block or free them (Read / Write)',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SALES' AND `existing`.`feature` = 'Block Period' AND `existing`.`level` = 'SALES_BLOCK_PERIOD'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration -> Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SALES' AND `permission`.`feature` = 'Block Period' AND `permission`.`level` = 'SALES_BLOCK_PERIOD'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
