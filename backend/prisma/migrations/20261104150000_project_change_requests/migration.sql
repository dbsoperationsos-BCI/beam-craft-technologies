-- Client Management -> Client Requests -> Raised Requests: the studio asks, for a booked project, a new
-- shoot (with its services and deliverables), services or deliverables for one of its shoots, or a
-- correction. Raised without prices behind `CLIENT / Client Requests`; priced and decided item by item
-- behind the new `CLIENT / Request Approval`; written into the project only once decided.
--
-- Three new tables and the `CLIENT / Request Approval` permission, granted Read / Write to SUPER_ADMIN
-- only. Nothing existing is changed.

-- CreateTable
CREATE TABLE `project_change_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_code` VARCHAR(30) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `request_type` VARCHAR(15) NOT NULL,
    `shoot_id` VARCHAR(191) NULL,
    `shoot_details` JSON NULL,
    `correction_category` VARCHAR(60) NULL,
    `remarks` TEXT NULL,
    `attachments` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    `version` INTEGER NOT NULL DEFAULT 0,
    `requested_by_id` INTEGER NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_by_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_remarks` TEXT NULL,
    `created_shoot_id` VARCHAR(191) NULL,
    `extra_quotation_id` VARCHAR(191) NULL,
    `task_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_change_request_request_code_key`(`request_code`),
    UNIQUE INDEX `project_change_request_created_shoot_id_key`(`created_shoot_id`),
    UNIQUE INDEX `project_change_request_extra_quotation_id_key`(`extra_quotation_id`),
    UNIQUE INDEX `project_change_request_task_id_key`(`task_id`),
    INDEX `project_change_request_project_idx`(`project_id`, `created_at`),
    INDEX `project_change_request_status_idx`(`status`, `created_at`),
    INDEX `project_change_request_shoot_idx`(`shoot_id`),
    INDEX `project_change_request_requested_by_idx`(`requested_by_id`),
    INDEX `project_change_request_reviewed_by_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_change_request_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `item_type` VARCHAR(15) NOT NULL,
    `service_definition_id` VARCHAR(191) NULL,
    `deliverable_definition_id` VARCHAR(191) NULL,
    `item_name` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `decision` VARCHAR(10) NULL,
    `approved_amount` DECIMAL(12, 2) NULL,
    `approved_quantity` INTEGER NULL,
    `manager_remarks` TEXT NULL,
    `rejection_reason` TEXT NULL,
    `decided_by_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `applied_record_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_change_request_item_request_idx`(`request_id`, `sort_order`),
    INDEX `project_change_request_item_service_idx`(`service_definition_id`),
    INDEX `project_change_request_item_deliverable_idx`(`deliverable_definition_id`),
    INDEX `project_change_request_item_decided_by_idx`(`decided_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_change_request_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `item_id` INTEGER NULL,
    `action` VARCHAR(30) NOT NULL,
    `detail` TEXT NULL,
    `changes` JSON NULL,
    `actor_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_change_request_event_request_idx`(`request_id`, `created_at`),
    INDEX `project_change_request_event_item_idx`(`item_id`),
    INDEX `project_change_request_event_actor_idx`(`actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_created_shoot_id_fkey` FOREIGN KEY (`created_shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_extra_quotation_id_fkey` FOREIGN KEY (`extra_quotation_id`) REFERENCES `project_extra_quotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `hrm_task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request` ADD CONSTRAINT `project_change_request_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_item` ADD CONSTRAINT `project_change_request_item_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `project_change_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_item` ADD CONSTRAINT `project_change_request_item_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_item` ADD CONSTRAINT `project_change_request_item_deliverable_definition_id_fkey` FOREIGN KEY (`deliverable_definition_id`) REFERENCES `project_deliverable_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_item` ADD CONSTRAINT `project_change_request_item_decided_by_id_fkey` FOREIGN KEY (`decided_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_event` ADD CONSTRAINT `project_change_request_event_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `project_change_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_event` ADD CONSTRAINT `project_change_request_event_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `project_change_request_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_change_request_event` ADD CONSTRAINT `project_change_request_event_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- CreatePermission
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'CLIENT', 'Request Approval', 'CLIENT_REQUEST_APPROVE', 'Request Approval', 'Requests the studio raises on a project (Client Requests -> Raised Requests): price each item and approve or reject it, and submit the decision that adds the approved items to the project (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'CLIENT' AND `existing`.`feature` = 'Request Approval' AND `existing`.`level` = 'CLIENT_REQUEST_APPROVE'
);

-- GrantSuperAdmin
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'CLIENT' AND `permission`.`feature` = 'Request Approval' AND `permission`.`level` = 'CLIENT_REQUEST_APPROVE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
