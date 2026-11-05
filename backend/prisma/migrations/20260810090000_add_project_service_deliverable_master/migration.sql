CREATE TABLE `ProjectServiceDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectServiceDefinition_code_key`(`code`),
    UNIQUE INDEX `ProjectServiceDefinition_name_key`(`name`),
    INDEX `ProjectServiceDefinition_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProjectDeliverableDefinition` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectDeliverableDefinition_code_key`(`code`),
    UNIQUE INDEX `ProjectDeliverableDefinition_name_key`(`name`),
    INDEX `ProjectDeliverableDefinition_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProjectShootDeliverable`
    ADD COLUMN `deliverableDefinitionId` VARCHAR(191) NULL,
    ADD COLUMN `numberOfPhotos` INTEGER NULL,
    ADD COLUMN `size` VARCHAR(100) NULL,
    ADD COLUMN `remarks` TEXT NULL;

ALTER TABLE `ProjectPostProductionAllocation`
    ADD COLUMN `serviceDefinitionId` VARCHAR(191) NULL,
    ADD COLUMN `quantitySessionTiming` VARCHAR(191) NULL,
    ADD COLUMN `remarks` TEXT NULL;

CREATE INDEX `ProjectShootDeliverable_deliverableDefinitionId_idx` ON `ProjectShootDeliverable`(`deliverableDefinitionId`);
CREATE INDEX `ProjectPostProductionAllocation_serviceDefinitionId_idx` ON `ProjectPostProductionAllocation`(`serviceDefinitionId`);

ALTER TABLE `ProjectShootDeliverable`
    ADD CONSTRAINT `ProjectShootDeliverable_deliverableDefinitionId_fkey`
    FOREIGN KEY (`deliverableDefinitionId`) REFERENCES `ProjectDeliverableDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProjectPostProductionAllocation`
    ADD CONSTRAINT `ProjectPostProductionAllocation_serviceDefinitionId_fkey`
    FOREIGN KEY (`serviceDefinitionId`) REFERENCES `ProjectServiceDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
