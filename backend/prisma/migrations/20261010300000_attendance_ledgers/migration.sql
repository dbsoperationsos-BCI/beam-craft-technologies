-- Attendance ledgers: a stored record of each employee's Casual Leave, permissions and comp-offs.
--
-- The rules stay where they are - the balance, the permission limit and comp-off eligibility are still
-- worked out from the requests, attendance and Attendance Rules - and these tables keep what that comes
-- to, so it can be read back, reported and audited:
--
--   casual_leave_ledger  one row per employee per Casual Leave period (a month, or a pay cycle):
--                        opening balance, credited, taken, Loss of Pay, closing balance
--   permission_ledger    one row per permission request: its day, its period, its minutes, its
--                        status, and whether it counts toward the period's limit
--   comp_off_ledger      one row per weekly off or holiday worked a full day (or claimed): the hours,
--                        when it expires, and whether it is available, claimed, used or expired
--
-- An employee's rows are written again whenever something of theirs changes - a request raised,
-- edited, decided, sent back, reverted or deleted, a logout - and everybody's when Attendance Rules or
-- the holidays change. Who decided what, and when, stays on the request's own history
-- (`attendance_request_event`). Empty until filled: `node scripts/rebuild-attendance-ledgers.js` fills
-- them for everybody once (it writes these three tables only).
--
-- Cost: three new tables, with their keys and indexes. No existing row is touched.

CREATE TABLE `casual_leave_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `period_from` DATE NOT NULL,
    `period_to` DATE NOT NULL,
    `counted_by` VARCHAR(20) NOT NULL,
    `opening` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `credited` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `taken` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `loss_of_pay` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `closing` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `casual_leave_ledger_employee_id_period_key`(`employee_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permission_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `request_id` INTEGER NOT NULL,
    `permission_date` DATE NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `period_from` DATE NOT NULL,
    `period_to` DATE NOT NULL,
    `counted_by` VARCHAR(20) NOT NULL,
    `minutes` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL,
    `counts_toward_limit` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permission_ledger_request_id_key`(`request_id`),
    INDEX `permission_ledger_employee_id_period_idx`(`employee_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `comp_off_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `worked_date` DATE NOT NULL,
    `worked_minutes` INTEGER NOT NULL DEFAULT 0,
    `expires_on` DATE NULL,
    `status` VARCHAR(20) NOT NULL,
    `request_id` INTEGER NULL,
    `day_off` DATE NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `comp_off_ledger_employee_id_worked_date_key`(`employee_id`, `worked_date`),
    INDEX `comp_off_ledger_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `casual_leave_ledger` ADD CONSTRAINT `casual_leave_ledger_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `permission_ledger` ADD CONSTRAINT `permission_ledger_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `permission_ledger` ADD CONSTRAINT `permission_ledger_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `attendance_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `comp_off_ledger` ADD CONSTRAINT `comp_off_ledger_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `comp_off_ledger` ADD CONSTRAINT `comp_off_ledger_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `attendance_request`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
