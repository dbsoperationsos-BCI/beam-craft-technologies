-- Sales & CRM -> Slot Sheet: studio bookings and the studio's opening hours.
--
-- `slot_booking`: one booking - a branch (the studio), a day and whole hours (`start_hour` to
-- `end_hour`, exclusive) in 1-hour slots, for a CRM enquiry or a typed client, shot by an employee;
-- PENDING, BOOKED or CANCELLED, in a vertical (Dum Dum, Qua Qua, Corp) - or a Temporary Block
-- (`kind` BLOCK, BLOCKED until released), the hours held with no client. `slot_sheet_settings`:
-- one row, the opening hours (9 to 21 - twelve slots - until changed). New tables only; nothing
-- existing is touched.

CREATE TABLE `slot_booking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branch_id` INTEGER NOT NULL,
    `slot_date` DATE NOT NULL,
    `start_hour` INTEGER NOT NULL,
    `end_hour` INTEGER NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `enquiry_id` VARCHAR(100) NULL,
    `vertical_id` INTEGER NULL,
    `client_name` VARCHAR(150) NULL,
    `photographer_employee_id` INTEGER NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'BOOKING',
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `notes` VARCHAR(1000) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `slot_booking_branch_id_slot_date_idx`(`branch_id`, `slot_date`),
    INDEX `slot_booking_enquiry_id_idx`(`enquiry_id`),
    INDEX `slot_booking_vertical_id_idx`(`vertical_id`),
    INDEX `slot_booking_photographer_employee_id_idx`(`photographer_employee_id`),
    INDEX `slot_booking_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `slot_sheet_settings` (
    `id` VARCHAR(20) NOT NULL DEFAULT 'default',
    `open_hour` INTEGER NOT NULL DEFAULT 9,
    `close_hour` INTEGER NOT NULL DEFAULT 21,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `slot_booking` ADD CONSTRAINT `slot_booking_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `slot_booking` ADD CONSTRAINT `slot_booking_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `sales_crm_lead`(`enquiry_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `slot_booking` ADD CONSTRAINT `slot_booking_vertical_id_fkey` FOREIGN KEY (`vertical_id`) REFERENCES `vertical`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `slot_booking` ADD CONSTRAINT `slot_booking_photographer_employee_id_fkey` FOREIGN KEY (`photographer_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `slot_booking` ADD CONSTRAINT `slot_booking_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
