CREATE TABLE `ProjectPostProductionWorkflowDefinition` (
  `id` VARCHAR(191) NOT NULL,
  `serviceDefinitionId` VARCHAR(191) NOT NULL,
  `rawFileIn` BOOLEAN NOT NULL DEFAULT true,
  `photoSelection` BOOLEAN NULL,
  `output01` VARCHAR(191) NULL,
  `output02` VARCHAR(191) NULL,
  `output03` VARCHAR(191) NULL,
  `output04` VARCHAR(191) NULL,
  `finalFilesOut` BOOLEAN NOT NULL DEFAULT true,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProjectPostProductionWorkflowDefinition_serviceDefinitionId_key`(`serviceDefinitionId`),
  INDEX `ProjectPostProductionWorkflowDefinition_isActive_idx`(`isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProjectPostProductionWorkflowAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `shootId` VARCHAR(191) NOT NULL,
  `serviceAllocationId` VARCHAR(191) NOT NULL,
  `workflowDefinitionId` VARCHAR(191) NULL,
  `serviceName` VARCHAR(191) NOT NULL,
  `rawFileIn` BOOLEAN NOT NULL DEFAULT true,
  `photoSelection` BOOLEAN NULL,
  `output01` VARCHAR(191) NULL,
  `output02` VARCHAR(191) NULL,
  `output03` VARCHAR(191) NULL,
  `output04` VARCHAR(191) NULL,
  `finalFilesOut` BOOLEAN NOT NULL DEFAULT true,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ux_ppwa_service_deleted`(`serviceAllocationId`, `deletedAt`),
  INDEX `ProjectPostProductionWorkflowAllocation_projectId_deletedAt_idx`(`projectId`, `deletedAt`),
  INDEX `ProjectPostProductionWorkflowAllocation_shootId_deletedAt_idx`(`shootId`, `deletedAt`),
  INDEX `ProjectPostProductionWorkflowAllocation_workflowDefinitionId_idx`(`workflowDefinitionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProjectPostProductionWorkflowDefinition`
  ADD CONSTRAINT `ProjectPostProductionWorkflowDefinition_serviceDefinitionId_fkey`
  FOREIGN KEY (`serviceDefinitionId`) REFERENCES `ProjectServiceDefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProjectPostProductionWorkflowAllocation`
  ADD CONSTRAINT `ProjectPostProductionWorkflowAllocation_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `SalesProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProjectPostProductionWorkflowAllocation_shootId_fkey`
  FOREIGN KEY (`shootId`) REFERENCES `ProjectShoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ProjectPostProductionWorkflowAllocation_serviceAllocationId_fkey`
  FOREIGN KEY (`serviceAllocationId`) REFERENCES `ProjectPostProductionAllocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ppwa_workflow_def`
  FOREIGN KEY (`workflowDefinitionId`) REFERENCES `ProjectPostProductionWorkflowDefinition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
