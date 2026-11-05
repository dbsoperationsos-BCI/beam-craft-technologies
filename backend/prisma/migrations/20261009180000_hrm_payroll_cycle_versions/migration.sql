-- Settings -> Payroll rules -> Attendance calculator, kept by month like the salary rules: the pay
-- cycle day and the payable day join `payroll_rule_version`, so a change applies from the current
-- month's payroll on and earlier months keep the days they had. A month starts the day after the
-- one before it ended, so a change of cycle day neither skips nor repeats a day.
--
-- Two columns on a table added in this release. Any version already recorded was made while the
-- days were not kept by month, so it takes the days set now - the ones every month has used.
--
-- Cost: two columns and one UPDATE over a table of a handful of rows. Instant.

ALTER TABLE `payroll_rule_version`
    ADD COLUMN `cycle_day` INTEGER NOT NULL DEFAULT 25,
    ADD COLUMN `payback_day` INTEGER NOT NULL DEFAULT 10;

UPDATE `payroll_rule_version` AS `version`
JOIN `hrm_settings` AS `settings` ON `settings`.`id` = 'default'
SET `version`.`cycle_day` = `settings`.`pay_cycle_day`,
    `version`.`payback_day` = `settings`.`payback_day`;
