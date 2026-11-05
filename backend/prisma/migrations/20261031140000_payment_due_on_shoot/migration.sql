-- Schedule Payment: a payment whose date is not known follows a shoot instead - Before, On or After
-- it, by a number of days. `due_date` is still the date everything reads; it is worked out from the
-- shoot and kept in step when the shoot's date changes (`services/shootLinkedDueDates.js`).
--
-- Three nullable columns and a key on `project_payment_schedule`: every existing payment keeps its
-- date and reads as a date set by hand (`due_rule` null). A shoot hard-deleted leaves the payment
-- following nothing (SET NULL); a shoot soft-deleted is read as gone by the service.
ALTER TABLE `project_payment_schedule`
    ADD COLUMN `due_rule` VARCHAR(10) NULL,
    ADD COLUMN `due_shoot_id` VARCHAR(191) NULL,
    ADD COLUMN `due_offset_days` INTEGER NULL;

CREATE INDEX `project_payment_schedule_due_shoot_id_idx` ON `project_payment_schedule`(`due_shoot_id`);

ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_due_shoot_id_fkey` FOREIGN KEY (`due_shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
