-- Photo Selling (Visual Curation → AI Feature → Photo Selling): the studio's own galleries of
-- photos sold to guests - galleries, their uploaded photos (web-size derivatives only; originals
-- never leave the studio), the faces found in them (a guest sees only the photos their selfie
-- matches), packages, server-priced orders, Cashfree payment attempts, an audit trail of every
-- payment notification, download records, guests' selfie matches (never the selfie itself) and the
-- store's own watermarked previews.
--
-- New tables only, linked to nothing outside this module but `user`: no existing table is altered.
--
-- Also the permission `IMAGE_SELECTION / Photo Selling` (ISPHOTO_SELLING), here as well as in
-- `seeds/permission-catalogue.js` because the seed cannot be run on production. Granted Read / Write
-- to SUPER_ADMIN only; every other role starts at DISABLED and the studio grants it in Role Management.

-- CreateTable
CREATE TABLE `photo_sale_gallery` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `event_date` DATETIME(3) NULL,
    `venue` VARCHAR(255) NULL,
    `cover_photo_id` VARCHAR(191) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `digital_price_paise` INTEGER NULL,
    `original_price_paise` INTEGER NULL,
    `tax_rate_bps` INTEGER NOT NULL DEFAULT 0,
    `prices_include_tax` BOOLEAN NOT NULL DEFAULT true,
    `accent_color` VARCHAR(9) NULL,
    `watermark_snapshot` JSON NULL,
    `match_strictness` VARCHAR(12) NOT NULL DEFAULT 'STANDARD',
    `share_token_hash` CHAR(64) NOT NULL,
    `share_token_cipher` TEXT NOT NULL,
    `short_code` VARCHAR(12) NOT NULL,
    `pin_hash` VARCHAR(191) NULL,
    `pin_cipher` TEXT NULL,
    `visit_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `photo_sale_gallery_share_token_hash_key`(`share_token_hash`),
    UNIQUE INDEX `photo_sale_gallery_short_code_key`(`short_code`),
    INDEX `photo_sale_gallery_status_archived_at_idx`(`status`, `archived_at`),
    INDEX `photo_sale_gallery_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `photo_sale_gallery_cover_photo_id_idx`(`cover_photo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_photo` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(500) NOT NULL,
    `relative_path` VARCHAR(1024) NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `source_size_bytes` BIGINT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `captured_at` DATETIME(3) NULL,
    `content_hash` CHAR(64) NOT NULL,
    `preview_key` VARCHAR(1024) NOT NULL,
    `thumbnail_key` VARCHAR(1024) NOT NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,
    `digital_price_paise` INTEGER NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `face_status` VARCHAR(12) NOT NULL DEFAULT 'NONE',
    `face_count` INTEGER NOT NULL DEFAULT 0,
    `face_error` VARCHAR(255) NULL,
    `face_indexed_at` DATETIME(3) NULL,
    `removed_at` DATETIME(3) NULL,
    `uploaded_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `photo_sale_photo_gallery_id_removed_at_available_sort_order_idx`(`gallery_id`, `removed_at`, `available`, `sort_order`),
    INDEX `photo_sale_photo_gallery_id_face_status_idx`(`gallery_id`, `face_status`),
    INDEX `photo_sale_photo_face_status_updated_at_idx`(`face_status`, `updated_at`),
    INDEX `photo_sale_photo_uploaded_by_user_id_idx`(`uploaded_by_user_id`),
    UNIQUE INDEX `photo_sale_photo_gallery_id_content_hash_key`(`gallery_id`, `content_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_face` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `photo_id` VARCHAR(191) NOT NULL,
    `engine` VARCHAR(20) NOT NULL,
    `dimension` INTEGER NULL,
    `vector` TEXT NULL,
    `quality` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `photo_sale_face_gallery_id_engine_idx`(`gallery_id`, `engine`),
    INDEX `photo_sale_face_photo_id_idx`(`photo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_package` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `photo_count` INTEGER NOT NULL,
    `price_paise` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `photo_sale_package_gallery_id_is_active_idx`(`gallery_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_order` (
    `id` VARCHAR(191) NOT NULL,
    `order_ref` VARCHAR(20) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `buyer_name` VARCHAR(120) NOT NULL,
    `buyer_phone` VARCHAR(20) NOT NULL,
    `buyer_email` VARCHAR(191) NULL,
    `buyer_session_hash` CHAR(64) NOT NULL,
    `access_key_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `currency` CHAR(3) NOT NULL,
    `subtotal_paise` INTEGER NOT NULL,
    `discount_paise` INTEGER NOT NULL,
    `tax_paise` INTEGER NOT NULL,
    `total_paise` INTEGER NOT NULL,
    `pricing_snapshot` JSON NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `photo_sale_order_order_ref_key`(`order_ref`),
    INDEX `photo_sale_order_gallery_id_status_idx`(`gallery_id`, `status`),
    INDEX `photo_sale_order_status_created_at_idx`(`status`, `created_at`),
    INDEX `photo_sale_order_buyer_session_hash_idx`(`buyer_session_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_order_item` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `photo_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `file_name` VARCHAR(500) NOT NULL,
    `relative_path` VARCHAR(1024) NULL,
    `content_hash` CHAR(64) NULL,
    `unit_price_paise` INTEGER NOT NULL,
    `charged_paise` INTEGER NOT NULL,
    `fulfilment` VARCHAR(20) NOT NULL DEFAULT 'PENDING_PAYMENT',
    `delivered_at` DATETIME(3) NULL,
    `delivered_by_user_id` INTEGER NULL,
    `delivery_note` VARCHAR(500) NULL,
    `delivery_url` VARCHAR(1024) NULL,
    `download_count` INTEGER NOT NULL DEFAULT 0,
    `last_downloaded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `photo_sale_order_item_photo_id_idx`(`photo_id`),
    INDEX `photo_sale_order_item_fulfilment_idx`(`fulfilment`),
    INDEX `photo_sale_order_item_delivered_by_user_id_idx`(`delivered_by_user_id`),
    UNIQUE INDEX `photo_sale_order_item_order_id_photo_id_kind_key`(`order_id`, `photo_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_payment` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'CASHFREE',
    `environment` VARCHAR(12) NOT NULL,
    `provider_order_id` VARCHAR(45) NOT NULL,
    `cf_order_id` VARCHAR(64) NULL,
    `payment_session_id` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    `amount_paise` INTEGER NOT NULL,
    `cf_payment_id` VARCHAR(64) NULL,
    `payment_group` VARCHAR(40) NULL,
    `failure_reason` VARCHAR(255) NULL,
    `expires_at` DATETIME(3) NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `photo_sale_payment_provider_order_id_key`(`provider_order_id`),
    INDEX `photo_sale_payment_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `photo_sale_payment_order_id_attempt_key`(`order_id`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_payment_event` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NULL,
    `payment_id` VARCHAR(191) NULL,
    `source` VARCHAR(10) NOT NULL,
    `event_type` VARCHAR(60) NOT NULL,
    `dedupe_key` VARCHAR(191) NOT NULL,
    `signature_valid` BOOLEAN NOT NULL DEFAULT false,
    `provider_status` VARCHAR(30) NULL,
    `amount_paise` INTEGER NULL,
    `summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `photo_sale_payment_event_dedupe_key_key`(`dedupe_key`),
    INDEX `photo_sale_payment_event_order_id_created_at_idx`(`order_id`, `created_at`),
    INDEX `photo_sale_payment_event_payment_id_idx`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_download` (
    `id` VARCHAR(191) NOT NULL,
    `order_item_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `error` VARCHAR(255) NULL,
    `client_hash` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `photo_sale_download_order_item_id_created_at_idx`(`order_item_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_selfie_search` (
    `id` VARCHAR(191) NOT NULL,
    `gallery_id` VARCHAR(191) NOT NULL,
    `session_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `consent_at` DATETIME(3) NOT NULL,
    `engine` VARCHAR(20) NOT NULL,
    `threshold` DOUBLE NOT NULL,
    `match_count` INTEGER NOT NULL DEFAULT 0,
    `matches` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `photo_sale_selfie_search_gallery_id_session_hash_expires_at_idx`(`gallery_id`, `session_hash`, `expires_at`),
    INDEX `photo_sale_selfie_search_expires_at_idx`(`expires_at`),
    INDEX `photo_sale_selfie_search_gallery_id_created_at_idx`(`gallery_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `photo_sale_watermark` (
    `id` VARCHAR(191) NOT NULL,
    `photo_id` VARCHAR(191) NOT NULL,
    `config_hash` CHAR(64) NOT NULL,
    `preview_key` VARCHAR(1024) NOT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `photo_sale_watermark_photo_id_config_hash_key`(`photo_id`, `config_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `photo_sale_gallery` ADD CONSTRAINT `photo_sale_gallery_cover_photo_id_fkey` FOREIGN KEY (`cover_photo_id`) REFERENCES `photo_sale_photo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_gallery` ADD CONSTRAINT `photo_sale_gallery_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_photo` ADD CONSTRAINT `photo_sale_photo_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_photo` ADD CONSTRAINT `photo_sale_photo_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_face` ADD CONSTRAINT `photo_sale_face_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_face` ADD CONSTRAINT `photo_sale_face_photo_id_fkey` FOREIGN KEY (`photo_id`) REFERENCES `photo_sale_photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_package` ADD CONSTRAINT `photo_sale_package_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_order` ADD CONSTRAINT `photo_sale_order_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_order_item` ADD CONSTRAINT `photo_sale_order_item_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `photo_sale_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_order_item` ADD CONSTRAINT `photo_sale_order_item_photo_id_fkey` FOREIGN KEY (`photo_id`) REFERENCES `photo_sale_photo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_order_item` ADD CONSTRAINT `photo_sale_order_item_delivered_by_user_id_fkey` FOREIGN KEY (`delivered_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_payment` ADD CONSTRAINT `photo_sale_payment_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `photo_sale_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_payment_event` ADD CONSTRAINT `photo_sale_payment_event_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `photo_sale_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_payment_event` ADD CONSTRAINT `photo_sale_payment_event_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `photo_sale_payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_download` ADD CONSTRAINT `photo_sale_download_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `photo_sale_order_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_selfie_search` ADD CONSTRAINT `photo_sale_selfie_search_gallery_id_fkey` FOREIGN KEY (`gallery_id`) REFERENCES `photo_sale_gallery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `photo_sale_watermark` ADD CONSTRAINT `photo_sale_watermark_photo_id_fkey` FOREIGN KEY (`photo_id`) REFERENCES `photo_sale_photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', 'Photo Selling', 'ISPHOTO_SELLING', 'Photo Selling', 'Sell the studio''s own photo galleries to guests: galleries and their photos, prices and packages, orders and payments, and delivering the photos bought', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION' AND `existing`.`feature` = 'Photo Selling' AND `existing`.`level` = 'ISPHOTO_SELLING'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'IMAGE_SELECTION' AND `permission`.`feature` = 'Photo Selling' AND `permission`.`level` = 'ISPHOTO_SELLING'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
