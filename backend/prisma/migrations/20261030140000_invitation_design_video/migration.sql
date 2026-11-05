-- An invitation design's artwork may be a video - an animation the design team exported from Canva or
-- After Effects - played silent on a loop, with its first frame kept as a poster for where a video
-- cannot play. Three new columns on a table added the same day, defaulted or empty.

ALTER TABLE `invitation_template`
  ADD COLUMN `cover_type` VARCHAR(10) NOT NULL DEFAULT 'image',
  ADD COLUMN `poster_url` TEXT NULL,
  ADD COLUMN `poster_key` VARCHAR(255) NULL;
