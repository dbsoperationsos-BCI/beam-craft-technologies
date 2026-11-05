-- AlterTable
ALTER TABLE `user` ADD COLUMN `branch_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `user_group` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `branch_id` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_group_branch_id_idx`(`branch_id`),
    INDEX `user_group_is_active_idx`(`is_active`),
    UNIQUE INDEX `user_group_name_branch_id_key`(`name`, `branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_group_member` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_group_member_groupId_idx`(`groupId`),
    INDEX `user_group_member_userId_idx`(`userId`),
    UNIQUE INDEX `user_group_member_userId_groupId_key`(`userId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_admin` BOOLEAN NOT NULL DEFAULT false,
    `is_branch_manager` BOOLEAN NOT NULL DEFAULT false,
    `is_department_lead` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `role_name_key`(`name`),
    INDEX `role_is_active_idx`(`is_active`),
    INDEX `role_is_system_idx`(`is_system`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission` (
    `id` VARCHAR(191) NOT NULL,
    `module` VARCHAR(50) NOT NULL,
    `feature` VARCHAR(100) NOT NULL,
    `level` VARCHAR(50) NOT NULL,
    `description` TEXT NULL,
    `display_name` VARCHAR(150) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `permission_module_idx`(`module`),
    INDEX `permission_is_active_idx`(`is_active`),
    UNIQUE INDEX `permission_module_feature_level_key`(`module`, `feature`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permission` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,
    `access_level` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `role_permission_roleId_idx`(`roleId`),
    INDEX `role_permission_permissionId_idx`(`permissionId`),
    UNIQUE INDEX `role_permission_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_group_role` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,

    INDEX `user_group_role_groupId_idx`(`groupId`),
    INDEX `user_group_role_roleId_idx`(`roleId`),
    UNIQUE INDEX `user_group_role_groupId_roleId_key`(`groupId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `user_branch_id_idx` ON `user`(`branch_id`);

-- CreateIndex
CREATE INDEX `user_role_idx` ON `user`(`role`);

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group` ADD CONSTRAINT `user_group_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `user_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission` ADD CONSTRAINT `role_permission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permission` ADD CONSTRAINT `role_permission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_role` ADD CONSTRAINT `user_group_role_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `user_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group_role` ADD CONSTRAINT `user_group_role_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
