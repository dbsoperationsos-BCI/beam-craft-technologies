-- Keep existing generated names intact while making newly created names time-bound.
ALTER TABLE `SalesWhatsappGroupName` ADD COLUMN `expiresAt` DATETIME(3) NULL;

-- Existing available names receive the same ten-day availability window from their creation time.
UPDATE `SalesWhatsappGroupName`
SET `expiresAt` = DATE_ADD(`createdAt`, INTERVAL 10 DAY)
WHERE `expiresAt` IS NULL AND `status` = 'Available' AND `usedAt` IS NULL;

CREATE INDEX `SalesWhatsappGroupName_status_expiresAt_idx`
ON `SalesWhatsappGroupName`(`status`, `expiresAt`);
