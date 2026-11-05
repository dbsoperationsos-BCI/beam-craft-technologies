-- The AI Feature's own tables: events, their settings, sub-events, guests, media, faces, people,
-- matches, the guest link and the timeline.
--
-- Fifteen tables and not one column on an existing one. The AI Feature is a second gallery product
-- under the Visual Curation heading, and it is kept apart from Image Selection and Album Proofing
-- on purpose: nothing here references `image_selection_*` or `album_proof_*`, and nothing there
-- references these, so neither can break the other by changing shape. Staff user ids are bare
-- columns without a foreign key, as the Image Selection tables hold them; everything inside an
-- event cascades from `ai_event`, which is the one delete the studio asks for.
--
-- Face data is the sensitive part and is laid out so that it cannot leak by accident:
-- `ai_event_face` is the box and the score a listing may show, and its vector sits in
-- `ai_event_face_embedding` beside it, a table no API selects from except the matcher. Guest
-- selfies (`ai_event_guest_face`) and face crops are private R2 objects addressed by key only.
--
-- MySQL 8 has no vector type, so a vector is base64 of float32 in a TEXT column, compared in the
-- worker one event at a time - every query is scoped by `event_id` first, which is also what keeps
-- one event's guests from ever searching another's photos.
--
-- The permissions this answers to arrive in 20260922100000_ai_feature_permissions.
--
-- Cost: fifteen empty tables. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE `ai_event` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(60) NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `location` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `cover_key` VARCHAR(1024) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'UPCOMING',
    `branch` VARCHAR(191) NULL,
    `branch_id` INTEGER NULL,
    `created_by_user_id` INTEGER NULL,
    `archived_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_status_archived_at_idx`(`status`, `archived_at`),
    INDEX `ai_event_start_date_idx`(`start_date`),
    INDEX `ai_event_deleted_at_idx`(`deleted_at`),
    INDEX `ai_event_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_sub_event` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NULL,
    `start_time` VARCHAR(5) NULL,
    `end_time` VARCHAR(5) NULL,
    `location` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_sub_event_event_id_sort_order_idx`(`event_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_default_setting` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `general` JSON NULL,
    `guest_access` JSON NULL,
    `ai` JSON NULL,
    `media` JSON NULL,
    `gallery` JSON NULL,
    `privacy` JSON NULL,
    `notifications` JSON NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_setting` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `guest_access` JSON NOT NULL,
    `ai` JSON NOT NULL,
    `media` JSON NOT NULL,
    `gallery` JSON NOT NULL,
    `privacy` JSON NOT NULL,
    `notifications` JSON NOT NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_event_setting_event_id_key`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_guest_group` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `sub_event_ids` JSON NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_guest_group_event_id_sort_order_idx`(`event_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_guest` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `group_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(191) NULL,
    `rsvp` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `selfie_status` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `matched_count` INTEGER NOT NULL DEFAULT 0,
    `session_hash` CHAR(64) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
    `joined_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_event_guest_session_hash_key`(`session_hash`),
    INDEX `ai_event_guest_event_id_name_idx`(`event_id`, `name`),
    INDEX `ai_event_guest_event_id_phone_idx`(`event_id`, `phone`),
    INDEX `ai_event_guest_event_id_group_id_idx`(`event_id`, `group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_media_folder` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `sub_event_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_media_folder_event_id_sort_order_idx`(`event_id`, `sort_order`),
    INDEX `ai_event_media_folder_sub_event_id_idx`(`sub_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_media` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'PHOTO',
    `file_name` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `captured_at` DATETIME(3) NULL,
    `content_hash` CHAR(64) NULL,
    `original_key` VARCHAR(1024) NULL,
    `preview_key` VARCHAR(1024) NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `ai_status` VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    `ai_attempts` INTEGER NOT NULL DEFAULT 0,
    `ai_error` TEXT NULL,
    `ai_started_at` DATETIME(3) NULL,
    `ai_completed_at` DATETIME(3) NULL,
    `face_count` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by_user_id` INTEGER NULL,
    `uploaded_by_guest_id` VARCHAR(191) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_media_event_id_folder_id_ai_status_idx`(`event_id`, `folder_id`, `ai_status`),
    INDEX `ai_event_media_event_id_ai_status_idx`(`event_id`, `ai_status`),
    INDEX `ai_event_media_event_id_created_at_idx`(`event_id`, `created_at`),
    INDEX `ai_event_media_event_id_content_hash_idx`(`event_id`, `content_hash`),
    INDEX `ai_event_media_event_id_deleted_at_idx`(`event_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_face` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `media_id` VARCHAR(191) NOT NULL,
    `person_id` VARCHAR(191) NULL,
    `box` JSON NOT NULL,
    `det_score` DOUBLE NOT NULL,
    `quality` DOUBLE NOT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_event_face_event_id_person_id_idx`(`event_id`, `person_id`),
    INDEX `ai_event_face_media_id_idx`(`media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_face_embedding` (
    `id` VARCHAR(191) NOT NULL,
    `face_id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `model` VARCHAR(60) NOT NULL,
    `dimension` INTEGER NOT NULL,
    `vector` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_event_face_embedding_face_id_key`(`face_id`),
    INDEX `ai_event_face_embedding_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_person` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(120) NULL,
    `guest_id` VARCHAR(191) NULL,
    `face_count` INTEGER NOT NULL DEFAULT 0,
    `media_count` INTEGER NOT NULL DEFAULT 0,
    `centroid` TEXT NULL,
    `cover_face_id` VARCHAR(191) NULL,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_person_event_id_hidden_idx`(`event_id`, `hidden`),
    INDEX `ai_event_person_guest_id_idx`(`guest_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_guest_face` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `selfie_key` VARCHAR(1024) NOT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `model` VARCHAR(60) NOT NULL,
    `dimension` INTEGER NOT NULL,
    `vector` TEXT NOT NULL,
    `quality` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_event_guest_face_event_id_guest_id_idx`(`event_id`, `guest_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_face_match` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `guest_id` VARCHAR(191) NOT NULL,
    `media_id` VARCHAR(191) NOT NULL,
    `face_id` VARCHAR(191) NULL,
    `person_id` VARCHAR(191) NULL,
    `similarity` DOUBLE NOT NULL,
    `band` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'MATCHED',
    `source` VARCHAR(20) NOT NULL DEFAULT 'AUTO',
    `reviewed_by_user_id` INTEGER NULL,
    `rejected_by_guest_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_event_face_match_event_id_guest_id_status_idx`(`event_id`, `guest_id`, `status`),
    INDEX `ai_event_face_match_event_id_status_idx`(`event_id`, `status`),
    INDEX `ai_event_face_match_media_id_idx`(`media_id`),
    UNIQUE INDEX `ai_event_face_match_guest_media_unique`(`guest_id`, `media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_share` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_cipher` TEXT NOT NULL,
    `short_code` VARCHAR(8) NULL,
    `pin_hash` VARCHAR(191) NULL,
    `pin_cipher` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `access_count` INTEGER NOT NULL DEFAULT 0,
    `last_access_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_event_share_event_id_key`(`event_id`),
    UNIQUE INDEX `ai_event_share_token_hash_key`(`token_hash`),
    UNIQUE INDEX `ai_event_share_short_code_key`(`short_code`),
    INDEX `ai_event_share_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_event_activity` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `actor_type` VARCHAR(20) NOT NULL DEFAULT 'STAFF',
    `actor_user_id` INTEGER NULL,
    `actor_label` VARCHAR(191) NULL,
    `event` VARCHAR(50) NOT NULL,
    `detail` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_event_activity_event_id_created_at_idx`(`event_id`, `created_at`),
    INDEX `ai_event_activity_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_event_sub_event` ADD CONSTRAINT `ai_event_sub_event_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_setting` ADD CONSTRAINT `ai_event_setting_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest_group` ADD CONSTRAINT `ai_event_guest_group_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest` ADD CONSTRAINT `ai_event_guest_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest` ADD CONSTRAINT `ai_event_guest_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `ai_event_guest_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media_folder` ADD CONSTRAINT `ai_event_media_folder_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media_folder` ADD CONSTRAINT `ai_event_media_folder_sub_event_id_fkey` FOREIGN KEY (`sub_event_id`) REFERENCES `ai_event_sub_event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media` ADD CONSTRAINT `ai_event_media_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media` ADD CONSTRAINT `ai_event_media_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `ai_event_media_folder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_media` ADD CONSTRAINT `ai_event_media_uploaded_by_guest_id_fkey` FOREIGN KEY (`uploaded_by_guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face` ADD CONSTRAINT `ai_event_face_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face` ADD CONSTRAINT `ai_event_face_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `ai_event_media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face` ADD CONSTRAINT `ai_event_face_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ai_event_person`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_embedding` ADD CONSTRAINT `ai_event_face_embedding_face_id_fkey` FOREIGN KEY (`face_id`) REFERENCES `ai_event_face`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_embedding` ADD CONSTRAINT `ai_event_face_embedding_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_person` ADD CONSTRAINT `ai_event_person_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_person` ADD CONSTRAINT `ai_event_person_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest_face` ADD CONSTRAINT `ai_event_guest_face_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_guest_face` ADD CONSTRAINT `ai_event_guest_face_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `ai_event_guest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_media_id_fkey` FOREIGN KEY (`media_id`) REFERENCES `ai_event_media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_face_id_fkey` FOREIGN KEY (`face_id`) REFERENCES `ai_event_face`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_face_match` ADD CONSTRAINT `ai_event_face_match_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `ai_event_person`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_share` ADD CONSTRAINT `ai_event_share_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_event_activity` ADD CONSTRAINT `ai_event_activity_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `ai_event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

