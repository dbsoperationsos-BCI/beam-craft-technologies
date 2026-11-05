-- Folds the policy layer into roles and adds permission scopes.
--
-- The policy tables are dropped only after their contents were merged into role_permission by
-- the accompanying data migration, so no grant is lost: a role absorbed the grants of every
-- policy attached to it, and every policy became a role of its own.
--
-- The sales_crm_lead.updated_at drift Prisma also reports is left alone on purpose: that column
-- is owned by migrateCrmLeadLegacyColumns(), which re-applies it on every server boot.

-- DropForeignKey
ALTER TABLE `policy_permission` DROP FOREIGN KEY `policy_permission_permission_id_fkey`;

-- DropForeignKey
ALTER TABLE `policy_permission` DROP FOREIGN KEY `policy_permission_policy_id_fkey`;

-- DropForeignKey
ALTER TABLE `role_policy` DROP FOREIGN KEY `role_policy_policy_id_fkey`;

-- DropForeignKey
ALTER TABLE `role_policy` DROP FOREIGN KEY `role_policy_role_id_fkey`;

-- AlterTable

-- DropTable
DROP TABLE `policy`;

-- DropTable
DROP TABLE `policy_permission`;

-- DropTable
DROP TABLE `role_policy`;

-- CreateTable
CREATE TABLE `permission_scope` (
    `id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `display_name` VARCHAR(150) NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `permission_scope_permission_id_idx`(`permission_id`),
    INDEX `permission_scope_is_active_idx`(`is_active`),
    UNIQUE INDEX `permission_scope_permission_id_name_key`(`permission_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permission_scope` (
    `id` VARCHAR(191) NOT NULL,
    `role_permission_id` VARCHAR(191) NOT NULL,
    `scope_id` VARCHAR(191) NOT NULL,

    INDEX `role_permission_scope_role_permission_id_idx`(`role_permission_id`),
    INDEX `role_permission_scope_scope_id_idx`(`scope_id`),
    UNIQUE INDEX `role_permission_scope_role_permission_id_scope_id_key`(`role_permission_id`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `permission_scope` ADD CONSTRAINT `permission_scope_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission_scope` ADD CONSTRAINT `role_permission_scope_role_permission_id_fkey` FOREIGN KEY (`role_permission_id`) REFERENCES `role_permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission_scope` ADD CONSTRAINT `role_permission_scope_scope_id_fkey` FOREIGN KEY (`scope_id`) REFERENCES `permission_scope`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

