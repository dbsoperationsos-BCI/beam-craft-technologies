-- A user carries roles directly; the user-group layer is removed.
--
-- The roles a user reached through a group are copied onto them first, so nobody loses access in
-- the move. The group tables are dropped only after that copy.
--
-- Two tables Prisma also reports are deliberately untouched, because neither is owned by the
-- schema: `sales_crm_lead`.`updated_at` is re-applied by migrateCrmLeadLegacyColumns() on every
-- boot, and `SalesCrmWhatsAppSetting` is created at runtime by the WhatsApp chat repository.

-- CreateTable
CREATE TABLE `user_role` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,

    INDEX `user_role_user_id_idx`(`user_id`),
    INDEX `user_role_role_id_idx`(`role_id`),
    UNIQUE INDEX `user_role_user_id_role_id_key`(`user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_role` ADD CONSTRAINT `user_role_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role` ADD CONSTRAINT `user_role_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every role a user reached through a group onto the user itself, before the groups go.
INSERT IGNORE INTO `user_role` (`id`, `user_id`, `role_id`)
SELECT CONCAT('mig', LPAD(ROW_NUMBER() OVER (), 22, '0')), m.`userId`, r.`roleId`
FROM `user_group_member` m
JOIN `user_group_role` r ON r.`groupId` = m.`groupId`;

-- DropForeignKey / DropTable
ALTER TABLE `user_group_member` DROP FOREIGN KEY `user_group_member_userId_fkey`;
ALTER TABLE `user_group_member` DROP FOREIGN KEY `user_group_member_groupId_fkey`;
ALTER TABLE `user_group_role` DROP FOREIGN KEY `user_group_role_groupId_fkey`;
ALTER TABLE `user_group_role` DROP FOREIGN KEY `user_group_role_roleId_fkey`;
ALTER TABLE `user_group` DROP FOREIGN KEY `user_group_branch_id_fkey`;
DROP TABLE `user_group_member`;
DROP TABLE `user_group_role`;
DROP TABLE `user_group`;
