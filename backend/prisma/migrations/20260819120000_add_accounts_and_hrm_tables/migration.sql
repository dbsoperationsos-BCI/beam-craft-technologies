-- Everything the Accounts and HRM branch adds, as one migration that runs after the schema was
-- converted to snake_case.
--
-- This replaces nineteen migrations dated 13-18 August. They were written before
-- `20260819112301_convert_to_snake_case`, so they carried camelCase table and column names and,
-- worse, were dated to run *before* the conversion — which drops and recreates every table it
-- knows about. Merged as they were, the columns they add to `employee` would have been dropped by
-- the conversion, and the tables they create hold foreign keys into `employee`, so the
-- conversion's `DROP TABLE` would have failed outright. Squashing them into one migration dated
-- after the conversion fixes both: the tables are created once, in their final shape, against a
-- database that is already snake_case.
--
-- Nothing here backfills. Two of the nineteen did — normalising `GPay` to `UPI`, and filling an
-- expense line's project from its shoot — and both targeted rows in tables this migration now
-- creates empty, so they had nothing left to do. The seed rows at the end are the exception, and
-- are kept: they are the dropdown values the employee form used to hard-code, and an employee
-- record must not point at an option the list can no longer offer.

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `aadhar_card_image_url` MEDIUMTEXT NULL,
    ADD COLUMN `pan_card_image_url` MEDIUMTEXT NULL;

