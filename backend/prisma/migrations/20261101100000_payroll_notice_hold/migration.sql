-- Payroll rules → Hold salary during notice. Adds only: a switch (off), a mark on a separation, and a
-- "settled in" link on a payroll month. No existing row changes meaning: every switch starts off and
-- every separation starts unheld, so the register reads exactly as before until HR turns it on.

ALTER TABLE `hrm_settings` ADD COLUMN `hold_salary_during_notice` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `employee_separation` ADD COLUMN `salary_held` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `salary_held_from` DATE NULL;

ALTER TABLE `payroll_entry` ADD COLUMN `settled_in_entry_id` INTEGER NULL;
CREATE INDEX `payroll_entry_settled_in_entry_id_idx` ON `payroll_entry`(`settled_in_entry_id`);
ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_settled_in_entry_id_fkey` FOREIGN KEY (`settled_in_entry_id`) REFERENCES `payroll_entry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
