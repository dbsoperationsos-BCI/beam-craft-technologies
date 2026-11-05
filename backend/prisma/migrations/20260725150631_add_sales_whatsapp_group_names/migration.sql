-- AlterTable
ALTER TABLE `SalesProject` ADD COLUMN `whatsappGroupNameId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `SalesWhatsappGroupName` (
    `id` VARCHAR(191) NOT NULL,
    `groupType` VARCHAR(30) NOT NULL,
    `vertical` VARCHAR(30) NOT NULL,
    `generatedName` VARCHAR(500) NOT NULL,
    `branch` VARCHAR(30) NOT NULL,
    `offerName` VARCHAR(200) NULL,
    `clientName` VARCHAR(200) NULL,
    `groomName` VARCHAR(150) NULL,
    `brideName` VARCHAR(150) NULL,
    `eventName` VARCHAR(200) NULL,
    `socialMediaPosting` VARCHAR(10) NULL,
    `houseType` VARCHAR(10) NULL,
    `gou` BOOLEAN NULL,
    `place` VARCHAR(200) NOT NULL,
    `mainEventDate` DATETIME(3) NULL,
    `generatorPayload` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Available',
    `usedAt` DATETIME(3) NULL,
    `usedByProjectId` VARCHAR(191) NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesWhatsappGroupName_generatedName_key`(`generatedName`),
    INDEX `SalesWhatsappGroupName_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `SalesWhatsappGroupName_branch_idx`(`branch`),
    INDEX `SalesWhatsappGroupName_usedByProjectId_idx`(`usedByProjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `SalesProject_whatsappGroupNameId_idx` ON `SalesProject`(`whatsappGroupNameId`);
