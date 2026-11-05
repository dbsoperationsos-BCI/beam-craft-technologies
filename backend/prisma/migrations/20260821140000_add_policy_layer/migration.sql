-- Adds the policy layer: a named, reusable bundle of permissions that can be attached to many
-- roles. Roles keep their own `role_permission` rows as inline grants; effective access is the
-- union of the two, resolved most-permissive-wins.
--
-- The drift Prisma reports on `sales_crm_lead`.`updated_at` is deliberately NOT touched here: that
-- column is owned by migrateCrmLeadLegacyColumns(), which re-applies its own definition on every
-- server boot, so reverting it in a migration would only be undone at the next start.

-- CreateTable
CREATE TABLE `policy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `policy_name_key`(`name`),
    INDEX `policy_is_active_idx`(`is_active`),
    INDEX `policy_is_system_idx`(`is_system`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_permission` (
    `id` VARCHAR(191) NOT NULL,
    `policy_id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,
    `access_level` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `policy_permission_policy_id_idx`(`policy_id`),
    INDEX `policy_permission_permission_id_idx`(`permission_id`),
    UNIQUE INDEX `policy_permission_policy_id_permission_id_key`(`policy_id`, `permission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_policy` (
    `id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,
    `policy_id` VARCHAR(191) NOT NULL,

    INDEX `role_policy_role_id_idx`(`role_id`),
    INDEX `role_policy_policy_id_idx`(`policy_id`),
    UNIQUE INDEX `role_policy_role_id_policy_id_key`(`role_id`, `policy_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `policy_permission` ADD CONSTRAINT `policy_permission_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_permission` ADD CONSTRAINT `policy_permission_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_policy` ADD CONSTRAINT `role_policy_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_policy` ADD CONSTRAINT `role_policy_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
