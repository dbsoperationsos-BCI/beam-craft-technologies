-- Keep the existing assignment name snapshots and add optional Employee links.
ALTER TABLE `SalesProject`
    ADD COLUMN `projectManagerEmployeeId` INTEGER NULL,
    ADD COLUMN `preProductionCoordinatorEmployeeId` INTEGER NULL,
    ADD COLUMN `creativeManagerEmployeeId` INTEGER NULL,
    ADD COLUMN `postProductionCoordinatorEmployeeId` INTEGER NULL;

CREATE INDEX `SalesProject_projectManagerEmployeeId_idx` ON `SalesProject`(`projectManagerEmployeeId`);
CREATE INDEX `SalesProject_preProductionCoordinatorEmployeeId_idx` ON `SalesProject`(`preProductionCoordinatorEmployeeId`);
CREATE INDEX `SalesProject_creativeManagerEmployeeId_idx` ON `SalesProject`(`creativeManagerEmployeeId`);
CREATE INDEX `SalesProject_postProductionCoordinatorEmployeeId_idx` ON `SalesProject`(`postProductionCoordinatorEmployeeId`);
