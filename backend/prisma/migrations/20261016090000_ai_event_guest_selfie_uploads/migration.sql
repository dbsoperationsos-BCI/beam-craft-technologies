-- A guest may have at most 10 selfies accepted per event. Each selfie replaces the last, so the
-- face rows cannot be counted: the count is kept on the guest. Existing guests start at 0.
ALTER TABLE `ai_event_guest` ADD COLUMN `selfie_uploads` INT NOT NULL DEFAULT 0;
