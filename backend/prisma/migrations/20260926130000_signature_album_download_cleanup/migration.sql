-- Signature Album: the rail keeps Allow Download and Allow Social Share, and the client downloads
-- the whole album as one ZIP. Everything dropped here served only what left the rail with it and
-- is read by nothing else in the application:
--   signature_album.download_mode, allow_favourite, allow_selection   the download dropdown and the
--                                                                     Favourite / Selection switches
--   signature_album.album_first_opened_at, album_last_opened_at       the "Last opened" row
--   signature_album_favourite                                         the client's ♡s, only ever
--                                                                     drawn when the switch was on
--   signature_album_settings.allow_favourite_default,
--     allow_selection_default, download_mode                          the studio-wide defaults of
--                                                                     the three
-- Dropping a table drops its own foreign keys with it; no row of any other table refers to these.
DROP TABLE `signature_album_favourite`;

ALTER TABLE `signature_album`
  DROP COLUMN `download_mode`,
  DROP COLUMN `allow_favourite`,
  DROP COLUMN `allow_selection`,
  DROP COLUMN `album_first_opened_at`,
  DROP COLUMN `album_last_opened_at`;

ALTER TABLE `signature_album_settings`
  DROP COLUMN `allow_favourite_default`,
  DROP COLUMN `allow_selection_default`,
  DROP COLUMN `download_mode`;
