-- CreateTable
CREATE TABLE `ProjectShootDeliverable` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `shootId` VARCHAR(191) NOT NULL,
    `deliverableName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectShootDeliverable_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
    INDEX `ProjectShootDeliverable_shootId_deletedAt_idx`(`shootId`, `deletedAt`),
    INDEX `ProjectShootDeliverable_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectShootDeliverable` ADD CONSTRAINT `ProjectShootDeliverable_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `SalesProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectShootDeliverable` ADD CONSTRAINT `ProjectShootDeliverable_shootId_fkey` FOREIGN KEY (`shootId`) REFERENCES `ProjectShoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
