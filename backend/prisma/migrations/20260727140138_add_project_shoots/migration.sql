-- CreateTable
CREATE TABLE `ProjectShoot` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `dateCreated` DATETIME(3) NOT NULL,
    `shoot` VARCHAR(100) NOT NULL,
    `shootPlace` VARCHAR(191) NOT NULL,
    `district` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectShoot_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
    INDEX `ProjectShoot_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectShoot` ADD CONSTRAINT `ProjectShoot_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `SalesProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
