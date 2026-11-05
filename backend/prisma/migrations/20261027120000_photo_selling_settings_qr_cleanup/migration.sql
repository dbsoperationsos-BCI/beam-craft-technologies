-- Photo Selling: its own settings, the client's details, the QR poster, and durable file cleanup.
--
-- - `photo_sale_setting`: Photo Selling's studio-wide settings, one row ("default"), written by the
--   application on first save. New galleries copy their defaults from it - never from the AI
--   Feature's settings. Its watermark choice points at a studio-wide watermark design.
-- - `photo_sale_gallery`: the client's name and phone, and the QR poster's design and words.
-- - `photo_sale_storage_cleanup`: files still to be deleted from R2, recorded in the same
--   transaction that deletes the rows owning them and removed once each file is gone.
--
-- Photo Selling's own tables only; nothing existing is altered beyond `photo_sale_gallery`, and no
-- row is deleted.

-- AlterTable
ALTER TABLE `photo_sale_gallery`
    ADD COLUMN `client_name` VARCHAR(191) NULL,
    ADD COLUMN `client_phone` VARCHAR(20) NULL,
    ADD COLUMN `qr_template_id` VARCHAR(40) NULL,
    ADD COLUMN `qr_text` JSON NULL;

-- CreateTable
CREATE TABLE `photo_sale_setting` (
    `id` VARCHAR(20) NOT NULL DEFAULT 'default',
    `price_paise` INTEGER NULL,
    `tax_rate_bps` INTEGER NOT NULL DEFAULT 0,
    `prices_include_tax` BOOLEAN NOT NULL DEFAULT true,
    `require_pin` BOOLEAN NOT NULL DEFAULT false,
    `match_strictness` VARCHAR(12) NOT NULL DEFAULT 'STANDARD',
    `accent_color` VARCHAR(9) NULL,
    `watermark_preset_id` VARCHAR(191) NULL,
    `qr_template_id` VARCHAR(40) NOT NULL DEFAULT 'ivory',
    `qr_text` JSON NULL,
    `download_limit` INTEGER NOT NULL DEFAULT 20,
    `download_days` INTEGER NOT NULL DEFAULT 365,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `photo_sale_setting_watermark_preset_id_idx`(`watermark_preset_id`),
    INDEX `photo_sale_setting_updated_by_user_id_idx`(`updated_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_storage_cleanup` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `target` VARCHAR(10) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `object_key` VARCHAR(1024) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(255) NULL,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `photo_sale_storage_cleanup_key_hash_key`(`key_hash`),
    INDEX `photo_sale_storage_cleanup_next_attempt_at_idx`(`next_attempt_at`),
    INDEX `photo_sale_storage_cleanup_gallery_id_kind_idx`(`gallery_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `photo_sale_setting` ADD CONSTRAINT `photo_sale_setting_watermark_preset_id_fkey` FOREIGN KEY (`watermark_preset_id`) REFERENCES `ai_watermark_preset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_setting` ADD CONSTRAINT `photo_sale_setting_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
