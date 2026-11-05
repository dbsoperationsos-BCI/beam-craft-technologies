-- Add the business-facing ID in stages so existing shoots can be backfilled safely.
ALTER TABLE `ProjectShoot` ADD COLUMN `shootId` VARCHAR(30) NULL;

UPDATE `ProjectShoot` AS `shoot`
JOIN (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `createdAt` ASC, `id` ASC) AS `sequenceNumber`
    FROM `ProjectShoot`
) AS `ordered` ON `ordered`.`id` = `shoot`.`id`
SET `shoot`.`shootId` = CONCAT('DBS-SID-', LPAD(`ordered`.`sequenceNumber`, 4, '0'));

ALTER TABLE `ProjectShoot`
    MODIFY `shootId` VARCHAR(30) NOT NULL,
    ADD UNIQUE INDEX `ProjectShoot_shootId_key`(`shootId`);

-- Continue new IDs after the highest backfilled sequence.
INSERT INTO `AppSequence` (`key`, `currentValue`, `createdAt`, `updatedAt`)
SELECT 'PROJECT_SHOOT_ID', COUNT(*), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `ProjectShoot`
ON DUPLICATE KEY UPDATE
    `currentValue` = GREATEST(`currentValue`, VALUES(`currentValue`)),
    `updatedAt` = CURRENT_TIMESTAMP(3);
