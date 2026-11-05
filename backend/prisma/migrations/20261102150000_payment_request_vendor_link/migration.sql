-- A vendor payment names its vendor by id, not only by the name it was raised with.
--
-- The form has always picked the vendor from the register, but only `vendor_name` and
-- `vendor_phone` were stored - so "this vendor's payments" could be matched by name alone, which a
-- rename or two similar names breaks. The text columns stay as the copies the request was approved
-- with (a removed vendor still says who was paid); the link is what a vendor's payments are read by.
ALTER TABLE `payment_request` ADD COLUMN `vendor_id` INT NULL;
CREATE INDEX `payment_request_vendor_id_idx` ON `payment_request`(`vendor_id`);
ALTER TABLE `payment_request`
  ADD CONSTRAINT `payment_request_vendor_id_fkey`
  FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfilled only where the stored name belongs to exactly one live vendor. Two vendors sharing a
-- name is precisely the case a name cannot answer, so those rows are left NULL rather than guessed
-- at: the request still reads correctly from its own copy, and the link can be set by hand.
UPDATE `payment_request` `pr`
JOIN (
  SELECT `vendor_name` AS `name`, MIN(`id`) AS `id`, COUNT(*) AS `found`
  FROM `vendor`
  WHERE `is_deleted` = 0
  GROUP BY `vendor_name`
) `v` ON `v`.`name` = `pr`.`vendor_name` AND `v`.`found` = 1
SET `pr`.`vendor_id` = `v`.`id`
WHERE `pr`.`type` = 'VENDOR_PAYMENT'
  AND `pr`.`vendor_id` IS NULL
  AND `pr`.`vendor_name` IS NOT NULL
  AND `pr`.`vendor_name` <> '';
