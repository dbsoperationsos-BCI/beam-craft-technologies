CREATE TABLE `ProjectOptionSet` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectOptionSet_code_key`(`code`),
    INDEX `ProjectOptionSet_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProjectOptionSetValue` (
    `id` VARCHAR(191) NOT NULL,
    `optionSetId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectOptionSetValue_optionSetId_code_key`(`optionSetId`, `code`),
    INDEX `ProjectOptionSetValue_optionSetId_isActive_sortOrder_idx`(`optionSetId`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProjectServiceDefinition`
    ADD COLUMN `quantityMode` ENUM('NONE', 'INTEGER') NULL,
    ADD COLUMN `timingMode` ENUM('NONE', 'FULL_HALF_SESSION', 'HOURS_MINUTES', 'DAYS', 'MINUTES') NULL,
    ADD COLUMN `timingOptionSetId` VARCHAR(191) NULL,
    ADD COLUMN `sizeOptionSetId` VARCHAR(191) NULL,
    ADD COLUMN `remarksEnabled` BOOLEAN NULL;

ALTER TABLE `ProjectPostProductionAllocation`
    ADD COLUMN `quantity` INTEGER NULL,
    ADD COLUMN `sessionOptionId` VARCHAR(191) NULL,
    ADD COLUMN `durationHours` INTEGER NULL,
    ADD COLUMN `durationMinutes` INTEGER NULL,
    ADD COLUMN `workDays` INTEGER NULL,
    ADD COLUMN `timingMinutes` INTEGER NULL,
    ADD COLUMN `sizeOptionValueId` VARCHAR(191) NULL;

CREATE INDEX `ProjectServiceDefinition_timingOptionSetId_idx` ON `ProjectServiceDefinition`(`timingOptionSetId`);
CREATE INDEX `ProjectServiceDefinition_sizeOptionSetId_idx` ON `ProjectServiceDefinition`(`sizeOptionSetId`);
CREATE INDEX `ProjectPostProductionAllocation_sessionOptionId_idx` ON `ProjectPostProductionAllocation`(`sessionOptionId`);
CREATE INDEX `ProjectPostProductionAllocation_sizeOptionValueId_idx` ON `ProjectPostProductionAllocation`(`sizeOptionValueId`);

ALTER TABLE `ProjectOptionSetValue`
    ADD CONSTRAINT `ProjectOptionSetValue_optionSetId_fkey`
    FOREIGN KEY (`optionSetId`) REFERENCES `ProjectOptionSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProjectServiceDefinition`
    ADD CONSTRAINT `ProjectServiceDefinition_timingOptionSetId_fkey`
    FOREIGN KEY (`timingOptionSetId`) REFERENCES `ProjectOptionSet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ProjectServiceDefinition_sizeOptionSetId_fkey`
    FOREIGN KEY (`sizeOptionSetId`) REFERENCES `ProjectOptionSet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProjectPostProductionAllocation`
    ADD CONSTRAINT `ProjectPostProductionAllocation_sessionOptionId_fkey`
    FOREIGN KEY (`sessionOptionId`) REFERENCES `ProjectOptionSetValue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ProjectPostProductionAllocation_sizeOptionValueId_fkey`
    FOREIGN KEY (`sizeOptionValueId`) REFERENCES `ProjectOptionSetValue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

