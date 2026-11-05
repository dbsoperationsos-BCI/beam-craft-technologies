-- CreateTable
CREATE TABLE `ProjectPostProductionAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `shootId` VARCHAR(191) NOT NULL,
    `serviceName` VARCHAR(191) NOT NULL,
    `serviceDetails` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectPostProductionAllocation_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
    INDEX `ProjectPostProductionAllocation_shootId_deletedAt_idx`(`shootId`, `deletedAt`),
    INDEX `ProjectPostProductionAllocation_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectPostProductionAllocation` ADD CONSTRAINT `ProjectPostProductionAllocation_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `SalesProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectPostProductionAllocation` ADD CONSTRAINT `ProjectPostProductionAllocation_shootId_fkey` FOREIGN KEY (`shootId`) REFERENCES `ProjectShoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
