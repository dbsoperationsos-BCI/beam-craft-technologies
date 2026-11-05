-- Vendors → Add Vendor → Capabilities → Supported Branches: the studio's branches a vendor works for.
--
-- Several per vendor, held as a row per vendor and branch rather than as names in a column: a branch
-- is an id with a key (Rule 5), so renaming a branch needs nothing here and asking "which vendors
-- support Erode" is an index read on `branch_id`.
--
-- Cascades both ways - a vendor or a branch removed takes its rows with it.
--
-- A new, empty table: no existing row is read or changed, so nothing about production data can make
-- this fail. Every vendor starts with no supported branches until somebody edits it.
--
-- No permission changes: the field is part of the same Vendor form and endpoints, guarded as before.
--
-- Cost: one CREATE TABLE and two foreign keys on an empty table. Instant.

-- CreateTable
CREATE TABLE `vendor_branch` (
    `vendor_id` INTEGER NOT NULL,
    `branch_id` INTEGER NOT NULL,
    INDEX `vendor_branch_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`vendor_id`, `branch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `vendor_branch` ADD CONSTRAINT `vendor_branch_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vendor_branch` ADD CONSTRAINT `vendor_branch_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
