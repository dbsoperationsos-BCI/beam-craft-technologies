-- Album Proofing domain: albums under existing Image Selection projects, immutable versions with
-- page snapshots (originalPath ONLY — original image bytes are never stored anywhere server-side),
-- the QC and client correction engine, secure client publications, client submissions and the
-- audit timeline. Entirely additive: no existing table or column is touched. Written by hand and
-- applied with `prisma migrate deploy` (never `migrate dev` — the CRM's runtime DDL keeps the
-- shadow database drifted).

CREATE TABLE `album_proof` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `root_folder_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `album_type` VARCHAR(100) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
    `viewer_mode` VARCHAR(20) NOT NULL DEFAULT 'SPREAD',
    `revision_limit` INTEGER NULL DEFAULT 3,
    `revisions_used` INTEGER NOT NULL DEFAULT 0,
    `proof_expiry_days` INTEGER NOT NULL DEFAULT 30,
    `current_version_id` VARCHAR(191) NULL,
    `approved_version_id` VARCHAR(191) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `archived_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `album_proof_root_folder_id_key`(`root_folder_id`),
    INDEX `album_proof_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `album_proof_status_archived_at_idx`(`status`, `archived_at`),
    INDEX `album_proof_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_version` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_number` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    `page_count` INTEGER NOT NULL DEFAULT 0,
    `change_summary` TEXT NULL,
    `frozen_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `album_proof_version_album_id_version_number_key`(`album_id`, `version_number`),
    INDEX `album_proof_version_album_id_status_idx`(`album_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_version_page` (
    `id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NOT NULL,
    `upload_id` VARCHAR(191) NULL,
    `folder_id` VARCHAR(191) NULL,
    `folder_name` VARCHAR(191) NULL,
    `page_number` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `file_name` VARCHAR(500) NOT NULL,
    `original_path` VARCHAR(1024) NOT NULL,
    `preview_key` VARCHAR(1024) NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `file_size` BIGINT NULL,
    `checksum` VARCHAR(64) NULL,
    `changed_from_previous` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `album_proof_version_page_version_id_page_number_key`(`version_id`, `page_number`),
    INDEX `album_proof_version_page_version_id_sort_order_idx`(`version_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_correction` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NOT NULL,
    `version_page_id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(10) NOT NULL DEFAULT 'QC',
    `x_normalized` DOUBLE NOT NULL,
    `y_normalized` DOUBLE NOT NULL,
    `comment` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `submission_id` VARCHAR(191) NULL,
    `publication_id` VARCHAR(191) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_by_label` VARCHAR(191) NULL,
    `resolved_by_user_id` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution_note` TEXT NULL,
    `locked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `album_proof_correction_album_id_status_idx`(`album_id`, `status`),
    INDEX `album_proof_correction_version_id_source_status_idx`(`version_id`, `source`, `status`),
    INDEX `album_proof_correction_version_page_id_idx`(`version_page_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_qc_round` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NOT NULL,
    `round_number` INTEGER NOT NULL,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'FULL',
    `submitted_by_user_id` INTEGER NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decision` VARCHAR(30) NULL,
    `decided_by_user_id` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `note` TEXT NULL,

    UNIQUE INDEX `album_proof_qc_round_version_id_round_number_key`(`version_id`, `round_number`),
    INDEX `album_proof_qc_round_album_id_submitted_at_idx`(`album_id`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_client_publication` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NOT NULL,
    `revision_number` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_cipher` TEXT NOT NULL,
    `pin_hash` VARCHAR(191) NOT NULL,
    `pin_cipher` TEXT NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `published_by_user_id` INTEGER NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_access_at` DATETIME(3) NULL,
    `access_count` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `album_proof_client_publication_token_hash_key`(`token_hash`),
    INDEX `album_proof_client_publication_album_id_published_at_idx`(`album_id`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_client_submission` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NOT NULL,
    `publication_id` VARCHAR(191) NULL,
    `type` VARCHAR(20) NOT NULL,
    `revision_number` INTEGER NULL,
    `correction_count` INTEGER NOT NULL DEFAULT 0,
    `approved_confirmation` TEXT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(500) NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `album_proof_client_submission_version_id_type_key`(`version_id`, `type`),
    INDEX `album_proof_client_submission_album_id_submitted_at_idx`(`album_id`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `album_proof_activity` (
    `id` VARCHAR(191) NOT NULL,
    `album_id` VARCHAR(191) NOT NULL,
    `version_id` VARCHAR(191) NULL,
    `page_id` VARCHAR(191) NULL,
    `correction_id` VARCHAR(191) NULL,
    `actor_type` VARCHAR(20) NOT NULL DEFAULT 'STAFF',
    `actor_user_id` INTEGER NULL,
    `actor_label` VARCHAR(191) NULL,
    `event` VARCHAR(50) NOT NULL,
    `detail` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `album_proof_activity_album_id_created_at_idx`(`album_id`, `created_at`),
    INDEX `album_proof_activity_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `album_proof` ADD CONSTRAINT `album_proof_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof` ADD CONSTRAINT `album_proof_root_folder_id_fkey` FOREIGN KEY (`root_folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `album_proof_version` ADD CONSTRAINT `album_proof_version_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_version_page` ADD CONSTRAINT `album_proof_version_page_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `album_proof_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_correction` ADD CONSTRAINT `album_proof_correction_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_correction` ADD CONSTRAINT `album_proof_correction_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `album_proof_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_correction` ADD CONSTRAINT `album_proof_correction_version_page_id_fkey` FOREIGN KEY (`version_page_id`) REFERENCES `album_proof_version_page`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_qc_round` ADD CONSTRAINT `album_proof_qc_round_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_qc_round` ADD CONSTRAINT `album_proof_qc_round_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `album_proof_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_client_publication` ADD CONSTRAINT `album_proof_client_publication_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_client_publication` ADD CONSTRAINT `album_proof_client_publication_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `album_proof_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_client_submission` ADD CONSTRAINT `album_proof_client_submission_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_client_submission` ADD CONSTRAINT `album_proof_client_submission_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `album_proof_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `album_proof_activity` ADD CONSTRAINT `album_proof_activity_album_id_fkey` FOREIGN KEY (`album_id`) REFERENCES `album_proof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
