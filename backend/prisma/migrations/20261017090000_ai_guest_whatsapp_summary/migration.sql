-- Guest WhatsApp photo summary: a guest's verified phone and consent, the SMS codes that verify it,
-- processing runs (when an event's AI work has settled), and one log row per guest message.
-- Additive only: new nullable columns and new tables. No existing row is rewritten, and every
-- existing event reads the new notifications.guestWhatsAppSummary switch as off (its default).

-- AlterTable
ALTER TABLE `ai_event_guest` ADD COLUMN `phone_verified_at` DATETIME(3) NULL,
    ADD COLUMN `verified_phone` VARCHAR(30) NULL,
    ADD COLUMN `whatsapp_opt_in_at` DATETIME(3) NULL,
    ADD COLUMN `whatsapp_opt_out_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ai_event_media` ADD COLUMN `run_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ai_event_face_match` ADD COLUMN `notification_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ai_event_guest_phone_otp` (
    `id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(30) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_event_guest_phone_otp_guest_id_created_at_idx`(`guest_id`, `created_at`),
    INDEX `ai_event_guest_phone_otp_phone_created_at_idx`(`phone`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_processing_run` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `open_key` VARCHAR(191) NULL,
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settled_at` DATETIME(3) NULL,
    `media_total` INTEGER NOT NULL DEFAULT 0,
    `media_completed` INTEGER NOT NULL DEFAULT 0,
    `media_failed` INTEGER NOT NULL DEFAULT 0,
    `media_skipped` INTEGER NOT NULL DEFAULT 0,
    `media_pending` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_event_processing_run_open_key_key`(`open_key`),
    INDEX `ai_event_processing_run_event_id_status_idx`(`event_id`, `status`),
    INDEX `ai_event_processing_run_status_opened_at_idx`(`status`, `opened_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_notification` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NULL,
    `kind` VARCHAR(40) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    `recipient_masked` VARCHAR(30) NULL,
    `match_count` INTEGER NOT NULL DEFAULT 0,
    `provider` VARCHAR(20) NULL,
    `template` VARCHAR(191) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(80) NULL,
    `error_message` VARCHAR(500) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_event_notification_idempotency_key_key`(`idempotency_key`),
    INDEX `ai_event_notification_event_id_created_at_idx`(`event_id`, `created_at`),
    INDEX `ai_event_notification_guest_id_idx`(`guest_id`),
    INDEX `ai_event_notification_run_id_idx`(`run_id`),
    INDEX `ai_event_notification_status_idx`(`status`),
    INDEX `ai_event_notification_provider_message_id_idx`(`provider_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ai_event_media_run_id_ai_status_idx` ON `ai_event_media`(`run_id`, `ai_status`);

-- CreateIndex
CREATE INDEX `ai_event_face_match_guest_id_notification_id_status_idx` ON `ai_event_face_match`(`guest_id`, `notification_id`, `status`);

-- CreateIndex
CREATE INDEX `ai_event_face_match_notification_id_idx` ON `ai_event_face_match`(`notification_id`);

-- AddForeignKey
ALTER TABLE `ai_event_media` ADD CONSTRAINT `ai_event_media_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `ai_event_processing_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `ai_event_notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest_phone_otp` ADD CONSTRAINT `ai_event_guest_phone_otp_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_processing_run` ADD CONSTRAINT `ai_event_processing_run_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_notification` ADD CONSTRAINT `ai_event_notification_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_notification` ADD CONSTRAINT `ai_event_notification_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_notification` ADD CONSTRAINT `ai_event_notification_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `ai_event_processing_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

