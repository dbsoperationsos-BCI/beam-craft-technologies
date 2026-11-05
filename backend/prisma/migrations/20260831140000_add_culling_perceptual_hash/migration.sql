-- Phase 2 of AI culling analyzes each photo's preview and needs one thing persisted beyond the
-- scores: a 64-bit DCT perceptual hash (16 hex characters) of the preview. The duplicate/burst
-- grouping stage screens candidates by hamming distance over these before anything heavier runs,
-- so it is indexed per session. Deliberately not a JSON blob — embeddings, if they ever arrive,
-- go to sidecar storage, never MySQL.
ALTER TABLE `image_selection_culling_result` ADD COLUMN `perceptual_hash` VARCHAR(16) NULL;
CREATE INDEX `image_selection_culling_result_session_id_perceptual_hash_idx`
  ON `image_selection_culling_result`(`session_id`, `perceptual_hash`);
