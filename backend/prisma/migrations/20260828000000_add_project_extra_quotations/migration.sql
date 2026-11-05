-- Extra quotations, and the salary-advance column that had been missing from payment requests.
--
-- Two changes in one migration because they were written in the same branch and neither has been
-- pushed: splitting them buys nothing once they always deploy together.

-- 1. How many months a salary advance is repaid over, when the plan is "Over Several Months".
--
-- The form has always asked for it and the validation has always required it alongside that plan,
-- but the column was never added — so `paymentRequest.create()` was refused for an unknown field
-- and every payment request, of every kind, failed with a 500.
--
-- Nullable, and no backfill: the requests recorded before this either repay in one payment or are
-- not salary advances at all.
ALTER TABLE `payment_request` ADD COLUMN `repayment_months` INT NULL;

-- 2. Work agreed on top of what a project was sold for.
--
-- Its own table rather than a fifth kind of payment request: the four payment requests are the
-- studio paying somebody and approving one writes a cash entry, while an extra quotation agrees
-- work and writes nothing to the books. It carries one thing rather than a list of lines, and it is
-- decided by the manager of the project it names.
--
-- `added_at` is when the extra was agreed, as opposed to when the row was written: one agreed on
-- the shoot day is often typed in the following morning, so the form asks for the date and the
-- employee rather than assuming whoever is signed in.
CREATE TABLE `project_extra_quotation` (
    `id` VARCHAR(191) NOT NULL,
    `request_code` VARCHAR(30) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NULL,
    `service` VARCHAR(150) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `remarks` TEXT NULL,
    `requested_by_id` INTEGER NULL,
    `requested_by_name` VARCHAR(191) NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `proof` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `decision_remarks` TEXT NULL,
    `decided_by_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_extra_quotation_request_code_key`(`request_code`),
    INDEX `project_extra_quotation_project_id_status_idx`(`project_id`, `status`),
    INDEX `project_extra_quotation_status_idx`(`status`),
    INDEX `project_extra_quotation_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The project goes with the extra; a removed shoot leaves the extra on the project it belonged to.
ALTER TABLE `project_extra_quotation` ADD CONSTRAINT `project_extra_quotation_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_extra_quotation` ADD CONSTRAINT `project_extra_quotation_shoot_id_fkey`
  FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
