-- Attendance Rules -> Irregularity penalty: extra loss-of-pay days for every working day still Absent,
-- on top of the day itself; 0 is none. And each payroll row's penalty days over its cycle, brought in
-- from attendance and added to Total Leaves. Both start at 0, so nothing changes until it is set.

ALTER TABLE `attendance_settings` ADD COLUMN `irregularity_penalty_days` DECIMAL(4, 2) NOT NULL DEFAULT 0;
ALTER TABLE `payroll_entry` ADD COLUMN `irregularity_penalty_days` DECIMAL(6, 2) NOT NULL DEFAULT 0;
