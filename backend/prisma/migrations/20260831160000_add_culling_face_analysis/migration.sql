-- Phase 3 of AI culling: face analysis via a provider (Amazon Rekognition first). Two columns on
-- the result row: the face stage's own completion stamp — separate from `analyzed_at` (the
-- technical stage) so each stage resumes independently after a retry — and which provider
-- produced the signals. The index backs the cross-session cache: a re-run looks up "has this
-- photo been face-analyzed by this provider before?" and copies the answer instead of paying
-- the provider again. The provider only ever receives preview bytes, never an original.
ALTER TABLE `image_selection_culling_result`
  ADD COLUMN `face_analyzed_at` DATETIME(3) NULL,
  ADD COLUMN `face_provider` VARCHAR(30) NULL;
CREATE INDEX `image_selection_culling_result_face_cache_idx`
  ON `image_selection_culling_result`(`upload_id`, `face_provider`, `face_analyzed_at`);
