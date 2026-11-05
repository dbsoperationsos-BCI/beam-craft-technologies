-- Phase 7 of AI culling: finalization. One nullable column on the photo record — the stamp a
-- FINALIZED culling session leaves on every photo it excluded from Photo Selection. Null means
-- eligible, and stays null forever on projects that never cull, so every existing project
-- behaves exactly as before. Written wholesale at finalize (never onto a photo the client
-- already selected), cleared wholesale on reopen; the photo itself is never deleted or moved.
ALTER TABLE `image_selection_upload` ADD COLUMN `cull_rejected_at` DATETIME(3) NULL;
