-- Consolidated Image Selection migration.
-- Squashed from 17 local migrations before pushing; the statements are
-- unchanged and in their original order, so a database built from this file matches one
-- built by applying them one by one.

-- ----------------------------------------------------------------------------
-- 20260731170000_add_image_selection_projects
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionProject` (
    `id` VARCHAR(191) NOT NULL,
    `projectName` VARCHAR(500) NOT NULL,
    `sourceType` VARCHAR(20) NOT NULL DEFAULT 'Manual',
    `salesProjectId` VARCHAR(191) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'New',
    `createdByUserId` INTEGER NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ImageSelectionProject_salesProjectId_key`(`salesProjectId`),
    INDEX `ImageSelectionProject_createdAt_idx`(`createdAt`),
    INDEX `ImageSelectionProject_deletedAt_idx`(`deletedAt`),
    INDEX `ImageSelectionProject_createdByUserId_idx`(`createdByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ImageSelectionProject`
ADD CONSTRAINT `ImageSelectionProject_salesProjectId_fkey`
FOREIGN KEY (`salesProjectId`) REFERENCES `SalesProject`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 20260801120000_add_image_selection_folders
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionFolder` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `createdByUserId` INTEGER NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ImageSelectionFolder_projectId_parentId_deletedAt_idx` (`projectId`, `parentId`, `deletedAt`),
  INDEX `ImageSelectionFolder_parentId_idx` (`parentId`),
  INDEX `ImageSelectionFolder_createdAt_idx` (`createdAt`),
  CONSTRAINT `ImageSelectionFolder_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionFolder_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ImageSelectionFolder` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 20260801143000_add_image_selection_uploads
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionUpload` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `folderId` VARCHAR(191) NULL,
  `fileName` VARCHAR(500) NOT NULL,
  `storageName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `sizeBytes` BIGINT NOT NULL,
  `uploadedBytes` BIGINT NOT NULL DEFAULT 0,
  `chunkSize` INTEGER NOT NULL,
  `totalChunks` INTEGER NOT NULL,
  `uploadedChunks` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `createdByUserId` INTEGER NULL,
  `completedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ImageSelectionUpload_storageName_key` (`storageName`),
  INDEX `ImageSelectionUpload_projectId_folderId_status_idx` (`projectId`, `folderId`, `status`),
  INDEX `ImageSelectionUpload_createdAt_idx` (`createdAt`),
  CONSTRAINT `ImageSelectionUpload_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionUpload_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `ImageSelectionFolder` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 20260801170000_add_image_processing
-- ----------------------------------------------------------------------------
ALTER TABLE `ImageSelectionUpload`
  ADD COLUMN `processingError` TEXT NULL,
  ADD COLUMN `width` INTEGER NULL,
  ADD COLUMN `height` INTEGER NULL,
  ADD COLUMN `imageFormat` VARCHAR(30) NULL,
  ADD COLUMN `orientation` INTEGER NULL,
  ADD COLUMN `capturedAt` DATETIME(3) NULL,
  ADD COLUMN `cameraMake` VARCHAR(191) NULL,
  ADD COLUMN `cameraModel` VARCHAR(191) NULL,
  ADD COLUMN `metadata` JSON NULL,
  ADD COLUMN `thumbnailName` VARCHAR(191) NULL,
  ADD COLUMN `processedName` VARCHAR(191) NULL,
  ADD COLUMN `compressedSizeBytes` BIGINT NULL,
  ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
  ADD COLUMN `processingCompletedAt` DATETIME(3) NULL;

-- ----------------------------------------------------------------------------
-- 20260801200000_add_gallery_publication
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionGalleryPublication` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `tokenCipher` TEXT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PUBLISHED',
  `publishedByUserId` INTEGER NULL,
  `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ImageSelectionGalleryPublication_projectId_key` (`projectId`),
  UNIQUE INDEX `ImageSelectionGalleryPublication_tokenHash_key` (`tokenHash`),
  INDEX `ImageSelectionGalleryPublication_status_idx` (`status`),
  INDEX `ImageSelectionGalleryPublication_publishedAt_idx` (`publishedAt`),
  CONSTRAINT `ImageSelectionGalleryPublication_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 20260801220000_add_enterprise_upload_batches
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionUploadBatch` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `folderId` VARCHAR(191) NULL,
  `totalFiles` INTEGER NOT NULL,
  `uploadedFiles` INTEGER NOT NULL DEFAULT 0,
  `compressedFiles` INTEGER NOT NULL DEFAULT 0,
  `failedFiles` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(30) NOT NULL DEFAULT 'UPLOADING',
  `createdByUserId` INTEGER NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ImageSelectionUploadBatch_projectId_status_idx` (`projectId`, `status`),
  INDEX `ImageSelectionUploadBatch_folderId_idx` (`folderId`),
  INDEX `ImageSelectionUploadBatch_createdAt_idx` (`createdAt`),
  CONSTRAINT `ImageSelectionUploadBatch_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionUploadBatch_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `ImageSelectionFolder` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ImageSelectionUpload`
  ADD COLUMN `batchId` VARCHAR(191) NULL,
  ADD COLUMN `compressedName` VARCHAR(191) NULL,
  ADD COLUMN `processingAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD INDEX `ImageSelectionUpload_batchId_status_idx` (`batchId`, `status`),
  ADD CONSTRAINT `ImageSelectionUpload_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ImageSelectionUploadBatch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 20260803165030_add_pin_and_selection
-- ----------------------------------------------------------------------------
-- DropIndex on SalesWhatsappGroupName_status_createdAt_idx was here. Both this branch and
-- 20260810044848_migration_10_8_26 dropped that index independently, and MySQL has no
-- DROP INDEX IF EXISTS, so whichever ran second failed. The earlier-dated migration owns it.

-- AlterTable
ALTER TABLE `ImageSelectionGalleryPublication` ADD COLUMN `pinCipher` TEXT NULL,
    ADD COLUMN `pinHash` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `ImageSelectionUpload` ADD COLUMN `selected` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `selectedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `ImageSelectionUpload_projectId_folderId_selected_idx` ON `ImageSelectionUpload`(`projectId`, `folderId`, `selected`);

-- ----------------------------------------------------------------------------
-- 20260804104352_add_pin_and_selection
-- ----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE `ImageSelectionGalleryPublication` ADD COLUMN `selectionSubmittedAt` DATETIME(3) NULL;

-- ----------------------------------------------------------------------------
-- 20260805150000_remove_unused_image_selection_upload_fields
-- ----------------------------------------------------------------------------
ALTER TABLE `ImageSelectionUpload`
  DROP COLUMN `cameraMake`,
  DROP COLUMN `cameraModel`,
  DROP COLUMN `metadata`,
  DROP COLUMN `cancelledAt`;

-- ----------------------------------------------------------------------------
-- 20260806150000_add_image_selection_settings_and_notifications
-- ----------------------------------------------------------------------------
-- Extend existing Image Selection projects and folders without changing stored project or gallery records.
ALTER TABLE `ImageSelectionFolder` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `ImageSelectionProject`
  ADD COLUMN `allowPhotoSelection` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `lastOpenedAt` DATETIME(3) NULL,
  ADD COLUMN `publicSlug` VARCHAR(191) NULL,
  ADD COLUMN `publishVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `selectionValidUntil` DATETIME(3) NULL,
  ADD COLUMN `totalPhotoSize` BIGINT NOT NULL DEFAULT 0;

CREATE TABLE `ImageSelectionDeliverableConfig` (
  `id` VARCHAR(191) NOT NULL,
  `imageSelectionProjectId` VARCHAR(191) NOT NULL,
  `projectPostProductionAllocationId` VARCHAR(191) NULL,
  `projectShootDeliverableId` VARCHAR(191) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `selectionLimitOverride` INTEGER NULL,
  `displayOrder` INTEGER NOT NULL DEFAULT 0,
  `inactiveAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `image_selection_config_project_allocation_unique` (`imageSelectionProjectId`, `projectPostProductionAllocationId`),
  UNIQUE INDEX `image_selection_config_shoot_deliverable_unique` (`imageSelectionProjectId`, `projectShootDeliverableId`),
  INDEX `ImageSelectionDeliverableConfig_imageSelectionProjectId_enab_idx` (`imageSelectionProjectId`, `enabled`, `inactiveAt`, `displayOrder`),
  INDEX `ImageSelectionDeliverableConfig_projectPostProductionAllocat_idx` (`projectPostProductionAllocationId`),
  INDEX `ImageSelectionDeliverableConfig_projectShootDeliverableId_idx` (`projectShootDeliverableId`),
  CONSTRAINT `ImageSelectionDeliverableConfig_imageSelectionProjectId_fkey` FOREIGN KEY (`imageSelectionProjectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionDeliverableConfig_projectPostProductionAlloca_fkey` FOREIGN KEY (`projectPostProductionAllocationId`) REFERENCES `ProjectPostProductionAllocation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionDeliverableConfig_projectShootDeliverableId_fkey` FOREIGN KEY (`projectShootDeliverableId`) REFERENCES `ProjectShootDeliverable` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ImageSelectionWhatsAppNotification` (
  `id` VARCHAR(191) NOT NULL,
  `salesProjectId` VARCHAR(191) NOT NULL,
  `imageSelectionProjectId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `template` VARCHAR(191) NOT NULL,
  `recipientMasked` VARCHAR(64) NOT NULL,
  `messageSnapshot` TEXT NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `errorCode` VARCHAR(100) NULL,
  `errorMessage` TEXT NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ImageSelectionWhatsAppNotification_idempotencyKey_key` (`idempotencyKey`),
  INDEX `ImageSelectionWhatsAppNotification_salesProjectId_createdAt_idx` (`salesProjectId`, `createdAt`),
  INDEX `ImageSelectionWhatsAppNotification_imageSelectionProjectId_s_idx` (`imageSelectionProjectId`, `status`, `createdAt`),
  INDEX `ImageSelectionWhatsAppNotification_providerMessageId_idx` (`providerMessageId`),
  CONSTRAINT `ImageSelectionWhatsAppNotification_salesProjectId_fkey` FOREIGN KEY (`salesProjectId`) REFERENCES `SalesProject` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ImageSelectionWhatsAppNotification_imageSelectionProjectId_fkey` FOREIGN KEY (`imageSelectionProjectId`) REFERENCES `ImageSelectionProject` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ImageSelectionFolder_projectId_parentId_sortOrder_idx` ON `ImageSelectionFolder` (`projectId`, `parentId`, `sortOrder`);
CREATE UNIQUE INDEX `ImageSelectionProject_publicSlug_key` ON `ImageSelectionProject` (`publicSlug`);
CREATE INDEX `ImageSelectionProject_status_archivedAt_idx` ON `ImageSelectionProject` (`status`, `archivedAt`);

-- ----------------------------------------------------------------------------
-- 20260806170000_add_post_production_selection_limit
-- ----------------------------------------------------------------------------
ALTER TABLE `ProjectPostProductionAllocation`
  ADD COLUMN `selectionLimit` INTEGER NULL;

-- ----------------------------------------------------------------------------
-- 20260806171000_add_image_selection_selection_validity_enabled
-- ----------------------------------------------------------------------------
ALTER TABLE `ImageSelectionProject`
  ADD COLUMN `selectionValidityEnabled` BOOLEAN NOT NULL DEFAULT true;

-- ----------------------------------------------------------------------------
-- 20260808000000_link_image_selection_folders_to_project_shoots
-- ----------------------------------------------------------------------------
-- Keep auto-created Image Selection root folders linked to their source shoot.
-- Existing manually created folders remain unchanged because the new column is nullable.
ALTER TABLE `ImageSelectionFolder`
    ADD COLUMN `projectShootId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `ImageSelectionFolder_projectShootId_key`
    ON `ImageSelectionFolder`(`projectShootId`);

ALTER TABLE `ImageSelectionFolder`
    ADD CONSTRAINT `ImageSelectionFolder_projectShootId_fkey`
    FOREIGN KEY (`projectShootId`) REFERENCES `ProjectShoot`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 20260810120000_add_image_selection_photo_deliverable_selections
-- ----------------------------------------------------------------------------
CREATE TABLE `ImageSelectionPhotoSelection` (
  `id` VARCHAR(191) NOT NULL,
  `imageSelectionUploadId` VARCHAR(191) NOT NULL,
  `imageSelectionDeliverableConfigId` VARCHAR(191) NOT NULL,
  `selectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ISPhotoSelection_upload_config_key` (`imageSelectionUploadId`, `imageSelectionDeliverableConfigId`),
  INDEX `ISPhotoSelection_config_selected_idx` (`imageSelectionDeliverableConfigId`, `selectedAt`),
  CONSTRAINT `ISPhotoSelection_upload_fkey` FOREIGN KEY (`imageSelectionUploadId`) REFERENCES `ImageSelectionUpload` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ISPhotoSelection_config_fkey` FOREIGN KEY (`imageSelectionDeliverableConfigId`) REFERENCES `ImageSelectionDeliverableConfig` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 20260811180000_add_image_selection_r2_keys
-- ----------------------------------------------------------------------------
-- Cloudflare R2 object keys for image derivatives.
-- Nullable on purpose: images processed before the move to object storage keep their
-- keys NULL and continue to be served from local disk until they are backfilled.
ALTER TABLE `ImageSelectionUpload`
  ADD COLUMN `thumbnailKey` VARCHAR(1024) NULL,
  ADD COLUMN `previewKey` VARCHAR(1024) NULL;

-- ----------------------------------------------------------------------------
-- 20260812102754_dhanush
-- ----------------------------------------------------------------------------
-- DropForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` DROP FOREIGN KEY `ISPhotoSelection_config_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` DROP FOREIGN KEY `ISPhotoSelection_upload_fkey`;

-- AddForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` ADD CONSTRAINT `ImageSelectionPhotoSelection_imageSelectionUploadId_fkey` FOREIGN KEY (`imageSelectionUploadId`) REFERENCES `ImageSelectionUpload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` ADD CONSTRAINT `ImageSelectionPhotoSelection_imageSelectionDeliverableConfi_fkey` FOREIGN KEY (`imageSelectionDeliverableConfigId`) REFERENCES `ImageSelectionDeliverableConfig`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `ImageSelectionPhotoSelection` RENAME INDEX `ISPhotoSelection_config_selected_idx` TO `ImageSelectionPhotoSelection_imageSelectionDeliverableConfig_idx`;

-- RenameIndex
ALTER TABLE `ImageSelectionPhotoSelection` RENAME INDEX `ISPhotoSelection_upload_config_key` TO `ImageSelectionPhotoSelection_imageSelectionUploadId_imageSel_key`;

-- ----------------------------------------------------------------------------
-- 20260812150000_add_gallery_publication_expiry
-- ----------------------------------------------------------------------------
ALTER TABLE `ImageSelectionGalleryPublication`
  ADD COLUMN `expiresAt` DATETIME(3) NULL AFTER `publishedAt`;

-- Galleries published before selection links had an end date keep the same six month
-- window, counted from the day they were published.
UPDATE `ImageSelectionGalleryPublication`
  SET `expiresAt` = DATE_ADD(`publishedAt`, INTERVAL 6 MONTH)
  WHERE `expiresAt` IS NULL;
