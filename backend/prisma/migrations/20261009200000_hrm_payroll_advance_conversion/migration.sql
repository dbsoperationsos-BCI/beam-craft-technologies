-- HRM -> Payroll -> Advance Salary -> Convert to Recovery: one employee's advances, ticked together,
-- become one recovery taken back over months. Each advance keeps its row and says which recovery it
-- went into (`converted_recovery_id`, an id with its key) and when; a converted advance is no longer
-- taken back in its own month. Undoing the conversion clears both columns.
--
-- RESTRICT on the key: a recovery is never deleted outright (removing one only stamps `deleted_at`),
-- and one that advances went into must not vanish from under them.
--
-- Cost: two nullable columns, one index and one key on `payroll_advance`, every existing row left
-- NULL - nothing is converted yet. No permission change: converting asks for `HRM / Payroll Advance`
-- and `HRM / Payroll Recovery` Read / Write, both of which exist.

ALTER TABLE `payroll_advance`
    ADD COLUMN `converted_recovery_id` INTEGER NULL,
    ADD COLUMN `converted_at` DATETIME(3) NULL;

CREATE INDEX `payroll_advance_converted_recovery_id_idx` ON `payroll_advance`(`converted_recovery_id`);

ALTER TABLE `payroll_advance` ADD CONSTRAINT `payroll_advance_converted_recovery_id_fkey` FOREIGN KEY (`converted_recovery_id`) REFERENCES `payroll_recovery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
