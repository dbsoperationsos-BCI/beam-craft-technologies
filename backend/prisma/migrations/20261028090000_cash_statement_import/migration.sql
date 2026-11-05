-- Accounts Manager -> Import from PDF.
--
-- `cash_statement_import` remembers each PDF read by the SHA-256 of its bytes, so the same statement
-- uploaded again under another name is recognised. Neither the file nor its password is kept.
--
-- The index on `cash_entry.transaction_id` is what the import looks a statement's references up by,
-- to mark the payments already recorded as duplicates.
--
-- A new table and an index: no existing row is changed, so there is nothing to fail on production data.

CREATE TABLE `cash_statement_import` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `file_hash` CHAR(64) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `transaction_count` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cash_statement_import_file_hash_key`(`file_hash`),
    INDEX `cash_statement_import_uploaded_by_idx`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cash_statement_import` ADD CONSTRAINT `cash_statement_import_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `cash_entry_transaction_id_idx` ON `cash_entry`(`transaction_id`);
