-- AlterTable
ALTER TABLE `SalesProject` ADD COLUMN `crdDocumentStatus` VARCHAR(50) NULL,
    ADD COLUMN `creativeManager` VARCHAR(191) NULL,
    ADD COLUMN `postProductionCoordinator` VARCHAR(191) NULL,
    ADD COLUMN `preProductionCoordinator` VARCHAR(191) NULL,
    ADD COLUMN `projectValidityMonths` INTEGER NULL,
    ADD COLUMN `storageNeeded` VARCHAR(10) NULL,
    ADD COLUMN `welcomeGift` VARCHAR(30) NULL;

-- Preserve existing project progress in the approved status vocabulary.
UPDATE `SalesProject`
SET `projectStatus` = CASE
    WHEN `projectStatus` = 'In Progress' THEN 'Work in Progress - Pre & Production'
    WHEN `projectStatus` = 'Completed' THEN 'Delivered'
    ELSE `projectStatus`
END;
