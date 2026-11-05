-- Comp-Off credit approval: a weekly off or holiday worked earns a comp-off only once every Leave
-- Approver has approved the COMP_OFF_CREDIT request attendance raises for it.
--
-- `comp_off_approval_from` is set to the day this migration runs - in India (+05:30), whatever the
-- database server's own time zone - so every day worked before it keeps
-- the rule it was earned under (attendance alone) - nobody loses a comp-off they were already shown.
-- `credit_key` is NULL on every existing request (no COMP_OFF_CREDIT exists yet); its unique index
-- holds one credit request per employee and day worked.
--
-- Two columns added and one new column filled; no existing value is changed or removed.

ALTER TABLE `attendance_settings` ADD COLUMN `comp_off_approval_from` DATE NULL;
UPDATE `attendance_settings` SET `comp_off_approval_from` = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) WHERE `comp_off_approval_from` IS NULL;

ALTER TABLE `attendance_request` ADD COLUMN `credit_key` VARCHAR(40) NULL;
CREATE UNIQUE INDEX `attendance_request_credit_key_key` ON `attendance_request`(`credit_key`);
