-- Administration → User Activity Logs: one row per request a signed-in person made, written after
-- the response by `src/middleware/activityLog.js`, plus the sign-in / sign-out events.
--
-- `username` is a snapshot of the login at the time (an audit line is not a name copy and is not
-- rewritten by a rename); the current name is read through `user_id`. `branch_id` is the person's
-- home branch at the time, which is what the list narrows on. Both links are SET NULL: deleting a
-- person or a branch keeps the history.
--
-- Cost: a new, empty table. Instant.

CREATE TABLE `user_activity_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` INTEGER NULL,
    `username` VARCHAR(191) NULL,
    `branch_id` INTEGER NULL,
    `module` VARCHAR(100) NOT NULL,
    `action` VARCHAR(150) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `status_code` INTEGER NOT NULL,
    `client_ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(500) NULL,
    `duration_ms` INTEGER NULL,

    INDEX `user_activity_log_created_at_idx`(`created_at`),
    INDEX `user_activity_log_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `user_activity_log_module_created_at_idx`(`module`, `created_at`),
    INDEX `user_activity_log_branch_id_created_at_idx`(`branch_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_activity_log` ADD CONSTRAINT `user_activity_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `user_activity_log` ADD CONSTRAINT `user_activity_log_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- `ADMIN / User Activity Logs`: the permission the screen and `GET /api/admin/activity-logs` answer
-- to. Here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on
-- production; the seed upserts on `module + feature + level`, so a seeded database finds this row
-- rather than making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'ADMIN', 'User Activity Logs', 'USER_ACTIVITY_LOGS', 'User Activity Logs', 'Read the audit trail of what signed-in people did in the application: who, which screen, which action, from where, and the answer', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'ADMIN' AND `existing`.`feature` = 'User Activity Logs' AND `existing`.`level` = 'USER_ACTIVITY_LOGS'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'ADMIN' AND `permission`.`feature` = 'User Activity Logs' AND `permission`.`level` = 'USER_ACTIVITY_LOGS'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
