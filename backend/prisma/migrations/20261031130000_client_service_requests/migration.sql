-- Client requests: a client asks, from their app, to add something from the studio's list of services
-- and deliverables to their booking, to change something they have, or a question about it. The team
-- answers on Client Management -> Client Requests; one accepted at a price becomes an extra quotation.
--
-- A new table and the `CLIENT / Client Requests` permission (Read to see them, Read / Write to answer),
-- granted Read / Write to SUPER_ADMIN only. Nothing existing is changed.

CREATE TABLE `client_service_request` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `project_id` VARCHAR(191) NOT NULL,
  `shoot_id` VARCHAR(191) NULL,
  `client_user_id` INTEGER NULL,
  `kind` VARCHAR(10) NOT NULL,
  `item_type` VARCHAR(15) NOT NULL,
  `catalog_id` VARCHAR(64) NULL,
  `item_ref_id` VARCHAR(64) NULL,
  `item_name` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `note` TEXT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
  `price` DECIMAL(12, 2) NULL,
  `reply` TEXT NULL,
  `extra_quotation_id` VARCHAR(64) NULL,
  `decided_by` INTEGER NULL,
  `decided_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `client_service_request_project_idx`(`project_id`, `created_at`),
  INDEX `client_service_request_status_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `client_service_request_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'CLIENT', 'Client Requests', 'CLIENT_REQUEST_MANAGE', 'Client Requests', 'Requests clients raise from their app about their services and deliverables: see them (Read), and answer them (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'CLIENT' AND `existing`.`feature` = 'Client Requests' AND `existing`.`level` = 'CLIENT_REQUEST_MANAGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'CLIENT' AND `permission`.`feature` = 'Client Requests' AND `permission`.`level` = 'CLIENT_REQUEST_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
