-- CRM leads put on the Watchers list.
--
-- The snapshot column holds the lead as it read when it was added, rather than the row
-- pointing at the live lead. Watchers exists to keep an eye on a few enquiries without
-- touching them, so what it shows must not drift as the lead is worked on elsewhere.
--
-- `enquiryId` is unique: a lead is either watched or it is not, and adding it again refreshes
-- the copy rather than stacking a second line for the same enquiry.
CREATE TABLE `SalesCrmLeadWatch` (
  `id` VARCHAR(191) NOT NULL,
  `enquiryId` VARCHAR(100) NOT NULL,
  `branch` VARCHAR(60) NULL,
  `leadName` VARCHAR(191) NULL,
  `phone` VARCHAR(60) NULL,
  `leadStatus` VARCHAR(60) NULL,
  `snapshot` LONGTEXT NOT NULL,
  `addedByUserId` INTEGER NULL,
  `addedByName` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SalesCrmLeadWatch_enquiryId_key` (`enquiryId`),
  INDEX `SalesCrmLeadWatch_createdAt_idx` (`createdAt`),
  INDEX `SalesCrmLeadWatch_branch_idx` (`branch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
