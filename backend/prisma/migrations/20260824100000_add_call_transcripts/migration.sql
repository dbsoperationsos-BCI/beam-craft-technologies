-- Call transcripts: one row per recorded Callyzer call, plus its segments.
--
-- Additive only. Nothing existing is altered, so a deploy that applies this cannot disturb the
-- CRM, the call logs or the WhatsApp tables.
--
-- `call_log_id` is unique rather than a foreign key: `sales_crm_call_log` is created at runtime by
-- the CRM module rather than by a migration, so a constraint against it could not be declared
-- here. Uniqueness is what matters - it is what stops a redelivered batch transcribing a call
-- twice - and the application deletes transcripts with their call logs.
CREATE TABLE `sales_call_transcript` (
  `id` VARCHAR(191) NOT NULL,
  `call_log_id` VARCHAR(191) NOT NULL,
  `enquiry_id` VARCHAR(100) NOT NULL,
  `recording_url` TEXT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `full_text` LONGTEXT NULL,
  `language` VARCHAR(20) NULL,
  `duration_seconds` INTEGER NOT NULL DEFAULT 0,
  `provider` VARCHAR(60) NULL,
  `summary` TEXT NULL,
  `sentiment` VARCHAR(30) NULL,
  `call_outcome` VARCHAR(191) NULL,
  `next_action` TEXT NULL,
  `suggestions` LONGTEXT NULL,
  `applied_at` DATETIME(3) NULL,
  `applied_by_user_id` INTEGER NULL,
  `applied_fields` TEXT NULL,
  `error_code` VARCHAR(60) NULL,
  `error_message` TEXT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `sales_call_transcript_call_log_id_key`(`call_log_id`),
  INDEX `sales_call_transcript_enquiry_id_created_at_idx`(`enquiry_id`, `created_at`),
  INDEX `sales_call_transcript_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_call_transcript_segment` (
  `id` VARCHAR(191) NOT NULL,
  `transcript_id` VARCHAR(191) NOT NULL,
  `sequence` INTEGER NOT NULL,
  `start_ms` INTEGER NOT NULL,
  `end_ms` INTEGER NOT NULL,
  `speaker` ENUM('EMPLOYEE', 'CLIENT', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `text` TEXT NOT NULL,

  INDEX `sales_call_transcript_segment_transcript_id_sequence_idx`(`transcript_id`, `sequence`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Segments belong to their transcript and go with it.
ALTER TABLE `sales_call_transcript_segment`
  ADD CONSTRAINT `sales_call_transcript_segment_transcript_id_fkey`
  FOREIGN KEY (`transcript_id`) REFERENCES `sales_call_transcript`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
