-- The Signature Album: Image Selection → Project → Signature Album tab.
--
-- Five tables and no column on an existing one. The album is a *consumer* of the project's photos:
-- every picture it shows is a reference to an `image_selection_upload` row - the same R2 preview
-- the client gallery serves - and the original stays wherever the studio keeps it. Nothing here is
-- Photo Selection state; the album carries its own status, link, PIN, expiry and permissions.
--
--   signature_album            one per project: title, cover, design, status, link, PIN, expiry,
--                              client permissions, ending message, branding snapshot
--   signature_album_chapter    Engagement / Haldi / The Wedding: name, subtitle, cover, order
--   signature_album_item       "this photo is in this chapter, at this position", plus the
--                              highlight flag - a reference, never a copy
--   signature_album_favourite  a client's ♡, per viewer and per album; never Photo Selection
--   signature_album_settings   the studio-wide defaults a new album is created from (one row)
--
-- Every album row cascades from the project, every item cascades from its photo, its chapter and
-- its album, and a cover set on a photo that is later deleted is set NULL - so the existing delete
-- paths (a photo, a folder tree, a purged project) clean the album up without knowing it exists,
-- and no reference can be left pointing at a photo that has gone. The direction is one way only:
-- deleting an album deletes these rows and nothing else.
--
-- One permission row, IMAGE_SELECTION / Signature Album: Read opens the tab and the preview,
-- Read / Write edits, publishes and shares. The seed cannot be run on production (CLAUDE.md), so the
-- row is written here as well as in `seeds/permission-catalogue.js`, with the same module, feature
-- and level the seed upserts on. Nothing held it before, so no grants are copied across: until a
-- role is ticked in Role Management and re-saved, only a Super Admin opens the tab - and SUPER_ADMIN
-- is granted it below, as every new permission must be (test/iam-super-admin-grants.test.js). The
-- studio-wide defaults answer to the existing SETTINGS / Organization, the permission of the panel
-- they are edited in.
--
-- Cost: five empty tables, one permission row and one grant. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE `signature_album` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `event_date` DATETIME(3) NULL,
    `cover_image_id` VARCHAR(191) NULL,
    `cover_alignment` VARCHAR(10) NOT NULL DEFAULT 'CENTER',
    `theme` VARCHAR(20) NOT NULL DEFAULT 'EDITORIAL',
    `cover_style` VARCHAR(20) NOT NULL DEFAULT 'FULL_SCREEN',
    `layout_style` VARCHAR(20) NOT NULL DEFAULT 'EDITORIAL',
    `background_color` VARCHAR(9) NULL,
    `text_color` VARCHAR(9) NULL,
    `accent_color` VARCHAR(9) NULL,
    `heading_font` VARCHAR(60) NULL,
    `body_font` VARCHAR(60) NULL,
    `image_spacing` VARCHAR(12) NOT NULL DEFAULT 'STANDARD',
    `show_highlights` BOOLEAN NOT NULL DEFAULT true,
    `show_image_numbers` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `published_by_user_id` INTEGER NULL,
    `expires_at` DATETIME(3) NULL,
    `short_code` VARCHAR(8) NULL,
    `token_hash` CHAR(64) NULL,
    `token_cipher` TEXT NULL,
    `require_pin` BOOLEAN NOT NULL DEFAULT true,
    `pin_hash` VARCHAR(191) NULL,
    `pin_cipher` TEXT NULL,
    `allow_download` BOOLEAN NOT NULL DEFAULT true,
    `download_mode` VARCHAR(12) NOT NULL DEFAULT 'PREVIEW',
    `allow_favourite` BOOLEAN NOT NULL DEFAULT true,
    `allow_selection` BOOLEAN NOT NULL DEFAULT false,
    `allow_share` BOOLEAN NOT NULL DEFAULT true,
    `ending_message` TEXT NULL,
    `branding_snapshot` JSON NULL,
    `album_first_opened_at` DATETIME(3) NULL,
    `album_last_opened_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `signature_album_project_id_key`(`project_id`),
    UNIQUE INDEX `signature_album_short_code_key`(`short_code`),
    UNIQUE INDEX `signature_album_token_hash_key`(`token_hash`),
    INDEX `signature_album_status_idx`(`status`),
    INDEX `signature_album_cover_image_id_idx`(`cover_image_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_album_chapter` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(255) NULL,
    `cover_image_id` VARCHAR(191) NULL,
    `layout_style` VARCHAR(20) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `signature_album_chapter_album_id_sort_order_idx`(`album_id`, `sort_order`),
    INDEX `signature_album_chapter_cover_image_id_idx`(`cover_image_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_album_item` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `chapter_id` VARCHAR(191) NOT NULL,
    `image_id` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_highlight` BOOLEAN NOT NULL DEFAULT false,
    `highlight_order` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signature_album_item_chapter_id_sort_order_idx`(`chapter_id`, `sort_order`),
    INDEX `signature_album_item_album_id_is_highlight_highlight_order_idx`(`album_id`, `is_highlight`, `highlight_order`),
    INDEX `signature_album_item_image_id_idx`(`image_id`),
    UNIQUE INDEX `signature_album_item_album_image_unique`(`album_id`, `image_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_album_favourite` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `image_id` VARCHAR(191) NOT NULL,
    `client_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signature_album_favourite_album_id_client_key_idx`(`album_id`, `client_key`),
    INDEX `signature_album_favourite_image_id_idx`(`image_id`),
    UNIQUE INDEX `signature_album_favourite_unique`(`album_id`, `image_id`, `client_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_album_settings` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `default_theme` VARCHAR(20) NOT NULL DEFAULT 'EDITORIAL',
    `default_layout_style` VARCHAR(20) NOT NULL DEFAULT 'EDITORIAL',
    `default_cover_style` VARCHAR(20) NOT NULL DEFAULT 'FULL_SCREEN',
    `default_expiry_months` INTEGER NOT NULL DEFAULT 6,
    `use_global_logo` BOOLEAN NOT NULL DEFAULT true,
    `show_studio_name` BOOLEAN NOT NULL DEFAULT true,
    `show_studio_logo` BOOLEAN NOT NULL DEFAULT true,
    `show_branding_footer` BOOLEAN NOT NULL DEFAULT true,
    `footer_text` VARCHAR(255) NULL,
    `allow_download_default` BOOLEAN NOT NULL DEFAULT true,
    `allow_favourite_default` BOOLEAN NOT NULL DEFAULT true,
    `allow_selection_default` BOOLEAN NOT NULL DEFAULT false,
    `allow_share_default` BOOLEAN NOT NULL DEFAULT true,
    `show_image_numbers` BOOLEAN NOT NULL DEFAULT false,
    `require_pin` BOOLEAN NOT NULL DEFAULT true,
    `pin_length` INTEGER NOT NULL DEFAULT 4,
    `auto_unpublish_after_expiry` BOOLEAN NOT NULL DEFAULT true,
    `default_background` VARCHAR(12) NOT NULL DEFAULT 'WHITE',
    `image_spacing` VARCHAR(12) NOT NULL DEFAULT 'STANDARD',
    `initial_photos_loaded` INTEGER NOT NULL DEFAULT 30,
    `lazy_load_batch` INTEGER NOT NULL DEFAULT 30,
    `preload_next_images` BOOLEAN NOT NULL DEFAULT true,
    `download_mode` VARCHAR(12) NOT NULL DEFAULT 'PREVIEW',
    `default_ending_message` TEXT NULL,
    `ending_show_logo` BOOLEAN NOT NULL DEFAULT true,
    `ending_show_website` BOOLEAN NOT NULL DEFAULT true,
    `ending_show_instagram` BOOLEAN NOT NULL DEFAULT true,
    `website_url` VARCHAR(255) NULL,
    `instagram_url` VARCHAR(255) NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `signature_album` ADD CONSTRAINT `signature_album_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album` ADD CONSTRAINT `signature_album_cover_image_id_fkey` FOREIGN KEY (`cover_image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_chapter` ADD CONSTRAINT `signature_album_chapter_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `signature_album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_chapter` ADD CONSTRAINT `signature_album_chapter_cover_image_id_fkey` FOREIGN KEY (`cover_image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_item` ADD CONSTRAINT `signature_album_item_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `signature_album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_item` ADD CONSTRAINT `signature_album_item_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `signature_album_chapter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_item` ADD CONSTRAINT `signature_album_item_image_id_fkey` FOREIGN KEY (`image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_favourite` ADD CONSTRAINT `signature_album_favourite_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `signature_album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_album_favourite` ADD CONSTRAINT `signature_album_favourite_image_id_fkey` FOREIGN KEY (`image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- The permission, where production can hold it.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'IMAGE_SELECTION', 'Signature Album', 'ISSIGNATURE_ALBUM', 'Signature Album',
       'The Signature Album tab of an Image Selection project: its cover, chapters and photos, its design, and publishing and sharing the client album', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'IMAGE_SELECTION'
    AND `existing`.`feature` = 'Signature Album'
    AND `existing`.`level` = 'ISSIGNATURE_ALBUM'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
  FROM `role` JOIN `permission` ON `permission`.`level` = 'ISSIGNATURE_ALBUM'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
