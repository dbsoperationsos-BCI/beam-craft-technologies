-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` DROP FOREIGN KEY `fk_ppwa_workflow_def`;

-- CreateTable
CREATE TABLE `ImageSelectionSettings` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `galleryValidityMonths` INTEGER NOT NULL DEFAULT 6,
    `defaultSelectionLimit` INTEGER NOT NULL DEFAULT 50,
    `studioName` VARCHAR(191) NOT NULL DEFAULT 'Don''t Blink Studios',
    `galleryLogoUrl` VARCHAR(500) NULL,
    `updatedByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` ADD CONSTRAINT `ProjectPostProductionWorkflowAllocation_workflowDefinitionI_fkey` FOREIGN KEY (`workflowDefinitionId`) REFERENCES `ProjectPostProductionWorkflowDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `ProjectPostProductionWorkflowAllocation` RENAME INDEX `ux_ppwa_service_deleted` TO `ProjectPostProductionWorkflowAllocation_serviceAllocationId__key`;
