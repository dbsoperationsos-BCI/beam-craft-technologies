CREATE TABLE `SalesCrmLead` (
    `enquiryId` VARCHAR(100) NOT NULL,
    `leadJson` JSON NOT NULL,
    `detailsJson` JSON NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesCrmLead_deletedAt_idx`(`deletedAt`),
    INDEX `SalesCrmLead_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`enquiryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
