-- Initialise the shared employee sequence from existing DBS-formatted IDs.
INSERT INTO `AppSequence` (`key`, `currentValue`, `createdAt`, `updatedAt`)
SELECT 'EMPLOYEE_ID', COALESCE(MAX(CAST(SUBSTRING(`employeeId`, 4) AS UNSIGNED)), 0), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Employee`
WHERE `employeeId` REGEXP '^DBS[0-9]+$'
ON DUPLICATE KEY UPDATE `currentValue` = GREATEST(`currentValue`, VALUES(`currentValue`));

-- Older records with an empty identifier are backfilled once, without changing existing IDs.
SET @employee_id_sequence := (SELECT `currentValue` FROM `AppSequence` WHERE `key` = 'EMPLOYEE_ID');
UPDATE `Employee`
SET `employeeId` = CONCAT('DBS', LPAD((@employee_id_sequence := @employee_id_sequence + 1), 3, '0'))
WHERE `employeeId` = '';
UPDATE `AppSequence` SET `currentValue` = @employee_id_sequence WHERE `key` = 'EMPLOYEE_ID';
