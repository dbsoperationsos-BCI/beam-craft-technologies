-- Who a quotation chain has been shared with: an employee who may read and change every version of
-- it although their own scope does not reach it. Keyed on `quotation_number` - the register's row is
-- the chain, and that column is unique only with `version`, so it cannot be a foreign-key target. A
-- quotation is only ever marked deleted, so its shares stay with it, out of every register.
CREATE TABLE `sales_quotation_share` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `quotation_number` VARCHAR(30) NOT NULL,
  `employee_id` INTEGER NOT NULL,
  `employee_name` VARCHAR(191) NULL,
  `shared_by_user_id` INTEGER NULL,
  `shared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `quotation_share_number_employee_key`(`quotation_number`, `employee_id`),
  INDEX `quotation_share_employee_id_idx`(`employee_id`),
  INDEX `quotation_share_shared_by_user_id_idx`(`shared_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales_quotation_share`
  ADD CONSTRAINT `quotation_share_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sales_quotation_share`
  ADD CONSTRAINT `quotation_share_shared_by_user_id_fkey` FOREIGN KEY (`shared_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