-- CreateTable
CREATE TABLE `employee_review` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `review_date` DATETIME(3) NOT NULL,
    `increment_amount` DECIMAL(12, 2) NOT NULL,
    `next_review_date` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_review_employee_id_review_date_idx`(`employee_id`, `review_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_separation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `separation_type` VARCHAR(40) NOT NULL,
    `separation_reason` VARCHAR(150) NOT NULL,
    `detailed_reason` TEXT NULL,
    `employment_status` VARCHAR(30) NOT NULL,
    `previous_employment_status` VARCHAR(30) NULL,
    `resignation_date` DATETIME(3) NULL,
    `resignation_letter_name` VARCHAR(255) NULL,
    `resignation_letter_url` MEDIUMTEXT NULL,
    `proposed_last_working_date` DATETIME(3) NOT NULL,
    `notice_period_required` INTEGER NULL,
    `notice_period_served` INTEGER NULL,
    `notice_period_waived` INTEGER NULL,
    `waiver_reason` TEXT NULL,
    `early_release_requested` BOOLEAN NOT NULL DEFAULT false,
    `early_release_reason` TEXT NULL,
    `hr_remarks` TEXT NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_separation_employee_id_idx`(`employee_id`),
    INDEX `employee_separation_separation_type_idx`(`separation_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_code` VARCHAR(30) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `requested_by_id` INTEGER NULL,
    `requested_by_name` VARCHAR(191) NOT NULL,
    `requested_by_code` VARCHAR(50) NULL,
    `branch` VARCHAR(120) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NULL,
    `comments` TEXT NULL,
    `repayment_plan` VARCHAR(60) NULL,
    `settlement` VARCHAR(30) NULL,
    `vendor_name` VARCHAR(191) NULL,
    `vendor_phone` VARCHAR(30) NULL,
    `expense_date` DATETIME(3) NULL,
    `qr_code` JSON NULL,
    `bills` JSON NULL,
    `terms_accepted_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `decision_remarks` TEXT NULL,
    `decided_by_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `cash_entry_id` VARCHAR(191) NULL,
    `created_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_request_request_code_key`(`request_code`),
    INDEX `payment_request_status_created_at_idx`(`status`, `created_at`),
    INDEX `payment_request_type_status_idx`(`type`, `status`),
    INDEX `payment_request_requested_by_id_idx`(`requested_by_id`),
    INDEX `payment_request_deleted_at_idx`(`deleted_at`),
    INDEX `payment_request_cash_entry_id_idx`(`cash_entry_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_request_expense` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` INTEGER NOT NULL,
    `project_id` VARCHAR(191) NULL,
    `shoot_id` VARCHAR(191) NULL,
    `expense_date` DATETIME(3) NOT NULL,
    `expense_type` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_request_expense_request_id_idx`(`request_id`),
    INDEX `payment_request_expense_project_id_idx`(`project_id`),
    INDEX `payment_request_expense_shoot_id_idx`(`shoot_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vertical` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vertical_code_key`(`code`),
    INDEX `vertical_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `account_holder_name` VARCHAR(191) NULL,
    `account_number` VARCHAR(20) NULL,
    `ifsc_code` VARCHAR(20) NULL,
    `account_type` VARCHAR(30) NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bank_account_code_key`(`code`),
    INDEX `bank_account_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_entry` (
    `id` VARCHAR(191) NOT NULL,
    `entry_id` VARCHAR(30) NOT NULL,
    `entry_type` VARCHAR(20) NOT NULL,
    `project_id` VARCHAR(191) NULL,
    `shoot_id` VARCHAR(191) NULL,
    `client_name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `entry_date` DATETIME(3) NOT NULL,
    `branch` VARCHAR(120) NOT NULL,
    `payment_mode` VARCHAR(30) NOT NULL,
    `transaction_id` VARCHAR(100) NULL,
    `received_account` VARCHAR(120) NULL,
    `paid_from_account` VARCHAR(120) NULL,
    `paid_to` VARCHAR(191) NULL,
    `handler_employee_id` INTEGER NULL,
    `handler_name` VARCHAR(191) NOT NULL,
    `handler_is_other` BOOLEAN NOT NULL DEFAULT false,
    `description` TEXT NULL,
    `payment_proof` JSON NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_entry_entry_id_key`(`entry_id`),
    INDEX `cash_entry_deleted_at_entry_date_idx`(`deleted_at`, `entry_date`),
    INDEX `cash_entry_entry_type_category_idx`(`entry_type`, `category`),
    INDEX `cash_entry_client_name_idx`(`client_name`),
    INDEX `cash_entry_handler_employee_id_idx`(`handler_employee_id`),
    INDEX `cash_entry_project_id_idx`(`project_id`),
    INDEX `cash_entry_shoot_id_idx`(`shoot_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_review` ADD CONSTRAINT `employee_review_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_separation` ADD CONSTRAINT `employee_separation_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_request` ADD CONSTRAINT `payment_request_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_request` ADD CONSTRAINT `payment_request_cash_entry_id_fkey` FOREIGN KEY (`cash_entry_id`) REFERENCES `cash_entry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_request_expense` ADD CONSTRAINT `payment_request_expense_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `payment_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_request_expense` ADD CONSTRAINT `payment_request_expense_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_request_expense` ADD CONSTRAINT `payment_request_expense_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_entry` ADD CONSTRAINT `cash_entry_handler_employee_id_fkey` FOREIGN KEY (`handler_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_entry` ADD CONSTRAINT `cash_entry_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_entry` ADD CONSTRAINT `cash_entry_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- The dropdown values the employee form used to hard-code. INSERT IGNORE leaves anything
-- already present alone, so this stays safe to re-run.

INSERT IGNORE INTO `designation` (`code`, `name`, `updated_at`) VALUES
  ('FOUNDER', 'Founder', NOW(3)),
  ('CO_FOUNDER', 'Co-Founder', NOW(3)),
  ('DIRECTOR_OPERATIONS', 'Director Operations', NOW(3)),
  ('TEAM_LEADER', 'Team Leader', NOW(3)),
  ('DATA_MANAGER', 'Data Manager', NOW(3)),
  ('SR_BUSINESS_DEVELOPMENT_MANAGER', 'Sr. Business Development Manager', NOW(3)),
  ('BUSINESS_DEVELOPMENT_ASSOCIATE', 'Business Development Associate', NOW(3)),
  ('ACCOUNTS_COORDINATOR', 'Accounts Coordinator', NOW(3)),
  ('SR_CREATIVE_SPECIALIST', 'Sr. Creative Specialist', NOW(3)),
  ('CREATIVE_SPECIALIST', 'Creative Specialist', NOW(3)),
  ('POST_PRODUCTION_MANAGER', 'Post Production Manager', NOW(3)),
  ('POST_PRODUCTION_COORDINATOR', 'Post Production Coordinator', NOW(3)),
  ('POST_PRODUCTION_EXECUTIVE', 'Post Production Executive', NOW(3)),
  ('PRE_PRODUCTION_COORDINATOR', 'Pre Production Coordinator', NOW(3)),
  ('PRODUCTION_COORDINATOR', 'Production Coordinator', NOW(3)),
  ('CUSTOMER_RELATIONSHIP_MANAGER', 'Customer Relationship Manager', NOW(3)),
  ('OFFICE_ASSISTANT', 'Office Assistant', NOW(3)),
  ('OFFICE_ASSISTANT_SALES', 'Office Assistant + Sales', NOW(3)),
  ('TECHNICAL', 'Technical', NOW(3)),
  ('TECHNICAL_VIDEOGRAPHER', 'Technical - Videographer', NOW(3)),
  ('VIDEOGRAPHER', 'Videographer', NOW(3)),
  ('PHOTOGRAPHER', 'Photographer', NOW(3)),
  ('SHOOT_ASSIST', 'Shoot Assist', NOW(3)),
  ('EDITOR', 'Editor', NOW(3)),
  ('DESIGNER', 'Designer', NOW(3)),
  ('HR_EXECUTIVE', 'HR Executive', NOW(3)),
  ('ADMIN', 'Admin', NOW(3)),
  ('OTHERS', 'Others', NOW(3));

INSERT IGNORE INTO `department` (`code`, `name`, `updated_at`) VALUES
  ('MANAGEMENT', 'Management', NOW(3)),
  ('OPERATIONS', 'Operations', NOW(3)),
  ('HUMAN_RESOURCE', 'Human Resource', NOW(3)),
  ('PRE_PRODUCTION', 'Pre Production', NOW(3)),
  ('PRODUCTION', 'Production', NOW(3)),
  ('POST_PRODUCTION', 'Post Production', NOW(3)),
  ('TECHNICAL', 'Technical', NOW(3)),
  ('SALES', 'Sales', NOW(3)),
  ('ACCOUNTS', 'Accounts', NOW(3)),
  ('DATA_MANAGEMENT', 'Data Management', NOW(3)),
  ('ADMINISTRATION', 'Administration', NOW(3)),
  ('NON_TECHNICAL', 'Non Technical', NOW(3)),
  ('TEMPORARY', 'Temporary', NOW(3)),
  ('TRAINING', 'Training', NOW(3)),
  ('OTHERS', 'Others', NOW(3));

INSERT IGNORE INTO `vertical` (`code`, `name`, `updated_at`) VALUES
  ('DUM_DUM', 'Dum Dum', NOW(3)),
  ('QUA_QUA', 'Qua Qua', NOW(3)),
  ('CORP', 'Corp', NOW(3)),
  ('TEAM_33', 'Team 33', NOW(3)),
  ('GENERAL', 'General', NOW(3));

INSERT IGNORE INTO `skill` (`code`, `name`, `updated_at`) VALUES
  ('PHOTOGRAPHY', 'Photography', NOW(3)),
  ('VIDEOGRAPHY', 'Videography', NOW(3)),
  ('CANDID_PHOTOGRAPHY', 'Candid Photography', NOW(3)),
  ('CANDID_VIDEOGRAPHY', 'Candid Videography', NOW(3)),
  ('DRONE', 'Drone', NOW(3)),
  ('EDITING', 'Editing', NOW(3)),
  ('RETOUCHING', 'Retouching', NOW(3)),
  ('ALBUM_DESIGNING', 'Album Designing', NOW(3)),
  ('ALBUM_PRINTING', 'Album Printing', NOW(3)),
  ('CLIENT_HANDLING', 'Client Handling', NOW(3)),
  ('SALES', 'Sales', NOW(3)),
  ('CRM', 'CRM', NOW(3)),
  ('PRE_PRODUCTION_COORDINATION', 'Pre Production Coordination', NOW(3)),
  ('PRODUCTION_COORDINATION', 'Production Coordination', NOW(3)),
  ('POST_PRODUCTION_COORDINATION', 'Post Production Coordination', NOW(3)),
  ('DATA_MANAGEMENT', 'Data Management', NOW(3)),
  ('ACCOUNTS', 'Accounts', NOW(3)),
  ('WHATSAPP_COORDINATION', 'WhatsApp Coordination', NOW(3)),
  ('CUSTOMER_SUPPORT', 'Customer Support', NOW(3)),
  ('GRAPHIC_DESIGN', 'Graphic Design', NOW(3)),
  ('AI_RETOUCH', 'AI Retouch', NOW(3)),
  ('STUDIO_OPERATIONS', 'Studio Operations', NOW(3)),
  ('OUTDOOR_SHOOT', 'Outdoor Shoot', NOW(3)),
  ('INDOOR_SHOOT', 'Indoor Shoot', NOW(3)),
  ('OTHERS', 'Others', NOW(3));
