-- Send Back: a project returned from Projects to Bookings & Converted to be corrected.
--
-- `sent_back_at` and `sent_back_by_user_id` are NULL on every project that exists - none has been
-- sent back - so every project reads exactly as it did. The user who sent it back is a key to `user`,
-- cleared (not deleted with) if that user is removed.
--
-- Two nullable columns, their indexes and one foreign key added; no existing value changed.

ALTER TABLE `sales_project` ADD COLUMN `sent_back_at` DATETIME(3) NULL, ADD COLUMN `sent_back_by_user_id` INT NULL;
CREATE INDEX `sales_project_sent_back_at_idx` ON `sales_project`(`sent_back_at`);
CREATE INDEX `sales_project_sent_back_by_user_id_idx` ON `sales_project`(`sent_back_by_user_id`);
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_sent_back_by_user_id_fkey` FOREIGN KEY (`sent_back_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
