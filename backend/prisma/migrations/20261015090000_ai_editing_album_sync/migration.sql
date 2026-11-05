-- AI Culling -> "AI Editing + Signature Album": photos sent that way are enrolled for automatic album
-- sync. Each saved render is compressed to the album's preset and written into the photo's one album
-- copy. Two nullable columns, additive only: every existing edit stays not enrolled (NULL) and keeps
-- its manual Send to Signature Album exactly as before.

ALTER TABLE `image_selection_edit` ADD COLUMN `album_sync_at` DATETIME(3) NULL;
ALTER TABLE `image_selection_edit` ADD COLUMN `album_sync_error` VARCHAR(500) NULL;
