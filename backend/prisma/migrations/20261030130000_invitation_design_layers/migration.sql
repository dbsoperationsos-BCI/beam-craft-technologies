-- An invitation design's typeface for the names, the colour its words are set in, and two optional
-- pieces of see-through artwork that move over the background - one along the top, one along the
-- bottom - so a design can come alive the way the studio drew it.
--
-- New columns on a table added the same day, empty or defaulted, so there is nothing to fail on.

ALTER TABLE `invitation_template`
  ADD COLUMN `font` VARCHAR(20) NOT NULL DEFAULT 'script',
  ADD COLUMN `ink` VARCHAR(9) NULL,
  ADD COLUMN `top_url` TEXT NULL,
  ADD COLUMN `top_key` VARCHAR(255) NULL,
  ADD COLUMN `bottom_url` TEXT NULL,
  ADD COLUMN `bottom_key` VARCHAR(255) NULL;
