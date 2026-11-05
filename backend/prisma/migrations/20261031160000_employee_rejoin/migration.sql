-- Work history for employees who leave and come back.
--
-- One row each time somebody who had left (Relieved, Absconded, Fired, Long Leave) is brought back with
-- Move to Active. Until now the separation was deleted on rejoin and nothing kept when they had left or
-- why, so their work history was lost, and attendance and payroll counted every day they were away as
-- Absent. Adds a table only: no existing row is changed.

CREATE TABLE `employee_rejoin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `left_on` DATE NOT NULL,
    `separation_type` VARCHAR(40) NULL,
    `separation_reason` VARCHAR(150) NULL,
    `detailed_reason` TEXT NULL,
    `rejoined_on` DATE NOT NULL,
    `reason` TEXT NOT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_rejoin_employee_id_rejoined_on_idx`(`employee_id`, `rejoined_on`),
    INDEX `employee_rejoin_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_rejoin` ADD CONSTRAINT `employee_rejoin_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `employee_rejoin` ADD CONSTRAINT `employee_rejoin_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
