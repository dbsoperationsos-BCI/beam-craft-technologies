-- Version-wise quotations, grouped by enquiry.
--
-- `quotation_number` stops being unique: it now names the chain and is shared by every version of
-- it, while `quotation_id` carries the version suffix and stays the unique reference.

ALTER TABLE `sales_quotation`
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `link_expires_at` DATETIME(3) NULL,
  ADD COLUMN `link_renewed_at` DATETIME(3) NULL;

-- Every quotation raised before this is version one of its own chain, and its id gains the suffix
-- that says so. `quotation_number` was unique, so the concatenation is unique too.
UPDATE `sales_quotation` SET `quotation_id` = CONCAT(`quotation_number`, '-01');

-- Their links keep the five-day rule from the day they were raised, which for anything older than
-- five days means an expired link somebody can re-enable — not a link that silently stays open.
UPDATE `sales_quotation` SET `link_expires_at` = DATE_ADD(`created_at`, INTERVAL 5 DAY);

DROP INDEX `sales_quotation_quotation_number_key` ON `sales_quotation`;
CREATE UNIQUE INDEX `sales_quotation_quotation_number_version_key` ON `sales_quotation`(`quotation_number`, `version`);
CREATE INDEX `sales_quotation_quotation_number_idx` ON `sales_quotation`(`quotation_number`);
