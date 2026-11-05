-- The pre production coordinator's own record of a shoot.
--
-- One row per shoot, raised automatically once a started project has a Pre Production Coordinator,
-- so the work reaches whoever was named without anybody creating it by hand. It holds only what
-- pre production finds out after the sale: where the event actually is, when the crew leaves the
-- studio, whether travel and accommodation are needed, and how the chasing is going. Everything
-- already known — client, branch, coordinators, shoot, dates — is read back through `shoot_id` and
-- `project_id` rather than copied, so this row can never disagree with the sale.
--
-- `project_id` is carried alongside `shoot_id` even though the shoot names its project: the board
-- lists rows for a coordinator across every project, and going through `project_shoot` for that
-- filter on every read costs a join the index cannot help with.
CREATE TABLE `project_pre_production` (
    `id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `location_address` TEXT NULL,
    `location_link` VARCHAR(2048) NULL,
    `reporting_time` VARCHAR(5) NULL,
    `studio_start_date` DATETIME(3) NULL,
    `studio_start_time` VARCHAR(5) NULL,
    `schedule_remarks` TEXT NULL,
    `travel_accommodation_needed` BOOLEAN NOT NULL DEFAULT false,
    `accommodation_address` TEXT NULL,
    `accommodation_link` VARCHAR(2048) NULL,
    `accommodation_remarks` TEXT NULL,
    `last_followup_date` DATETIME(3) NULL,
    `next_followup_date` DATETIME(3) NULL,
    `completion_status` VARCHAR(40) NOT NULL DEFAULT 'Not Started',
    `waiting_for_client_reply` BOOLEAN NOT NULL DEFAULT false,
    `waiting_since` DATETIME(3) NULL,
    `production_coordinator` VARCHAR(191) NULL,
    `production_coordinator_employee_id` INTEGER NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_pre_production_shoot_id_key`(`shoot_id`),
    INDEX `project_pre_production_project_id_idx`(`project_id`),
    INDEX `project_pre_production_completion_status_idx`(`completion_status`),
    INDEX `project_pre_production_next_followup_date_idx`(`next_followup_date`),
    INDEX `project_pre_production_production_coordinator_employee_id_idx`(`production_coordinator_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Both cascade: the row describes one shoot of one project and means nothing without either.
ALTER TABLE `project_pre_production` ADD CONSTRAINT `project_pre_production_shoot_id_fkey`
  FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_pre_production` ADD CONSTRAINT `project_pre_production_project_id_fkey`
  FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
