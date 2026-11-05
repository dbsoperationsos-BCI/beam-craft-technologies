-- CreateTable
CREATE TABLE `SalesProject` (
    `id` VARCHAR(191) NOT NULL,
    `enquiryId` VARCHAR(100) NOT NULL,
    `whatsappGroupName` VARCHAR(500) NOT NULL,
    `clientMainNumber` VARCHAR(30) NOT NULL,
    `vertical` VARCHAR(30) NOT NULL,
    `sourceBranch` VARCHAR(30) NOT NULL,
    `deliverables` VARCHAR(100) NOT NULL,
    `deliverablesDetails` TEXT NULL,
    `salesPreProductionRemarks` TEXT NULL,
    `salesProductionRemarks` TEXT NULL,
    `salesPostProductionRemarks` TEXT NULL,
    `mainEventDateKnown` BOOLEAN NOT NULL DEFAULT false,
    `mainEventDate` DATETIME(3) NULL,
    `initialConvertedValue` DECIMAL(12, 2) NOT NULL,
    `crmName` VARCHAR(191) NOT NULL,
    `groupType` VARCHAR(30) NOT NULL,
    `groupNameGeneratorJson` JSON NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesProject_createdAt_idx`(`createdAt`),
    INDEX `SalesProject_enquiryId_idx`(`enquiryId`),
    INDEX `SalesProject_createdByUserId_idx`(`createdByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
