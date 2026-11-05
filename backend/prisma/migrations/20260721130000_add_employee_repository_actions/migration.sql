-- AlterTable
ALTER TABLE `Employee`
    ADD COLUMN `gender` VARCHAR(30) NULL,
    ADD COLUMN `workEmailId` VARCHAR(191) NULL,
    ADD COLUMN `fatherOccupation` VARCHAR(150) NULL,
    ADD COLUMN `motherOccupation` VARCHAR(150) NULL,
    ADD COLUMN `spouseName` VARCHAR(150) NULL,
    ADD COLUMN `nominee1PersonName` VARCHAR(150) NULL,
    ADD COLUMN `nominee1PersonPhone` VARCHAR(30) NULL,
    ADD COLUMN `nominee2PersonName` VARCHAR(150) NULL,
    ADD COLUMN `nominee2PersonPhone` VARCHAR(30) NULL,
    ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Employee_archivedAt_idx` ON `Employee`(`archivedAt`);
