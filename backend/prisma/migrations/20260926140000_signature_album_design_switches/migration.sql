-- Signature Album: the Design panel's "Show highlights section" and "Show image numbers" switches
-- are gone. The highlights section shows whenever the album has highlights, and running numbers
-- follow the studio-wide Settings switch (`signature_album_settings.show_image_numbers`, kept)
-- alone. Nothing else read these two columns.
ALTER TABLE `signature_album`
  DROP COLUMN `show_highlights`,
  DROP COLUMN `show_image_numbers`;
