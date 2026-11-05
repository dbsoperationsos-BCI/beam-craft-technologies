-- A role now names the branches it reaches, so one role can grant work across several.
--
-- Existing roles are given every active branch by the accompanying backfill: before this table
-- existed a role was branch-agnostic and applied wherever its group did, so leaving them empty
-- would silently strip access from everyone already carrying one.
--
-- Two tables Prisma also reports are deliberately untouched, because neither is owned by the
-- schema: `sales_crm_lead`.`updated_at` is re-applied by migrateCrmLeadLegacyColumns() on every
-- boot, and `SalesCrmWhatsAppSetting` is created at runtime by the WhatsApp chat repository and
-- holds a live setting row.

-- AlterTable

-- DropTable

-- CreateTable
CREATE TABLE `role_branch` (
    `id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,
    `branch_id` INTEGER NOT NULL,

    INDEX `role_branch_role_id_idx`(`role_id`),
    INDEX `role_branch_branch_id_idx`(`branch_id`),
    UNIQUE INDEX `role_branch_role_id_branch_id_key`(`role_id`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_branch` ADD CONSTRAINT `role_branch_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_branch` ADD CONSTRAINT `role_branch_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

