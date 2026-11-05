-- Sale Extras: every shoot, service or deliverable added to, removed from or re-scoped on a booked
-- project after its finalized quotation was pushed into it, priced by hand, shown in Edit Sale Details
-- and - once published - on the client's existing quotation link.
--
-- 1. `sale_baseline` on the three plan tables: the row as the quotation booked it (its scope fields),
--    or NULL for a row added afterwards. Every row that exists today is filled with its current scope,
--    so an existing project's plan as it stands becomes its baseline - no history is invented and no
--    existing project shows an extra it did not have. Rows written later start NULL.
-- 2. `project_sale_extra`: one recorded change; `project_sale_extra_revision`: one immutable published
--    revision.
--
-- Additive: three columns (and their backfill, which writes nothing but the new column) and two tables.
-- No other column is written. Rehearsed on a copy of the development database.

ALTER TABLE `project_shoot` ADD COLUMN `sale_baseline` JSON NULL;
ALTER TABLE `project_post_production_allocation` ADD COLUMN `sale_baseline` JSON NULL;
ALTER TABLE `project_shoot_deliverable` ADD COLUMN `sale_baseline` JSON NULL;

UPDATE `project_shoot` SET `sale_baseline` = JSON_OBJECT();

UPDATE `project_post_production_allocation` SET `sale_baseline` = JSON_OBJECT(
  'quantity', `quantity`,
  'quantitySessionTiming', `quantity_session_timing`,
  'sessionOptionId', `session_option_id`,
  'durationHours', `duration_hours`,
  'durationMinutes', `duration_minutes`,
  'workDays', `work_days`,
  'timingMinutes', `timing_minutes`,
  'sizeOptionValueId', `size_option_value_id`
);

UPDATE `project_shoot_deliverable` SET `sale_baseline` = JSON_OBJECT(
  'quantity', `quantity`,
  'numberOfPhotos', `number_of_photos`,
  'brandName', `brand_name`,
  'size', `size`,
  'frameInches', `frame_inches`,
  'videoLength', `video_length`,
  'sizeOptionValueId', `size_option_value_id`
);

CREATE TABLE `project_sale_extra_revision` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `sales_quotation_id` VARCHAR(191) NOT NULL,
    `revision_number` INTEGER NOT NULL,
    `original_amount` DECIMAL(12, 2) NOT NULL,
    `net_adjustment` DECIMAL(12, 2) NOT NULL,
    `updated_total` DECIMAL(12, 2) NOT NULL,
    `gst_percent` DECIMAL(5, 2) NOT NULL,
    `lines` JSON NOT NULL,
    `published_by_id` INTEGER NULL,
    `published_by_name` VARCHAR(191) NOT NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_sale_extra_revision_project_id_revision_number_key`(`project_id`, `revision_number`),
    INDEX `project_sale_extra_revision_sales_quotation_id_idx`(`sales_quotation_id`),
    INDEX `project_sale_extra_revision_published_by_id_idx`(`published_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_sale_extra` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `category` VARCHAR(12) NOT NULL,
    `shoot_id` VARCHAR(191) NULL,
    `service_allocation_id` VARCHAR(191) NULL,
    `deliverable_allocation_id` VARCHAR(191) NULL,
    `parent_extra_id` VARCHAR(191) NULL,
    `item_name` VARCHAR(191) NOT NULL,
    `shoot_name` VARCHAR(191) NULL,
    `details` JSON NULL,
    `amount` DECIMAL(12, 2) NULL,
    `remarks` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `changed_at` DATETIME(3) NOT NULL,
    `published_revision_id` VARCHAR(191) NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_sale_extra_code_key`(`code`),
    INDEX `project_sale_extra_project_id_status_idx`(`project_id`, `status`),
    INDEX `project_sale_extra_shoot_id_idx`(`shoot_id`),
    INDEX `project_sale_extra_service_allocation_id_idx`(`service_allocation_id`),
    INDEX `project_sale_extra_deliverable_allocation_id_idx`(`deliverable_allocation_id`),
    INDEX `project_sale_extra_parent_extra_id_idx`(`parent_extra_id`),
    INDEX `project_sale_extra_published_revision_id_idx`(`published_revision_id`),
    INDEX `project_sale_extra_created_by_idx`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_sale_extra_revision` ADD CONSTRAINT `project_sale_extra_revision_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra_revision` ADD CONSTRAINT `project_sale_extra_revision_sales_quotation_id_fkey` FOREIGN KEY (`sales_quotation_id`) REFERENCES `sales_quotation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra_revision` ADD CONSTRAINT `project_sale_extra_revision_published_by_id_fkey` FOREIGN KEY (`published_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_service_allocation_id_fkey` FOREIGN KEY (`service_allocation_id`) REFERENCES `project_post_production_allocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_deliverable_allocation_id_fkey` FOREIGN KEY (`deliverable_allocation_id`) REFERENCES `project_shoot_deliverable`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_parent_extra_id_fkey` FOREIGN KEY (`parent_extra_id`) REFERENCES `project_sale_extra`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_published_revision_id_fkey` FOREIGN KEY (`published_revision_id`) REFERENCES `project_sale_extra_revision`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_sale_extra` ADD CONSTRAINT `project_sale_extra_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
