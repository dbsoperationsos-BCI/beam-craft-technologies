-- Watermark Presets: the studio's saved watermarks, and one cached watermarked preview and
-- thumbnail per photo per watermark. Two new tables; nothing existing is changed.

-- CreateTable
CREATE TABLE `ai_watermark_preset` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `logo_key` VARCHAR(1024) NULL,
    `logo_width` INTEGER NULL,
    `logo_height` INTEGER NULL,
    `text` VARCHAR(120) NULL,
    `text_color` VARCHAR(7) NULL,
    `font_weight` VARCHAR(10) NULL,
    `position` VARCHAR(20) NOT NULL,
    `size` INTEGER NOT NULL,
    `opacity` INTEGER NOT NULL,
    `offset_x` INTEGER NOT NULL DEFAULT 0,
    `offset_y` INTEGER NOT NULL DEFAULT 0,
    `created_by_user_id` INTEGER NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_watermark_preset_name_key`(`name`),
    INDEX `ai_watermark_preset_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `ai_watermark_preset_updated_by_user_id_idx`(`updated_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_media_watermark` (
    `id` VARCHAR(191) NOT NULL,
    `media_id` VARCHAR(191) NOT NULL,
    `config_hash` CHAR(64) NOT NULL,
    `preview_key` VARCHAR(1024) NOT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_event_media_watermark_media_id_config_hash_key`(`media_id`, `config_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_watermark_preset` ADD CONSTRAINT `ai_watermark_preset_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_watermark_preset` ADD CONSTRAINT `ai_watermark_preset_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media_watermark` ADD CONSTRAINT `ai_event_media_watermark_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `ai_event_media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

