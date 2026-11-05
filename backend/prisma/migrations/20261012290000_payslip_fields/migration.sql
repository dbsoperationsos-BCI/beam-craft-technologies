-- Settings → Payroll rules → Edit Payslip: details the studio adds to the payslip under Personal
-- details or PF details, and each employee's answer to them. New tables only - nothing existing moves.
CREATE TABLE `payslip_field` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `section` VARCHAR(20) NOT NULL,
  `label` VARCHAR(60) NOT NULL,
  `input_type` VARCHAR(10) NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `archived_at` DATETIME(3) NULL,
  `created_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payslip_field_section_label_key`(`section`, `label`),
  INDEX `payslip_field_created_by_user_id_idx`(`created_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employee_payslip_value` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `employee_id` INTEGER NOT NULL,
  `field_id` INTEGER NOT NULL,
  `value` VARCHAR(500) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `employee_payslip_value_employee_id_field_id_key`(`employee_id`, `field_id`),
  INDEX `employee_payslip_value_field_id_idx`(`field_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payslip_field` ADD CONSTRAINT `payslip_field_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `employee_payslip_value` ADD CONSTRAINT `employee_payslip_value_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_payslip_value` ADD CONSTRAINT `employee_payslip_value_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `payslip_field`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
