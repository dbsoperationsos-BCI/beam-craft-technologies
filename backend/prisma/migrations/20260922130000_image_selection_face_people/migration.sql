-- The client gallery's People filter (Image Selection → faces/), Phase 1.
--
-- Three tables and not one column on an existing one. Faces are detected in the photos a project
-- already holds, described as vectors, grouped into people, and each person is remembered as the
-- set of existing `image_selection_upload` ids they appear in. The gallery then filters its own
-- photos by those mappings; nothing is copied and the photo row stays the source of truth.
--
--   image_selection_face_scan     one row per photo the face worker was handed, and how far it got
--                                 (NOT_PROCESSED / PROCESSING / COMPLETED / FAILED)
--   image_selection_face_person   a cluster of faces believed to be one person, with the running
--                                 centroid the next photo's faces are compared against, and which
--                                 existing photo (and where in it) stands for the person on screen
--   image_selection_face_mapping  "this person is in this photo", one row per person per photo
--
-- Every row cascades from the photo and from the project in the database itself, so the existing
-- delete paths - a photo, a folder tree, a purged project - clean face data up without knowing it
-- exists. A person's cover photo going sets the cover to NULL rather than taking the person with
-- it; the worker picks the next best face. Vectors are base64 float32 in TEXT, as the AI Feature
-- stores them: MySQL 8 has no vector type, and they are compared in the worker one project at a
-- time.
--
-- No permission row: the staff routes answer to IMAGE_SELECTION / Project Management, which is the
-- permission of the gallery they feed, and the client routes are token-authenticated like the
-- rest of the published gallery.
--
-- Cost: three empty tables. Instant.
--
-- Written by hand from `prisma migrate diff` and applied with `prisma migrate deploy`.

-- CreateTable
CREATE TABLE `image_selection_face_scan` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `image_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'NOT_PROCESSED',
    `face_count` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_face_scan_image_id_key`(`image_id`),
    INDEX `image_selection_face_scan_project_id_status_idx`(`project_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_face_person` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `centroid` TEXT NOT NULL,
    `face_count` INTEGER NOT NULL DEFAULT 0,
    `cover_image_id` VARCHAR(191) NULL,
    `cover_box` JSON NULL,
    `cover_quality` DOUBLE NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `image_selection_face_person_project_id_created_at_idx`(`project_id`, `created_at`),
    INDEX `image_selection_face_person_cover_image_id_idx`(`cover_image_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_face_mapping` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `person_id` VARCHAR(191) NOT NULL,
    `image_id` VARCHAR(191) NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `box` JSON NOT NULL,
    `quality` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `image_selection_face_mapping_project_id_image_id_idx`(`project_id`, `image_id`),
    INDEX `image_selection_face_mapping_image_id_idx`(`image_id`),
    UNIQUE INDEX `image_selection_face_mapping_person_image_unique`(`person_id`, `image_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `image_selection_face_scan` ADD CONSTRAINT `image_selection_face_scan_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_scan` ADD CONSTRAINT `image_selection_face_scan_image_id_fkey` FOREIGN KEY (`image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_person` ADD CONSTRAINT `image_selection_face_person_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_person` ADD CONSTRAINT `image_selection_face_person_cover_image_id_fkey` FOREIGN KEY (`cover_image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_mapping` ADD CONSTRAINT `image_selection_face_mapping_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_mapping` ADD CONSTRAINT `image_selection_face_mapping_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `image_selection_face_person`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_face_mapping` ADD CONSTRAINT `image_selection_face_mapping_image_id_fkey` FOREIGN KEY (`image_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
