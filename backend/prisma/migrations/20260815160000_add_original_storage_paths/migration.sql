-- AlterTable
ALTER TABLE `ImageSelectionUpload` ADD COLUMN `originalPath` VARCHAR(1024) NULL;

-- AlterTable
ALTER TABLE `ImageSelectionSettings` ADD COLUMN `originalStoragePath` VARCHAR(500) NULL,
    ADD COLUMN `selectedOutputPath` VARCHAR(500) NULL;
