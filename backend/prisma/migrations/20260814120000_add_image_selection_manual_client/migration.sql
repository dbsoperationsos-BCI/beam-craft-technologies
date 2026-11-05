-- Client details for an Image Selection project with no linked Sales Manager project.
-- Nullable with no backfill: every existing row is either a "Sales" project, which reads
-- the linked SalesProject, or a manual project that has never had a client recorded.
ALTER TABLE `ImageSelectionProject`
  ADD COLUMN `clientName` VARCHAR(191) NULL,
  ADD COLUMN `clientMainNumber` VARCHAR(30) NULL;

-- A manual project can now be sent a gallery invite, and it has no SalesProject to point at.
-- Widening the column to NULL keeps every existing notification and its foreign key intact.
ALTER TABLE `ImageSelectionWhatsAppNotification`
  MODIFY COLUMN `salesProjectId` VARCHAR(191) NULL;
