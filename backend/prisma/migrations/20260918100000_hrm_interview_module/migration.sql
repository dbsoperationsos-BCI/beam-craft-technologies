-- The Interview module: HRM's counterpart of Leads & Followups, with its own linked Google Sheets.
--
-- Two things arrive together here, because neither is any use without the other.
--
-- 1. **The permission.** `HRM / Interview` opens the Interview screen (`/hrm/interview`), every
--    route under `/api/hrm/interview`, and the Settings → Integrations → Interview section that
--    links the sheets feeding it. Written here as well as in `seeds/permission-catalogue.js`
--    because **the seed cannot be run on production** (IAM.md step 10): a guard naming a row the
--    `permission` table does not hold refuses everybody but a Super Admin, and says so to nobody.
--    Same `module`, `feature` and `level` as the catalogue, which is what the seed upserts on, so a
--    seeded environment finds this row rather than making a second one.
--
--    **No grants are copied.** Nothing held this before, and inheriting it from Employee Management
--    would hand every HR role a screen it was not given. After this runs, only a Super Admin opens
--    Interview until the roles that should have it are ticked in Role Management - and SUPER_ADMIN
--    is granted it below, as every new permission must be (test/iam-super-admin-grants.test.js).
--
-- 2. **The tables.** `hrm_interview_candidate` is the register itself. The four beside it are the
--    Interview module's own copy of the CRM's linked-sheet tables - the link, its assignment rules,
--    the people on each rule, and the ledger of rows already imported - kept apart from the
--    `sales_google_sheet_*` tables so Settings → Integrations → Interview lists, syncs and deletes
--    its own sheets without ever touching the CRM's. The Google account connection itself is not
--    duplicated: one connected account per login serves both integrations.
--
-- Cost: one permission row, one grant, five empty tables. Instant.

