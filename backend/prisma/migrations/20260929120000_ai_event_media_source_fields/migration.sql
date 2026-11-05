-- AI Feature media: what the uploader had on disk, kept beside what the server stored.
-- Additive and nullable: existing rows read back unchanged, older clients never send either value.
ALTER TABLE `ai_event_media`
  ADD COLUMN `source_size_bytes` BIGINT NULL,
  ADD COLUMN `relative_path` VARCHAR(1024) NULL;
