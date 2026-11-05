-- One finalized version per quotation, held by the database as well as by the app.
--
-- `finalized_chain_key` is computed by MySQL, never written: the quotation's number while this version
-- is finalized (`finalized_at` set, `unfinalized_at` not) and not deleted, NULL otherwise. A unique index
-- on it refuses a second finalized live version of the same quotation; NULLs never collide, so every
-- unfinalized version - and every version written before Finalize existed - is untouched. Different
-- quotations have different numbers, so each can have its own finalized version.
--
-- Safe on existing data: it adds a column MySQL fills itself and rewrites no stored value. It fails only
-- if a quotation already has two finalized live versions, which the app has never allowed.

-- AlterTable
ALTER TABLE `sales_quotation`
    ADD COLUMN `finalized_chain_key` VARCHAR(30) GENERATED ALWAYS AS (
        CASE WHEN `finalized_at` IS NOT NULL AND `unfinalized_at` IS NULL AND `deleted_at` IS NULL THEN `quotation_number` ELSE NULL END
    ) STORED;

-- CreateIndex
CREATE UNIQUE INDEX `sales_quotation_finalized_chain_key_key` ON `sales_quotation`(`finalized_chain_key`);
