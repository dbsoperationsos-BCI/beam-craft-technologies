-- Settings → Project Management → Shoot crew notice, vendor arm.
--
-- A vendor confirmed on a shoot is told about it, reminded two days before, told when it changes and
-- told when they are off it. What each vendor was last told lives in `project_shoot_vendor_notice`,
-- the sibling of `project_shoot_crew_notice`.
--
-- Three digests rather than one, because the vendor arm has a wording per kind of change and a single
-- digest cannot say *what* changed. The `last_*` columns are a snapshot of what was actually said, so
-- a "do not travel" message can still be composed once the plan behind it is withdrawn.
--
-- Nothing here back-fills a message. A row is seeded for a vendor already confirmed when the studio
-- switches the arm on (`service.setVendorEnabled`), not by this migration: deploying the code and
-- switching the arm on are separate days, and a vendor confirmed in between is a vendor who should be
-- told.

-- AlterTable
ALTER TABLE `shoot_crew_notice_settings` ADD COLUMN `vendor_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `vendor_last_attempt_at` DATETIME(3) NULL,
    ADD COLUMN `vendor_last_error` TEXT NULL;

-- AlterTable: the vendor a shoot notice went to, so the WhatsApp Activity Log can be filtered and
-- resent by vendor rather than holding only a masked number.
ALTER TABLE `whatsapp_activity` ADD COLUMN `vendor_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `project_shoot_vendor_notice` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `vendor_id` INTEGER NOT NULL,
    `service_definition_id` VARCHAR(191) NULL,
    `shoot_digest` VARCHAR(64) NOT NULL,
    `place_digest` VARCHAR(64) NOT NULL,
    `service_digest` VARCHAR(64) NOT NULL,
    `confirmed_sent_at` DATETIME(3) NULL,
    `reminder_sent_at` DATETIME(3) NULL,
    `needs_number` BOOLEAN NOT NULL DEFAULT false,
    `last_shoot` VARCHAR(191) NULL,
    `last_shoot_code` VARCHAR(60) NULL,
    `last_project` VARCHAR(191) NULL,
    `last_date` DATE NULL,
    `last_time` VARCHAR(80) NULL,
    `last_place` VARCHAR(500) NULL,
    `last_district` VARCHAR(300) NULL,
    `last_service` VARCHAR(500) NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_shoot_vendor_notice_vendor_id_idx`(`vendor_id`),
    INDEX `project_shoot_vendor_notice_service_definition_id_idx`(`service_definition_id`),
    INDEX `project_shoot_vendor_notice_needs_number_idx`(`needs_number`),
    UNIQUE INDEX `project_shoot_vendor_notice_production_id_vendor_id_key`(`production_id`, `vendor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `whatsapp_activity_vendor_id_idx` ON `whatsapp_activity`(`vendor_id`);

-- AddForeignKey
ALTER TABLE `whatsapp_activity` ADD CONSTRAINT `whatsapp_activity_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_vendor_notice` ADD CONSTRAINT `project_shoot_vendor_notice_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_vendor_notice` ADD CONSTRAINT `project_shoot_vendor_notice_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_vendor_notice` ADD CONSTRAINT `project_shoot_vendor_notice_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Who sends the shoot crew notice is no longer a setting: it is each project's own Pre-Production
-- Coordinator, and the vendor arm's is its Production Manager. The sender policy this message used to
-- answer to decided nothing once that shipped, and a setting that decides nothing is worse than no
-- setting - somebody drags an order and believes it matters. Its members go with it (ON DELETE
-- CASCADE); every other message's policy is untouched.
DELETE FROM `whatsapp_sender_policy` WHERE `message_key` = 'SHOOT_CREW_NOTICE';
