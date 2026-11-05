-- Why an Image Selection gallery was unpublished: MANUAL (the studio turned Publish Status off),
-- EXPIRED (its expiry passed) or EMPTY (no photo the client can see was left in the project).
--
-- Only an EMPTY one is published again by itself, with the token, PIN, short URL and expiry it had,
-- once a client-visible photo is back; a MANUAL or EXPIRED one never is. NULL on every row that
-- exists - a gallery unpublished before this was recorded reads as not ours to undo, exactly as a
-- MANUAL one does - so no existing gallery changes state.
--
-- One nullable column added; no existing value changed.

ALTER TABLE `image_selection_gallery_publication` ADD COLUMN `revoked_reason` VARCHAR(20) NULL;
