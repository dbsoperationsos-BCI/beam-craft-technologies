-- CreateTable
CREATE TABLE `ProjectAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `storedName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NOT NULL,
    `filePath` VARCHAR(500) NOT NULL,
    `uploadedByUserId` INTEGER NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectAttachment_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
    INDEX `ProjectAttachment_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectAttachment` ADD CONSTRAINT `ProjectAttachment_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `SalesProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
