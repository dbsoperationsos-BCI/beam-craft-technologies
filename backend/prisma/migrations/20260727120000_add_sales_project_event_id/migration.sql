-- Add a nullable Event ID first so existing projects can be backfilled safely.
ALTER TABLE `SalesProject` ADD COLUMN `eventId` VARCHAR(30) NULL;

-- Existing projects receive deterministic Event IDs in created order before the
-- column becomes required and unique.
SET @sales_event_number := 0;
UPDATE `SalesProject`
SET `eventId` = CONCAT('DBS-EVT-', LPAD((@sales_event_number := @sales_event_number + 1), 5, '0'))
WHERE `eventId` IS NULL
ORDER BY `createdAt` ASC, `id` ASC;

ALTER TABLE `SalesProject` MODIFY `eventId` VARCHAR(30) NOT NULL;
CREATE UNIQUE INDEX `SalesProject_eventId_key` ON `SalesProject`(`eventId`);

-- Manual WhatsApp group names are allowed, so generated-name metadata is optional.
ALTER TABLE `SalesProject`
  MODIFY `vertical` VARCHAR(30) NULL,
  MODIFY `groupType` VARCHAR(30) NULL,
  ADD COLUMN `crmEmployeeId` INTEGER NULL;

CREATE INDEX `SalesProject_crmEmployeeId_idx` ON `SalesProject`(`crmEmployeeId`);

-- One row is atomically incremented for every server-generated Event ID.
CREATE TABLE `AppSequence` (
  `key` VARCHAR(100) NOT NULL,
  `currentValue` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `AppSequence` (`key`, `currentValue`, `createdAt`, `updatedAt`)
SELECT 'SALES_EVENT_ID', COUNT(*), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `SalesProject`
ON DUPLICATE KEY UPDATE
  `currentValue` = GREATEST(`currentValue`, VALUES(`currentValue`)),
  `updatedAt` = VALUES(`updatedAt`);
