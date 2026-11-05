-- Finalize / Unfinalize on a quotation version. A version is finalized while `finalized_at` is set and
-- `unfinalized_at` is not; "previously finalized" when both are. Nullable and empty for every existing
-- row, so every quotation reads exactly as it did: not finalized, its link on its own clock.

-- AlterTable
ALTER TABLE `sales_quotation`
    ADD COLUMN `finalized_at` DATETIME(3) NULL,
    ADD COLUMN `finalized_by_user_id` INTEGER NULL,
    ADD COLUMN `unfinalized_at` DATETIME(3) NULL,
    ADD COLUMN `unfinalized_by_user_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `sales_quotation_finalized_by_user_id_idx` ON `sales_quotation`(`finalized_by_user_id`);

-- CreateIndex
CREATE INDEX `sales_quotation_unfinalized_by_user_id_idx` ON `sales_quotation`(`unfinalized_by_user_id`);

-- AddForeignKey
ALTER TABLE `sales_quotation` ADD CONSTRAINT `sales_quotation_finalized_by_user_id_fkey` FOREIGN KEY (`finalized_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quotation` ADD CONSTRAINT `sales_quotation_unfinalized_by_user_id_fkey` FOREIGN KEY (`unfinalized_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
