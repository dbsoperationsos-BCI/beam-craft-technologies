-- Meta delivery reports that arrive before the send has stored Meta's message id are kept here and
-- applied once the id is stored (services/whatsappPendingStatus.js), instead of being dropped - as
-- are reports a handler failed on. Rows are deleted 7 days after they arrive. A new, empty table: no existing row is read or changed.

-- CreateTable
CREATE TABLE `whatsapp_pending_status` (
    `id` VARCHAR(191) NOT NULL,
    `provider_message_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `error_code` VARCHAR(40) NULL,
    `error_message` VARCHAR(255) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `event_key` CHAR(64) NOT NULL,
    `processed_at` DATETIME(3) NULL,
    `checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `whatsapp_pending_status_event_key_key`(`event_key`),
    INDEX `whatsapp_pending_status_provider_message_id_processed_at_idx`(`provider_message_id`, `processed_at`),
    INDEX `whatsapp_pending_status_processed_at_checked_at_idx`(`processed_at`, `checked_at`),
    INDEX `whatsapp_pending_status_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