-- ============================================================================================
-- 1. The permission
-- ============================================================================================
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Interview', 'INTERVIEW_MANAGE', 'Interview',
       'The Interview screen: the candidates the studio is considering, their stage, their interviewer, and the Google Sheets linked under Settings → Integrations → Interview that feed it. Read reads the register; Read / Write adds, edits and links sheets',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM'
    AND `existing`.`feature` = 'Interview'
    AND `existing`.`level` = 'INTERVIEW_MANAGE'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role`
  JOIN `permission` ON `permission`.`level` = 'INTERVIEW_MANAGE'
  LEFT JOIN `role_permission`
    ON `role_permission`.`roleId` = `role`.`id`
   AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN'
   AND `role_permission`.`id` IS NULL;

-- The Integrations row now guards two sections, and its description says which second permission
-- each one needs. Column-to-literal comparison only (see IAM.md step 10 on collations).
UPDATE `permission`
   SET `description` = 'Settings → Integrations: the linked Google Sheets, Drive and Meet accounts. The Sales section also needs SALES / CRM Leads Read / Write and the Interview section HRM / Interview Read / Write, which is what linking a sheet answers for'
 WHERE `module` = 'SETTINGS'
   AND `feature` = 'Integrations'
   AND `level` = 'SETTINGS_INTEGRATIONS';

-- ============================================================================================
-- 2. The tables
-- ============================================================================================
CREATE TABLE `hrm_interview_candidate` (
    `id` VARCHAR(191) NOT NULL,
    `candidate_code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `whatsapp_number` VARCHAR(40) NULL,
    `email` VARCHAR(191) NULL,
    `position` VARCHAR(150) NULL,
    `department` VARCHAR(120) NULL,
    `experience` VARCHAR(60) NULL,
    `current_company` VARCHAR(191) NULL,
    `current_ctc` VARCHAR(60) NULL,
    `expected_ctc` VARCHAR(60) NULL,
    `notice_period` VARCHAR(60) NULL,
    `city` VARCHAR(120) NULL,
    `state` VARCHAR(120) NULL,
    `branch` VARCHAR(120) NULL,
    `branch_id` INTEGER NULL,
    `source` VARCHAR(120) NULL,
    `referred_by` VARCHAR(191) NULL,
    `resume_url` VARCHAR(1000) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'New',
    `interviewer` VARCHAR(150) NULL,
    `interviewer_employee_id` INTEGER NULL,
    `interview_date` VARCHAR(40) NULL,
    `interview_time` VARCHAR(40) NULL,
    `interview_mode` VARCHAR(40) NULL,
    `meet_link` VARCHAR(1000) NULL,
    `applied_date` VARCHAR(40) NULL,
    `added_time` VARCHAR(40) NULL,
    `last_follow_up_date` VARCHAR(40) NULL,
    `next_follow_up_date` VARCHAR(40) NULL,
    `remarks` TEXT NULL,
    `source_row_id` VARCHAR(255) NULL,
    `source_row_number` INTEGER NULL,
    `spreadsheet_id` VARCHAR(191) NULL,
    `gid` VARCHAR(40) NULL,
    `target_tab` VARCHAR(191) NULL,
    `system_table_id` VARCHAR(191) NULL,
    `last_source_sync_at` DATETIME(3) NULL,
    `custom_fields` LONGTEXT NULL,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hrm_interview_candidate_candidate_code_key`(`candidate_code`),
    INDEX `hrm_interview_candidate_status_idx`(`status`),
    INDEX `hrm_interview_candidate_deleted_at_idx`(`deleted_at`),
    INDEX `hrm_interview_candidate_created_at_idx`(`created_at`),
    INDEX `hrm_interview_candidate_phone_idx`(`phone`),
    INDEX `hrm_interview_candidate_email_idx`(`email`),
    INDEX `hrm_interview_candidate_spreadsheet_id_target_tab_idx`(`spreadsheet_id`, `target_tab`),
    INDEX `hrm_interview_candidate_source_row_id_idx`(`source_row_id`),
    INDEX `hrm_interview_candidate_interviewer_employee_id_idx`(`interviewer_employee_id`),
    INDEX `hrm_interview_candidate_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hrm_interview_google_sheet_link` (
    `id` VARCHAR(191) NOT NULL,
    `google_account_connection_id` VARCHAR(191) NULL,
    `system_table_name` VARCHAR(191) NOT NULL,
    `system_table_id` VARCHAR(191) NOT NULL DEFAULT '',
    `sheet_url` VARCHAR(1000) NOT NULL,
    `spreadsheet_id` VARCHAR(191) NULL,
    `spreadsheet_name` VARCHAR(255) NULL,
    `targeted_tab` VARCHAR(191) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    `last_synced_at` DATETIME(3) NULL,
    `last_sync_status` VARCHAR(30) NULL,
    `last_sync_summary` TEXT NULL,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_interview_google_sheet_link_google_account_connection_id_idx`(`google_account_connection_id`),
    INDEX `hrm_interview_google_sheet_link_system_table_id_idx`(`system_table_id`),
    INDEX `hrm_interview_google_sheet_link_deleted_at_idx`(`deleted_at`),
    INDEX `hrm_interview_google_sheet_link_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hrm_interview_google_sheet_assignment_rule` (
    `id` VARCHAR(191) NOT NULL,
    `link_id` VARCHAR(191) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `column_header` VARCHAR(255) NOT NULL DEFAULT '',
    `match_value` VARCHAR(500) NOT NULL DEFAULT '',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_interview_google_sheet_assignment_rule_link_id_idx`(`link_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hrm_interview_google_sheet_assignment_rule_target` (
    `id` VARCHAR(191) NOT NULL,
    `rule_id` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `employee_id` INTEGER NULL,
    `employee_name` VARCHAR(150) NOT NULL DEFAULT '',
    `percent` INTEGER NOT NULL DEFAULT 100,
    `assigned_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hrm_interview_google_sheet_assignment_rule_target_rule_id_idx`(`rule_id`),
    INDEX `hrm_interview_google_sheet_assignment_rule_target_employee_i_idx`(`employee_id`),
    UNIQUE INDEX `hrm_interview_sheet_rule_target_rule_employee`(`rule_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hrm_interview_google_sheet_row` (
    `id` VARCHAR(191) NOT NULL,
    `link_id` VARCHAR(191) NOT NULL,
    `row_key` VARCHAR(255) NOT NULL,
    `candidate_code` VARCHAR(30) NULL,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hrm_interview_google_sheet_row_candidate_code_idx`(`candidate_code`),
    UNIQUE INDEX `hrm_interview_google_sheet_row_link_key`(`link_id`, `row_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
