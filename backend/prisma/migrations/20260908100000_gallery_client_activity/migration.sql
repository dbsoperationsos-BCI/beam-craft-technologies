-- When the client opened the gallery link, and when they last did something in it.
--
-- Three stamps on the publication row, all written by the public gallery routes: the first and
-- the latest time the link was opened (any load of the client's page), and the latest time a
-- photo was picked or unpicked or a selection item sent. The Image Selection dashboard reads them
-- for its Needs Attention rows — "client hasn't opened the gallery", "no client activity for 7+
-- days" — and its last-activity columns.
--
-- Nullable and unset for every existing publication, which the dashboard reads as "not recorded"
-- rather than "never happened": a gallery published before this migration falls back to its
-- publish date for quietness, and one the client has already picked photos in is never claimed
-- as unopened, whatever these columns say.
ALTER TABLE `image_selection_gallery_publication`
  ADD COLUMN `gallery_first_opened_at` DATETIME(3) NULL,
  ADD COLUMN `gallery_last_opened_at` DATETIME(3) NULL,
  ADD COLUMN `last_client_activity_at` DATETIME(3) NULL;
