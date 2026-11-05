-- AlterTable
ALTER TABLE `SalesProject` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `projectStatus` VARCHAR(30) NOT NULL DEFAULT 'Yet to Start';

-- CreateIndex
CREATE INDEX `SalesProject_projectStatus_idx` ON `SalesProject`(`projectStatus`);

-- CreateIndex
CREATE INDEX `SalesProject_deletedAt_idx` ON `SalesProject`(`deletedAt`);
