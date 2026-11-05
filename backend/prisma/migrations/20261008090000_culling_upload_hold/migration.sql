-- Photos added through the AI Culling tab are held for culling: off every Photo Selection surface
-- until a finalized run releases them or the studio sends them on without culling. Additive and
-- nullable: every existing photo, and every photo added through Photo Selection, stays null and
-- is unaffected.
ALTER TABLE `image_selection_upload` ADD COLUMN `culling_hold_at` DATETIME(3) NULL;
