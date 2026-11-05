-- A project's payment schedule, saved at last, and worked on Accounts Manager.
--
-- The Schedule Payment rows on Create Project and Start / Edit Project lived only in the open form
-- and the browser's draft; nothing reached the database. `project_payment_schedule` holds them, one
-- row per payment: its category (linked to Field Settings where it is one), due date, share of the
-- signed quotation, remarks, a hold with its remarks, a follow-up date with its remarks (which Due and
-- Overdue then go by), and - after a part payment - the remainder
-- split off it. `cash_entry.payment_schedule_id` links the receipt that clears it.
--
-- Plain CREATE TABLE on purpose: if a table of that name already exists the migration stops here,
-- before anything is changed, rather than mixing into it.
--
-- No permission of its own: the payments are worked on Accounts Manager under ACCOUNTS / Cash
-- Management, the permission that already records the cash that clears them.
--
-- Cost: one empty table, one nullable column and index on cash_entry. Instant.

-- AlterTable
ALTER TABLE `cash_entry` ADD COLUMN `payment_schedule_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `project_payment_schedule` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `category_id` INTEGER NULL,
    `category` VARCHAR(120) NOT NULL,
    `due_date` DATETIME(3) NULL,
    `percentage` DECIMAL(12, 6) NULL,
    `amount` DECIMAL(12, 2) NULL,
    `remarks` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `split_from_id` VARCHAR(191) NULL,
    `hold_at` DATETIME(3) NULL,
    `hold_remarks` TEXT NULL,
    `hold_by_user_id` INTEGER NULL,
    `followup_date` DATETIME(3) NULL,
    `followup_remarks` TEXT NULL,
    `followup_at` DATETIME(3) NULL,
    `followup_by_user_id` INTEGER NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

INDEX `project_payment_schedule_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `project_payment_schedule_due_date_idx`(`due_date`),
    INDEX `project_payment_schedule_category_id_idx`(`category_id`),
    INDEX `project_payment_schedule_split_from_id_idx`(`split_from_id`),
    INDEX `project_payment_schedule_hold_by_user_id_idx`(`hold_by_user_id`),
    INDEX `project_payment_schedule_followup_by_user_id_idx`(`followup_by_user_id`),
    INDEX `project_payment_schedule_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `cash_entry_payment_schedule_id_idx` ON `cash_entry`(`payment_schedule_id`);

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `payment_schedule_category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_split_from_id_fkey` FOREIGN KEY (`split_from_id`) REFERENCES `project_payment_schedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_hold_by_user_id_fkey` FOREIGN KEY (`hold_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_followup_by_user_id_fkey` FOREIGN KEY (`followup_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_payment_schedule` ADD CONSTRAINT `project_payment_schedule_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_entry` ADD CONSTRAINT `cash_entry_payment_schedule_id_fkey` FOREIGN KEY (`payment_schedule_id`) REFERENCES `project_payment_schedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
