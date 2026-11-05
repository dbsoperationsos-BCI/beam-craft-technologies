-- Approving a Payment Request writes one Cash Entry per shoot it itemises, so the link between the
-- two moves from the request to the entry. It sat on the request as `cash_entry_id`, which could
-- name only one entry -- and, the moment the lines named different shoots, named none at all.
--
-- The entry is the child now: `cash_entry.payment_request_id`, NULL on every entry recorded by hand.

-- 1. The new column, before anything points at it.
ALTER TABLE `cash_entry` ADD COLUMN `payment_request_id` INTEGER NULL;

-- 2. Backfilled before the key is added, so the key cannot fail on data that is already there.
--    `MIN(pr.id)` rather than a plain join: the old column never stopped two requests naming one
--    entry, and an entry can carry only one request back, so the earliest claim wins rather than
--    whichever row MySQL happened to reach last. Nothing is deleted - a second claim simply is not
--    copied, and the request it belonged to keeps every other word of its record.
UPDATE `cash_entry` `ce`
  JOIN (
    SELECT `cash_entry_id`, MIN(`id`) AS `request_id`
      FROM `payment_request`
     WHERE `cash_entry_id` IS NOT NULL
     GROUP BY `cash_entry_id`
  ) `pr` ON `pr`.`cash_entry_id` = `ce`.`id`
   SET `ce`.`payment_request_id` = `pr`.`request_id`;

-- 3. Declared rather than left to the key's implicit one, so `migrate diff` reports no drift.
CREATE INDEX `cash_entry_payment_request_id_idx` ON `cash_entry`(`payment_request_id`);

ALTER TABLE `cash_entry`
  ADD CONSTRAINT `cash_entry_payment_request_id_fkey`
  FOREIGN KEY (`payment_request_id`) REFERENCES `payment_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. The old link goes. The key first: MySQL refuses to drop an index a key is still using.
ALTER TABLE `payment_request` DROP FOREIGN KEY `payment_request_cash_entry_id_fkey`;
ALTER TABLE `payment_request` DROP INDEX `payment_request_cash_entry_id_idx`;
ALTER TABLE `payment_request` DROP COLUMN `cash_entry_id`;
